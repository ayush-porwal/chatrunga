// Repertoire responsiveness journeys (audit R02): ordinary edits in one large repertoire and a
// backup restore must not stall the main process. A 5 ms heartbeat in the main process records
// the longest gap between its ticks while each write runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, mainRecord, skipWelcome, test } from "./app";

/** Longest main-process stall these journeys accept; a whole-repertoire reindex took ~430 ms. */
const MAX_GAP_MS = 200;

/** Starts the main-process heartbeat; `stop` returns the longest gap between two ticks. */
async function heartbeat(app: ElectronApplication) {
  await app.evaluate(() => {
    const state = globalThis as unknown as {
      __beat?: { timer: unknown; last: number; max: number; onTick: (() => void) | null };
    };
    const beat = { timer: null as unknown, last: performance.now(), max: 0, onTick: null as (() => void) | null };
    beat.timer = setInterval(() => {
      const now = performance.now();
      beat.max = Math.max(beat.max, now - beat.last);
      beat.last = now;
      beat.onTick?.();
    }, 5);
    state.__beat = beat;
  });
  return {
    stop: () =>
      app.evaluate(async () => {
        const beat = (globalThis as unknown as { __beat: { timer: unknown; max: number; onTick: (() => void) | null } })
          .__beat;
        // One more tick, so a stall at the very end is counted.
        await new Promise<void>((resolve) => (beat.onTick = resolve));
        clearInterval(beat.timer as ReturnType<typeof setInterval>);
        return beat.max;
      })
  };
}

/** A white repertoire of 500 imported chapters of 100 moves each (knight shuffles: transpositions everywhere). */
function seedLargeRepertoire(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name: "Large repertoire", color: "white" });
    const moves = Array.from(
      { length: 100 },
      (_, ply) => (ply % 2 === 0 ? `${ply / 2 + 1}. ` : "") + ["Nf3", "Nf6", "Ng1", "Ng8"][ply % 4]
    ).join(" ");
    const pgn = Array.from(
      { length: 500 },
      (_, index) => `[Event "Line ${index}"]\n\n${moves} *`
    ).join("\n\n");
    const preview = await api.previewImport({ pgn });
    const imported = await api.commitImport({
      jobId: preview.jobId,
      repertoireId: created.id,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: game.proposedTitle,
        kind: "opening" as const,
        include: true
      }))
    });
    const summary = imported.repertoire.chapters.filter((chapter) => chapter.nodeCount > 0)[250];
    const chapter = await api.getChapter({ repertoireId: created.id, chapterId: summary.id });
    return { id: created.id, revision: imported.repertoire.revision, chapter };
  });
}

test(
  "edits one chapter of a 500-chapter repertoire without stalling the main process",
  { tag: "@perf" },
  async ({ launch }) => {
    test.setTimeout(240_000);
    const { app, page } = await launch();
    await skipWelcome(page);
    const seeded = await seedLargeRepertoire(page);
    expect(seeded.chapter.nodeCount).toBe(100);

    // A comment on the root: nothing the index reads changes.
    let beat = await heartbeat(app);
    const commented = await page.evaluate(async ({ id, revision, chapter }) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
      chapter.tree[0].comment = "Only a comment changed.";
      return api.saveChapter({ repertoireId: id, chapter, expectedRevision: revision });
    }, seeded);
    const commentGap = await beat.stop();
    expect(commentGap).toBeLessThan(MAX_GAP_MS);
    expect(commented.decisionsChanged).toBe(0);
    expect(commented.chapter.tree[0].comment).toBe("Only a comment changed.");

    // A new move at the end of the line (back at the start position, shared by every chapter):
    // a new accepted choice for that decision.
    beat = await heartbeat(app);
    const extended = await page.evaluate(async ({ repertoire, chapter }) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
      const leaf = chapter.tree.find((node) => !node.children.length)!;
      leaf.children = ["e2e-new"];
      chapter.tree.push({
        ...leaf,
        id: "e2e-new",
        parentId: leaf.id,
        san: "e4",
        uci: "e2e4",
        fenBefore: leaf.fenAfter,
        fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        comment: null,
        children: []
      });
      return api.saveChapter({
        repertoireId: repertoire.id,
        chapter,
        expectedRevision: repertoire.revision
      });
    }, commented);
    const moveGap = await beat.stop();
    expect(moveGap).toBeLessThan(MAX_GAP_MS);
    expect(extended.decisionsChanged).toBe(1);
    expect(extended.chapter.nodeCount).toBe(101);
    console.log(
      `R02 large repertoire: comment-only save gap ${commentGap.toFixed(1)} ms, one-move save gap ${moveGap.toFixed(1)} ms`
    );
  }
);

test(
  "restores a backup in the restore worker without stalling the main process",
  { tag: "@perf" },
  async ({ launch, profile }) => {
    test.setTimeout(240_000);
    const { app, page } = await launch();
    await skipWelcome(page);
    const seeded = await seedLargeRepertoire(page);

    // The next save dialog writes the backup into the throwaway profile.
    const file = join(profile, "backup.json");
    await app.evaluate(({ dialog }, file) => {
      const previous = dialog.showSaveDialog.bind(dialog);
      dialog.showSaveDialog = (async () => {
        dialog.showSaveDialog = previous;
        return { canceled: false, filePath: file };
      }) as typeof dialog.showSaveDialog;
    }, file);
    const exported = await page.evaluate(
      (id) =>
        (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires.exportBackup({
          repertoireIds: [id],
          includeProgress: true
        }),
      seeded.id
    );
    expect(exported.savedPath).toBe(file);
    const json = readFileSync(file, "utf8");

    // Two pending previews (validated on the main thread, as before), timed apart from the restores.
    const previewBeat = await heartbeat(app);
    const jobs = await page.evaluate(async (json) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
      const copy = (await api.previewBackupImport({ json }))!;
      const replace = (await api.previewBackupImport({ json }))!;
      return { copy: copy.jobId, replace: replace.jobId };
    }, json);
    const previewGap = await previewBeat.stop();

    const beat = await heartbeat(app);
    const restored = await page.evaluate(
      async ({ jobs, id, revision }) => {
        const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
        const copy = await api.restoreBackup({
          jobId: jobs.copy,
          selections: [{ sourceId: id, mode: "new-copy", includeProgress: true }]
        });
        const replaced = await api.restoreBackup({
          jobId: jobs.replace,
          selections: [
            { sourceId: id, mode: "replace", includeProgress: true, expectedRevision: revision }
          ]
        });
        return { copy: copy.restored[0], replaced: replaced.restored[0] };
      },
      { jobs, id: seeded.id, revision: seeded.revision }
    );
    const restoreGap = await beat.stop();
    expect(restored.copy.mode).toBe("new-copy");
    expect(restored.replaced.mode).toBe("replace");
    expect(restored.replaced.retainedBackupPath).toContain("repertoire-backups");
    const copyDetail = await page.evaluate(
      (id) => (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires.get(id),
      restored.copy.repertoireId
    );
    expect(copyDetail.chapterCount).toBe(501);

    // Both restores ran in the bundled worker and answered.
    const record = await mainRecord(app);
    expect(
      record.workers.filter((path) => path.endsWith("repertoire-backup-restore-worker.js"))
    ).toHaveLength(2);
    console.log(
      `R02 backup (50,000 moves): two previews' main-process gap ${previewGap.toFixed(1)} ms, two restores' ${restoreGap.toFixed(1)} ms`
    );
    expect(restoreGap).toBeLessThan(MAX_GAP_MS);
  }
);
