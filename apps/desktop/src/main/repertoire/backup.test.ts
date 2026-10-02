import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireBackupDocument,
  RepertoireChapter,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-backup-test-"));
const sent: { channel: string; payload: unknown }[] = [];
const showSaveDialog = vi.fn(async (...args: unknown[]) => {
  void args;
  return { canceled: true, filePath: undefined as string | undefined };
});
const showOpenDialog = vi.fn(async (...args: unknown[]) => {
  void args;
  return { canceled: true, filePaths: [] as string[] };
});
vi.mock("electron", () => ({
  app: { getPath: () => userData, getName: () => "Chaturanga", getVersion: () => "9.9.9" },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) => sent.push({ channel, payload })
        }
      }
    ],
    getFocusedWindow: () => null
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args)
  }
}));

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { decisionRepository, positionIndexRepository, progressRepository } =
  await import("./repository");

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const files = join(userData, "files");

afterAll(() => {
  service.setRepertoireClock();
  closeDb();
  rmSync(userData, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec("DELETE FROM repertoires");
  getDb().exec("DELETE FROM games");
  rmSync(files, { recursive: true, force: true });
  rmSync(join(userData, "repertoire-backups"), { recursive: true, force: true });
  service.resetImportJobs();
  sent.length = 0;
  showSaveDialog.mockClear();
  showOpenDialog.mockClear();
  now = 1_000_000_000_000;
});

/** A tree of UCI lines; white's moves are included and black's replies covered. */
function chapterOf(id: string, lines: string[][]): RepertoireChapter {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: START_FEN,
    fenAfter: START_FEN,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  const nodeMeta: Record<string, RepertoireNodeMeta> = {};
  for (const line of lines) {
    let parent = root;
    for (const uci of line) {
      let child = parent.children
        .map((childId) => tree.find((node) => node.id === childId)!)
        .find((node) => node.uci === uci);
      if (!child) {
        child = {
          ...root,
          id: `n${tree.length}`,
          parentId: parent.id,
          uci,
          san: uci,
          fenBefore: parent.fenAfter,
          fenAfter: fenAfterUci(parent.fenAfter, uci)!,
          ply: parent.ply + 1,
          children: []
        };
        nodeMeta[child.id] = { edge: child.ply % 2 === 1 ? "included" : "covered" };
        parent.children.push(child.id);
        tree.push(child);
      }
      parent = child;
    }
  }
  return {
    id,
    title: `Chapter ${id}`,
    sortOrder: 0,
    kind: "opening",
    enabled: true,
    rootFen: START_FEN,
    revision: 0,
    nodeCount: 0,
    dueCount: 0,
    headers: { Event: "Prep" },
    tree,
    nodeMeta
  };
}

function insertLibraryGame(id: string) {
  getDb()
    .prepare(
      `INSERT INTO games (id, source, pgn, current_fen, move_tree_json, created_at, updated_at)
        VALUES (?, 'pgn-import', '', ?, '[]', 1, 1)`
    )
    .run(id, START_FEN);
}

/** A repertoire with two chapters, decisions, one progress row and two game links. */
function seed() {
  const created = service.createRepertoire({ name: "Open games", color: "white" });
  const first = chapterOf(created.chapters[0].id, [
    ["e2e4", "e7e5", "g1f3"],
    ["e2e4", "c7c5", "g1f3"]
  ]);
  const detail = service.saveChapter({
    repertoireId: created.id,
    chapter: first,
    expectedRevision: created.revision
  }).repertoire;
  service.saveChapter({
    repertoireId: created.id,
    chapter: { ...chapterOf("second", [["d2d4", "d7d5", "c2c4"]]), sortOrder: 1 },
    expectedRevision: detail.revision
  });
  const session = service.startPractice({ repertoireId: created.id, mode: "learn-new" });
  const card = session.cards[0];
  service.recordAttempt({
    sessionId: session.sessionId,
    queueItemId: card.queueItemId,
    attemptId: "a1",
    uci: card.positionKey === positionKey(START_FEN) ? "e2e4" : "g1f3"
  });
  insertLibraryGame("game-kept");
  insertLibraryGame("game-gone");
  service.linkGame({
    repertoireId: created.id,
    chapterId: first.id,
    gameId: "game-kept",
    gameNodeId: "g1",
    kind: "model",
    capturedPath: "1. e4"
  });
  service.linkGame({
    repertoireId: created.id,
    chapterId: "second",
    gameId: "game-gone",
    gameNodeId: null,
    kind: "played",
    capturedPath: "1. d4"
  });
  service.saveWorkspace({
    repertoireId: created.id,
    workspace: {
      lastChapterId: "second",
      lastNodeId: "n2",
      orientation: "white",
      practiceDraft: null
    }
  });
  return service.getRepertoire(created.id);
}

/** Exports through a mocked save dialog and returns the written text. */
async function exportText(includeProgress: boolean, repertoireIds?: string[]) {
  const path = join(files, `backup-${Math.random()}.json`);
  mkdirSync(files, { recursive: true });
  showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path });
  const result = await service.exportBackup({ includeProgress, repertoireIds });
  return { result, text: readFileSync(path, "utf8"), path };
}

describe("native backup: export", () => {
  it("writes a versioned document through the save dialog, never secrets or settings", async () => {
    const detail = seed();
    const { result, text, path } = await exportText(true);
    expect(result).toEqual({ savedPath: path, repertoireCount: 1, bytes: Buffer.byteLength(text) });
    const options = showSaveDialog.mock.calls[0][0] as Record<string, unknown>;
    expect(options.defaultPath).toMatch(/^chaturanga-repertoires-\d{4}-\d{2}-\d{2}\.json$/);
    expect(options.filters).toEqual([{ name: "Chaturanga backup", extensions: ["json"] }]);
    const document = JSON.parse(text) as RepertoireBackupDocument;
    expect(Object.keys(document).sort()).toEqual([
      "app",
      "exportedAt",
      "format",
      "formatVersion",
      "positionKeyVersion",
      "repertoires",
      "schedulerVersion"
    ]);
    expect(document.app).toEqual({ name: "Chaturanga", version: "9.9.9" });
    expect(Object.keys(document.repertoires[0]).sort()).toEqual([
      "chapters",
      "decisions",
      "gameLinks",
      "progress",
      "repertoire",
      "workspace"
    ]);
    expect(document.repertoires[0].repertoire.revision).toBe(detail.revision);
    expect(document.repertoires[0].progress).toHaveLength(1);
    expect(text).not.toMatch(/apiKey|enginePath|openRouter|executable|evaluation/i);
  });

  it("leaves progress out unless asked, and returns a null path when cancelled", async () => {
    seed();
    const { text } = await exportText(false);
    expect((JSON.parse(text) as RepertoireBackupDocument).repertoires[0].progress).toBeNull();
    const cancelled = await service.exportBackup({ includeProgress: true });
    expect(cancelled.savedPath).toBeNull();
    expect(cancelled.repertoireCount).toBe(1);
  });

  it("refuses unknown repertoire ids and an empty library", async () => {
    await expect(service.exportBackup({ includeProgress: false })).rejects.toThrow(
      "Invalid export: there are no repertoires to back up"
    );
    await expect(
      service.exportBackup({ includeProgress: false, repertoireIds: ["nope"] })
    ).rejects.toThrow('Invalid repertoireIds: "nope" is not in this library');
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
});

describe("native backup: preview", () => {
  it("previews a re-import of an unchanged repertoire as existing with an empty diff", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(preview.warnings).toEqual([]);
    expect(preview.app).toEqual({ name: "Chaturanga", version: "9.9.9" });
    expect(preview.repertoires).toEqual([
      {
        sourceId: detail.id,
        name: "Open games",
        color: "white",
        chapterCount: 2,
        decisionCount: detail.decisionCount,
        hasProgress: true,
        existing: { id: detail.id, name: "Open games", revision: detail.revision },
        diff: {
          chaptersAdded: 0,
          chaptersChanged: 0,
          chaptersRemoved: 0,
          decisionsChanged: 0,
          progressEntries: 1
        }
      }
    ]);
  });

  it("reads a picked file, and returns null when the open dialog is cancelled", async () => {
    seed();
    const { path } = await exportText(false);
    expect(await service.previewBackupImport({ pickFile: true })).toBeNull();
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
    const preview = await service.previewBackupImport({ pickFile: true });
    expect(preview?.repertoires[0].hasProgress).toBe(false);
    expect(showOpenDialog.mock.calls[1][0]).toMatchObject({
      properties: ["openFile"],
      filters: [{ name: "Chaturanga backup", extensions: ["json"] }]
    });
  });

  it("rejects a malformed document and a future format version before keeping a job", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    await expect(service.previewBackupImport({ json: "{oops" })).rejects.toThrow(
      "Invalid backup: the file isn't valid JSON"
    );
    const future = { ...JSON.parse(text), formatVersion: 7 };
    await expect(service.previewBackupImport({ json: JSON.stringify(future) })).rejects.toThrow(
      "Invalid backup: format version 7 isn't supported by this app"
    );
    expect(service.getRepertoire(detail.id).revision).toBe(detail.revision);
    expect(service.listRepertoires()).toHaveLength(1);
  });

  it("ignores unknown fields such as an apiKey", async () => {
    seed();
    const { text } = await exportText(true);
    const document = JSON.parse(text);
    document.apiKey = "sk-secret";
    document.repertoires[0].settings = { enginePath: "/usr/local/bin/stockfish" };
    const preview = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    const result = service.restoreBackup({
      jobId: preview.jobId,
      selections: [
        { sourceId: preview.repertoires[0].sourceId, mode: "new-copy", includeProgress: true }
      ]
    });
    const copy = result.restored[0].repertoireId;
    const { text: reexported } = await exportText(true, [copy]);
    expect(reexported).not.toContain("sk-secret");
    expect(reexported).not.toContain("stockfish");
  });

  it("expires jobs after 30 minutes, keeps three, and forgets a cancelled one", async () => {
    seed();
    const { text } = await exportText(false);
    const sourceId = (JSON.parse(text) as RepertoireBackupDocument).repertoires[0].repertoire.id;
    const restoreWith = (jobId: string) =>
      service.restoreBackup({
        jobId,
        selections: [{ sourceId, mode: "new-copy", includeProgress: false }]
      });

    const cancelled = (await service.previewBackupImport({ json: text }))!;
    service.cancelBackupImport(cancelled.jobId);
    expect(() => restoreWith(cancelled.jobId)).toThrow(
      "Invalid jobId: the backup preview expired or was cancelled; choose the file again"
    );

    const expiring = (await service.previewBackupImport({ json: text }))!;
    now += 30 * 60_000;
    expect(() => restoreWith(expiring.jobId)).toThrow(/Invalid jobId/);

    const jobs: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      jobs.push((await service.previewBackupImport({ json: text }))!.jobId);
    }
    expect(() => restoreWith(jobs[0])).toThrow(/Invalid jobId/);
    expect(restoreWith(jobs[3]).restored).toHaveLength(1);
  });
});

describe("native backup: restore", () => {
  it("restores a new copy with fresh ids, the same decisions and a rebuilt index", async () => {
    const detail = seed();
    const original = decisionRepository.list(detail.id);
    const { text } = await exportText(true);
    getDb().prepare("DELETE FROM games WHERE id = ?").run("game-gone");
    const preview = (await service.previewBackupImport({ json: text }))!;
    sent.length = 0;
    const result = service.restoreBackup({
      jobId: preview.jobId,
      selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: false }]
    });
    const restored = result.restored[0];
    expect(restored).toMatchObject({
      sourceId: detail.id,
      mode: "new-copy",
      retainedBackupPath: null
    });
    expect(restored.repertoireId).not.toBe(detail.id);

    const copy = service.getRepertoire(restored.repertoireId);
    expect(copy).toMatchObject({ name: "Open games (restored)", revision: 1, chapterCount: 2 });
    expect(copy.decisionCount).toBe(detail.decisionCount);
    expect(copy.chapters.map((chapter) => chapter.id)).not.toContain("second");
    expect(
      copy.chapters.every((chapter) => !detail.chapters.some((c) => c.id === chapter.id))
    ).toBe(true);
    const copied = decisionRepository.list(copy.id);
    expect(
      copied.map(({ positionKey, acceptedUcis, acceptanceFingerprint }) => ({
        positionKey,
        acceptedUcis,
        acceptanceFingerprint
      }))
    ).toEqual(
      original.map(({ positionKey, acceptedUcis, acceptanceFingerprint }) => ({
        positionKey,
        acceptedUcis,
        acceptanceFingerprint
      }))
    );
    expect(positionIndexRepository.list(copy.id).filter((row) => row.isDecision).length).toBe(
      positionIndexRepository.list(detail.id).filter((row) => row.isDecision).length
    );
    expect(progressRepository.list(copy.id)).toEqual([]);
    const second = copy.chapters.find((chapter) => chapter.title === "Chapter second")!;
    expect(copy.workspace).toMatchObject({ lastChapterId: second.id, lastNodeId: "n2" });
    const links = service
      .listGameLinks({ repertoireId: copy.id })
      .sort((a, b) => a.kind.localeCompare(b.kind));
    expect(links.map((link) => [link.kind, link.gameId, link.chapterId])).toEqual([
      ["model", "game-kept", copy.chapters.find((c) => c.title !== "Chapter second")!.id],
      ["played", null, second.id]
    ]);
    expect(sent).toEqual([
      {
        channel: "repertoires:changed",
        payload: { repertoireId: copy.id, revision: 1, kind: "created" }
      }
    ]);
    // The source is untouched.
    expect(service.getRepertoire(detail.id).revision).toBe(detail.revision);
  });

  it("restores progress only with includeProgress", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    const preview = (await service.previewBackupImport({ json: text }))!;
    const result = service.restoreBackup({
      jobId: preview.jobId,
      selections: [
        { sourceId: detail.id, mode: "new-copy", includeProgress: true, newName: "With progress" }
      ]
    });
    const copyId = result.restored[0].repertoireId;
    expect(service.getRepertoire(copyId).name).toBe("With progress");
    const strip = (rows: ReturnType<typeof progressRepository.list>) =>
      rows.map((row) => ({ ...row, repertoireId: "" }));
    expect(strip(progressRepository.list(copyId))).toEqual(
      strip(progressRepository.list(detail.id))
    );
  });

  it("replaces an existing repertoire after writing its own backup, bumping the revision", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    // Edit the stored repertoire after the backup: drop the second chapter.
    const edited = service.removeChapter({
      repertoireId: detail.id,
      chapterId: "second",
      expectedRevision: detail.revision
    }).repertoire;
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(preview.repertoires[0].diff).toMatchObject({ chaptersAdded: 1, chaptersRemoved: 0 });
    now += 1_000;
    sent.length = 0;
    const result = service.restoreBackup({
      jobId: preview.jobId,
      selections: [
        {
          sourceId: detail.id,
          mode: "replace",
          includeProgress: true,
          expectedRevision: edited.revision
        }
      ]
    });
    const restored = result.restored[0];
    expect(restored.repertoireId).toBe(detail.id);
    expect(restored.retainedBackupPath).toMatch(
      new RegExp(`repertoire-backups/${detail.id}-.*\\.json$`)
    );
    const retained = JSON.parse(readFileSync(restored.retainedBackupPath!, "utf8"));
    expect(retained.repertoires[0].repertoire.revision).toBe(edited.revision);
    expect(retained.repertoires[0].chapters).toHaveLength(1);

    const after = service.getRepertoire(detail.id);
    expect(after.revision).toBe(edited.revision + 1);
    expect(after.chapters.map((chapter) => chapter.id)).toContain("second");
    expect(after.decisionCount).toBe(detail.decisionCount);
    expect(progressRepository.list(detail.id)).toHaveLength(1);
    expect(sent).toEqual([
      {
        channel: "repertoires:changed",
        payload: { repertoireId: detail.id, revision: edited.revision + 1, kind: "updated" }
      }
    ]);
    const again = (await service.previewBackupImport({ json: text }))!;
    expect(again.repertoires[0].diff).toEqual({
      chaptersAdded: 0,
      chaptersChanged: 0,
      chaptersRemoved: 0,
      decisionsChanged: 0,
      progressEntries: 1
    });
  });

  it("writes nothing on a stale expectedRevision and keeps the job for a retry", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    const preview = (await service.previewBackupImport({ json: text }))!;
    const replace = (expectedRevision: number) =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [
          { sourceId: detail.id, mode: "replace", includeProgress: false, expectedRevision }
        ]
      });
    sent.length = 0;
    expect(() => replace(detail.revision - 1)).toThrow(
      /^Invalid expectedRevision: repertoire changed/i
    );
    expect(existsSync(join(userData, "repertoire-backups"))).toBe(false);
    expect(service.getRepertoire(detail.id).revision).toBe(detail.revision);
    expect(sent).toEqual([]);
    expect(replace(detail.revision).restored[0].mode).toBe("replace");
  });

  it("aborts the whole restore on an illegal tree, before any write", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const document = JSON.parse(text) as RepertoireBackupDocument;
    const chapter = document.repertoires[0].chapters[1];
    chapter.tree[1].uci = "e2e5";
    const preview = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: false }]
      })
    ).toThrow(`Invalid backup: chapter "Chapter second" can't be restored (chapter tree:`);
    expect(service.listRepertoires()).toHaveLength(1);
  });

  it("requires an existing repertoire and a revision to replace", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "replace", includeProgress: false }]
      })
    ).toThrow("Invalid expectedRevision: required to replace a repertoire");
    service.removeRepertoire({ id: detail.id, expectedRevision: detail.revision });
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [
          { sourceId: detail.id, mode: "replace", includeProgress: false, expectedRevision: 1 }
        ]
      })
    ).toThrow(/has no repertoire in this library to replace/);
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: "other", mode: "new-copy", includeProgress: false }]
      })
    ).toThrow('Invalid selections: "other" is not in this backup');
  });
});
