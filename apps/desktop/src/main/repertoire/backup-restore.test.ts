import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RepertoireBackupDocument,
  RestoreBackupSelection
} from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { backupHelpers, chapterOf, replaceSelection } from "./__fixtures__/backup-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/backup-env"));
vi.mock("electron", () => env.electronModule);
vi.mock("./backup-restore-runner", async (importOriginal) =>
  env.inThreadRestores(await importOriginal<typeof import("./backup-restore-runner")>())
);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const {
  chapterRepository,
  decisionRepository,
  positionIndexRepository,
  progressRepository,
  repertoireRepository
} = await import("./repository");
const { reindex } = await import("./core");
const { insertLibraryGame, seed, exportText } = backupHelpers(service, getDb);
const { userData, files, sent, showOpenDialog, showSaveDialog } = env;

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);

describe("native backup: restore", () => {
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

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("restores a new copy with fresh ids, the same decisions and a rebuilt index", async () => {
    const detail = seed();
    const original = decisionRepository.list(detail.id);
    const { text } = await exportText(true);
    getDb().prepare("DELETE FROM games WHERE id = ?").run("game-gone");
    const preview = (await service.previewBackupImport({ json: text }))!;
    sent.length = 0;
    const result = await service.restoreBackup({
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
    ).toStrictEqual(
      original.map(({ positionKey, acceptedUcis, acceptanceFingerprint }) => ({
        positionKey,
        acceptedUcis,
        acceptanceFingerprint
      }))
    );
    expect(positionIndexRepository.list(copy.id).filter((row) => row.isDecision)).toHaveLength(
      positionIndexRepository.list(detail.id).filter((row) => row.isDecision).length
    );
    expect(progressRepository.list(copy.id)).toStrictEqual([]);
    const second = copy.chapters.find((chapter) => chapter.title === "Chapter second")!;
    expect(copy.workspace).toMatchObject({ lastChapterId: second.id, lastNodeId: "n2" });
    const links = service
      .listGameLinks({ repertoireId: copy.id })
      .sort((a, b) => a.kind.localeCompare(b.kind));
    expect(links.map((link) => [link.kind, link.gameId, link.chapterId])).toStrictEqual([
      ["model", "game-kept", copy.chapters.find((c) => c.title !== "Chapter second")!.id],
      ["played", null, second.id]
    ]);
    expect(sent).toStrictEqual([
      {
        channel: "repertoires:changed",
        payload: { repertoireId: copy.id, revision: 1, kind: "created" }
      }
    ]);
    // The source is untouched.
    expect(service.getRepertoire(detail.id).revision).toBe(detail.revision);
  });

  it("writes the derived state a reindex of the restored chapters makes, planned before it locks", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    const restore = async (selection: RestoreBackupSelection) => {
      const preview = (await service.previewBackupImport({ json: text }))!;
      return (await service.restoreBackup({ jobId: preview.jobId, selections: [selection] }))
        .restored[0].repertoireId;
    };
    const copyId = await restore({ sourceId: detail.id, mode: "new-copy", includeProgress: true });
    const replacedId = await restore({
      sourceId: detail.id,
      mode: "replace",
      includeProgress: true,
      expectedRevision: detail.revision
    });
    for (const id of [copyId, replacedId]) {
      const index = positionIndexRepository.list(id);
      const decisions = decisionRepository.list(id);
      const progress = progressRepository.list(id);
      expect(index.length).toBeGreaterThan(0);
      expect(reindex(repertoireRepository.get(id)!, now)).toStrictEqual({
        decisionsChanged: 0,
        progressChanged: false
      });
      expect(positionIndexRepository.list(id)).toStrictEqual(index);
      expect(decisionRepository.list(id)).toStrictEqual(decisions);
      expect(progressRepository.list(id)).toStrictEqual(progress);
    }
  });

  it("restores progress only with includeProgress", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    const preview = (await service.previewBackupImport({ json: text }))!;
    const result = await service.restoreBackup({
      jobId: preview.jobId,
      selections: [
        { sourceId: detail.id, mode: "new-copy", includeProgress: true, newName: "With progress" }
      ]
    });
    const copyId = result.restored[0].repertoireId;
    expect(service.getRepertoire(copyId).name).toBe("With progress");
    const strip = (rows: ReturnType<typeof progressRepository.list>) =>
      rows.map((row) => ({ ...row, repertoireId: "" }));
    expect(strip(progressRepository.list(copyId))).toStrictEqual(
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
    const result = await service.restoreBackup({
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
    const retained = JSON.parse(readFileSync(restored.retainedBackupPath!, "utf8")) as {
      repertoires: { repertoire: { revision: number }; chapters: unknown[] }[];
    };
    expect(retained.repertoires[0].repertoire.revision).toBe(edited.revision);
    expect(retained.repertoires[0].chapters).toHaveLength(1);
    // Practice history is kept beside the retained backup only, as raw rows, so it can't make the
    // backup too large to restore.
    expect(retained.repertoires[0]).not.toHaveProperty("history");
    const history = JSON.parse(
      readFileSync(restored.retainedBackupPath!.replace(/\.json$/, ".history.json"), "utf8")
    ) as { sessions: unknown[]; attempts: unknown[] };
    expect(history).toMatchObject({
      format: "chaturanga-repertoire-practice-history",
      repertoireId: detail.id
    });
    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]).toHaveProperty("queue_json");
    expect(history.attempts).toHaveLength(1);
    expect(history.attempts[0]).toMatchObject({ attempt_id: "a1" });
    // The retained backup is one Restore from backup reads.
    await expect(
      service.previewBackupImport({ json: readFileSync(restored.retainedBackupPath!, "utf8") })
    ).resolves.toMatchObject({ repertoires: [{ sourceId: detail.id }] });

    const after = service.getRepertoire(detail.id);
    expect(after.revision).toBe(edited.revision + 1);
    expect(after.chapters.map((chapter) => chapter.id)).toContain("second");
    expect(after.decisionCount).toBe(detail.decisionCount);
    expect(progressRepository.list(detail.id)).toHaveLength(1);
    expect(sent).toStrictEqual([
      {
        channel: "repertoires:changed",
        payload: { repertoireId: detail.id, revision: edited.revision + 1, kind: "updated" }
      }
    ]);
    const again = (await service.previewBackupImport({ json: text }))!;
    expect(again.repertoires[0].diff).toStrictEqual({
      chaptersAdded: 0,
      chaptersChanged: 0,
      chaptersRemoved: 0,
      decisionsChanged: 0,
      progressEntries: 1,
      progressDiscarded: 1,
      sessionsDiscarded: 0,
      linksAdded: 0,
      linksRemoved: 0,
      metadataChanged: []
    });
  });

  it("keeps decisions no chapter reaches, so a backup of an edited library diffs empty", async () => {
    const detail = seed();
    service.removeChapter({
      repertoireId: detail.id,
      chapterId: "second",
      expectedRevision: detail.revision
    });
    const stored = decisionRepository.list(detail.id);
    const { text } = await exportText(true);
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(preview.warnings).toStrictEqual([]);
    expect(preview.repertoires[0].diff).toMatchObject({
      chaptersAdded: 0,
      chaptersChanged: 0,
      chaptersRemoved: 0,
      decisionsChanged: 0
    });
    const copyId = (
      await service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: true }]
      })
    ).restored[0].repertoireId;
    expect(decisionRepository.list(copyId)).toHaveLength(stored.length);
  });

  it("lowercases preferred moves and wrong-move feedback keys", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const document = JSON.parse(text) as RepertoireBackupDocument;
    const decision = document.repertoires[0].decisions.find(
      (item) => item.positionKey === positionKey(START_FEN)
    )!;
    const accepted = decision.acceptedUcis;
    decision.acceptedUcis = accepted.map((uci) => uci.toUpperCase());
    decision.preferredUci = "E2E4";
    decision.wrongMoveFeedback = { D2D4: "Not today" };
    const preview = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    const copyId = (
      await service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: false }]
      })
    ).restored[0].repertoireId;
    expect(decisionRepository.get(copyId, positionKey(START_FEN))).toMatchObject({
      acceptedUcis: accepted,
      preferredUci: "e2e4",
      wrongMoveFeedback: { d2d4: "Not today" }
    });
  });

  it("refuses to replace a repertoire of the other color or with a session in progress", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const document = JSON.parse(text) as RepertoireBackupDocument;
    document.repertoires[0].repertoire.color = "black";
    const black = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    expect(black.repertoires[0].diff?.metadataChanged).toStrictEqual(["color"]);
    await expect(
      service.restoreBackup({
        jobId: black.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).rejects.toThrow(
      'Invalid backup: "Open games" is a white repertoire in this library; restore it as a new copy'
    );

    const session = service.startPractice({ repertoireId: detail.id, mode: "learn-new" });
    const preview = (await service.previewBackupImport({ json: text }))!;
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).rejects.toThrow(
      'Invalid selections: "Open games" has a practice session in progress; end it first'
    );
    expect(existsSync(join(userData, "repertoire-backups"))).toBe(false);
    service.endPractice(session.sessionId);
    expect(
      (
        await service.restoreBackup({
          jobId: preview.jobId,
          selections: [replaceSelection(detail.id, detail.revision)]
        })
      ).restored[0].mode
    ).toBe("replace");
  });

  it("creates retained backups exclusively and keeps the newest ten per repertoire", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const directory = join(userData, "repertoire-backups");
    mkdirSync(directory, { recursive: true });
    const stamp = (time: number) => new Date(time).toISOString().replace(/[:.]/g, "-");
    for (let index = 1; index <= 11; index += 1) {
      writeFileSync(join(directory, `${detail.id}-${stamp(now - index * 60_000)}.json`), "{}");
    }
    const other = `${detail.id}-other-${stamp(now - 3_600_000)}.json`;
    writeFileSync(join(directory, other), "{}");
    // A file already holds the name this replace would use: the retained one gets a suffix.
    const taken = `${detail.id}-${stamp(now)}.json`;
    writeFileSync(join(directory, taken), "taken");
    const preview = (await service.previewBackupImport({ json: text }))!;
    const path = (
      await service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, detail.revision, false)]
      })
    ).restored[0].retainedBackupPath!;
    expect(path).toMatch(new RegExp(`${detail.id}-${stamp(now)}-[A-Za-z0-9_-]+\\.json$`));
    expect(readFileSync(join(directory, taken), "utf8")).toBe("taken");
    const names = readdirSync(directory);
    expect(names).toContain(other);
    // Each retained backup keeps its practice history beside it; pruning removes both.
    expect(names.filter((name) => name.endsWith(".history.json"))).toStrictEqual([
      path
        .split("/")
        .pop()!
        .replace(/\.json$/, ".history.json")
    ]);
    const own = names
      .filter((name) => name !== other)
      .filter((name) => !name.endsWith(".history.json"));
    expect(own).toHaveLength(10);
    expect(own).toContain(taken);
    expect(own.some((name) => path.endsWith(name))).toBe(true);
    expect(own).not.toContain(`${detail.id}-${stamp(now - 11 * 60_000)}.json`);
    expect(own).not.toContain(`${detail.id}-${stamp(now - 10 * 60_000)}.json`);
  });

  it("refuses a replace whose own backup couldn't be restored, before deleting anything", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    // More chapters than a restore accepts, written straight to storage.
    for (let index = 0; index < 1_000; index += 1) {
      chapterRepository.upsert(
        detail.id,
        { ...chapterOf(`bulk-${index}`, [["e2e4"]]), sortOrder: index + 2 },
        now
      );
    }
    const preview = (await service.previewBackupImport({ json: text }))!;
    const current = service.getRepertoire(detail.id);
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, current.revision, false)]
      })
    ).rejects.toThrow(
      /can't be replaced because its own backup couldn't be restored \(it has 1,002 chapters/
    );
    expect(service.getRepertoire(detail.id).chapters).toHaveLength(1_002);
    expect(() => readdirSync(join(userData, "repertoire-backups"))).toThrow(/ENOENT/);
  });

  it("counts game links a replace adds or removes in the preview", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    service.removeGameLink({
      repertoireId: detail.id,
      linkId: service.listGameLinks({ repertoireId: detail.id })[0].id
    });
    insertLibraryGame("game-new");
    service.linkGame({
      repertoireId: detail.id,
      chapterId: "second",
      gameId: "game-new",
      gameNodeId: null,
      kind: "model",
      capturedPath: ""
    });
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(preview.repertoires[0].diff).toMatchObject({
      chaptersAdded: 0,
      chaptersChanged: 0,
      chaptersRemoved: 0,
      decisionsChanged: 0,
      linksAdded: 1,
      linksRemoved: 1
    });
    expect(preview.repertoires[0].existing).toMatchObject({ color: "white" });
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
    await expect(replace(detail.revision - 1)).rejects.toThrow(
      /^Invalid expectedRevision: repertoire changed/i
    );
    expect(existsSync(join(userData, "repertoire-backups"))).toBe(false);
    expect(service.getRepertoire(detail.id).revision).toBe(detail.revision);
    expect(sent).toStrictEqual([]);
    expect((await replace(detail.revision)).restored[0].mode).toBe("replace");
  });

  it("aborts the whole restore on an illegal tree, before any write", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const document = JSON.parse(text) as RepertoireBackupDocument;
    const chapter = document.repertoires[0].chapters[1];
    chapter.tree[1].uci = "e2e5";
    const preview = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: false }]
      })
    ).rejects.toThrow(`Invalid backup: chapter "Chapter second" can't be restored (chapter tree:`);
    expect(service.listRepertoires()).toHaveLength(1);
  });

  it("requires an existing repertoire and a revision to replace", async () => {
    const detail = seed();
    const { text } = await exportText(false);
    const preview = (await service.previewBackupImport({ json: text }))!;
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "replace", includeProgress: false }]
      })
    ).rejects.toThrow("Invalid expectedRevision: required to replace a repertoire");
    service.removeRepertoire({ id: detail.id, expectedRevision: detail.revision });
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [
          { sourceId: detail.id, mode: "replace", includeProgress: false, expectedRevision: 1 }
        ]
      })
    ).rejects.toThrow(/has no repertoire in this library to replace/);
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: "other", mode: "new-copy", includeProgress: false }]
      })
    ).rejects.toThrow('Invalid selections: "other" is not in this backup');
  });
});
