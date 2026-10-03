import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
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
  app: {
    isPackaged: true,
    getPath: () => userData,
    getName: () => "Chaturanga",
    getVersion: () => "9.9.9"
  },
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
const { chapterRepository, decisionRepository, positionIndexRepository, progressRepository } =
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
  // An existing chapter is saved at its stored revision.
  const first = {
    ...chapterOf(created.chapters[0].id, [
      ["e2e4", "e7e5", "g1f3"],
      ["e2e4", "c7c5", "g1f3"]
    ]),
    revision: created.chapters[0].revision
  };
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
  // A finished session: practice history without one in progress (that would block a replace).
  service.endPractice(session.sessionId);
  return service.getRepertoire(created.id);
}

/** The repertoire's one replace selection at `expectedRevision`. */
function replaceSelection(sourceId: string, expectedRevision: number, includeProgress = true) {
  return { sourceId, mode: "replace" as const, includeProgress, expectedRevision };
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
    expect(result).toEqual({
      savedPath: path,
      repertoireCount: 1,
      bytes: Buffer.byteLength(text),
      warnings: []
    });
    expect(existsSync(`${path}.tmp`)).toBe(false);
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

  it("writes a damaged chapter as raw data with a warning, and previews it without a diff", async () => {
    const detail = seed();
    const { text: healthy } = await exportText(true);
    getDb()
      .prepare("UPDATE repertoire_chapters SET tree_json = ? WHERE id = ?")
      .run("{oops", "second");
    const { result, text } = await exportText(true);
    expect(result.warnings).toEqual([
      `Repertoire "Open games": chapter "Chapter second" is damaged (its stored JSON is unreadable); its stored data was written as is and can't be restored`
    ]);
    const written = (JSON.parse(text) as RepertoireBackupDocument).repertoires[0].chapters;
    expect(written.map((chapter) => chapter.damaged?.treeJson ?? null)).toEqual([null, "{oops"]);
    expect(written[1]).toMatchObject({ title: "Chapter second", rootFen: START_FEN, tree: [] });

    // The damaged chapter is left out of a restore; the existing repertoire has no diff.
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(preview.warnings).toEqual([
      `repertoire "Open games": 1 chapter was damaged when backed up and will be left out`
    ]);
    expect(preview.repertoires[0]).toMatchObject({
      chapterCount: 1,
      existing: { id: detail.id },
      diff: null,
      damaged: true
    });
    const copyId = service.restoreBackup({
      jobId: preview.jobId,
      selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: true }]
    }).restored[0].repertoireId;
    expect(service.getRepertoire(copyId).chapterCount).toBe(1);

    // Replacing it with a healthy backup keeps the damaged data in the retained backup.
    const repair = (await service.previewBackupImport({ json: healthy }))!;
    expect(repair.repertoires[0]).toMatchObject({ diff: null, damaged: true });
    const path = service.restoreBackup({
      jobId: repair.jobId,
      selections: [replaceSelection(detail.id, detail.revision)]
    }).restored[0].retainedBackupPath!;
    const retained = JSON.parse(readFileSync(path, "utf8")) as RepertoireBackupDocument;
    expect(retained.repertoires[0].chapters[1].damaged?.treeJson).toBe("{oops");
    expect(service.getRepertoire(detail.id).chapterCount).toBe(2);
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
  it("refuses a backup a restore would refuse, such as too many repertoires", async () => {
    for (let index = 0; index < 101; index += 1) {
      service.createRepertoire({ name: `R${index}`, color: "white" });
    }
    await expect(service.exportBackup({ includeProgress: false })).rejects.toThrow(
      "Invalid export: the backup couldn't be restored (it has 101 repertoires; at most 100 can be restored at once); back up fewer repertoires at once"
    );
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
        existing: { id: detail.id, name: "Open games", revision: detail.revision, color: "white" },
        diff: {
          chaptersAdded: 0,
          chaptersChanged: 0,
          chaptersRemoved: 0,
          decisionsChanged: 0,
          progressEntries: 1,
          progressDiscarded: 1,
          sessionsDiscarded: 1,
          linksAdded: 0,
          linksRemoved: 0,
          metadataChanged: []
        }
      }
    ]);
  });

  it("reads a picked file that starts with a byte order mark", async () => {
    seed();
    const { text } = await exportText(true);
    const path = join(files, "bom.json");
    writeFileSync(path, `\uFEFF${text}`, "utf8");
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
    const preview = await service.previewBackupImport({ pickFile: true });
    expect(preview?.repertoires).toHaveLength(1);
  });

  it("says a repertoire has no progress when its progress list is empty", async () => {
    seed();
    const { text } = await exportText(true);
    const document = JSON.parse(text) as RepertoireBackupDocument;
    document.repertoires[0].progress = [];
    const preview = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    expect(preview.repertoires[0].hasProgress).toBe(false);
  });

  it("names changed metadata in the diff", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    service.updateMetadata({
      id: detail.id,
      expectedRevision: detail.revision,
      patch: { name: "Renamed", tags: ["new"] }
    });
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(preview.repertoires[0].diff?.metadataChanged).toEqual(["name", "tags"]);
  });

  it("refreshes a pending preview against the library as it is now", async () => {
    const detail = seed();
    const { text } = await exportText(true);
    const preview = (await service.previewBackupImport({ json: text }))!;
    const edited = service.removeChapter({
      repertoireId: detail.id,
      chapterId: "second",
      expectedRevision: detail.revision
    }).repertoire;
    const fresh = service.refreshBackupPreview(preview.jobId);
    expect(fresh.jobId).toBe(preview.jobId);
    expect(fresh.repertoires[0].existing?.revision).toBe(edited.revision);
    expect(fresh.repertoires[0].diff).toMatchObject({ chaptersAdded: 1 });
    // The refreshed revision restores; the stale one is still refused.
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).toThrow(/^Invalid expectedRevision: repertoire changed/);
    expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, edited.revision)]
      }).restored[0].mode
    ).toBe("replace");
    expect(() => service.refreshBackupPreview(preview.jobId)).toThrow(/Invalid jobId/);
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
    // Practice history is kept beside the retained backup only, as raw rows, so it can't make the
    // backup too large to restore.
    expect(retained.repertoires[0]).not.toHaveProperty("history");
    const history = JSON.parse(
      readFileSync(restored.retainedBackupPath!.replace(/\.json$/, ".history.json"), "utf8")
    );
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
    expect(preview.warnings).toEqual([]);
    expect(preview.repertoires[0].diff).toMatchObject({
      chaptersAdded: 0,
      chaptersChanged: 0,
      chaptersRemoved: 0,
      decisionsChanged: 0
    });
    const copyId = service.restoreBackup({
      jobId: preview.jobId,
      selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: true }]
    }).restored[0].repertoireId;
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
    const copyId = service.restoreBackup({
      jobId: preview.jobId,
      selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: false }]
    }).restored[0].repertoireId;
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
    expect(black.repertoires[0].diff?.metadataChanged).toEqual(["color"]);
    expect(() =>
      service.restoreBackup({
        jobId: black.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).toThrow(
      'Invalid backup: "Open games" is a white repertoire in this library; restore it as a new copy'
    );

    const session = service.startPractice({ repertoireId: detail.id, mode: "learn-new" });
    const preview = (await service.previewBackupImport({ json: text }))!;
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).toThrow('Invalid selections: "Open games" has a practice session in progress; end it first');
    expect(existsSync(join(userData, "repertoire-backups"))).toBe(false);
    service.endPractice(session.sessionId);
    expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      }).restored[0].mode
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
    const path = service.restoreBackup({
      jobId: preview.jobId,
      selections: [replaceSelection(detail.id, detail.revision, false)]
    }).restored[0].retainedBackupPath!;
    expect(path).toMatch(new RegExp(`${detail.id}-${stamp(now)}-[A-Za-z0-9_-]+\\.json$`));
    expect(readFileSync(join(directory, taken), "utf8")).toBe("taken");
    const names = readdirSync(directory);
    expect(names).toContain(other);
    // Each retained backup keeps its practice history beside it; pruning removes both.
    expect(names.filter((name) => name.endsWith(".history.json"))).toEqual([
      path
        .split("/")
        .pop()!
        .replace(/\.json$/, ".history.json")
    ]);
    const own = names.filter((name) => name !== other && !name.endsWith(".history.json"));
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
    expect(() =>
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, current.revision, false)]
      })
    ).toThrow(
      /can't be replaced because its own backup couldn't be restored \(it has 1,002 chapters/
    );
    expect(service.getRepertoire(detail.id).chapters).toHaveLength(1_002);
    expect(() => readdirSync(join(userData, "repertoire-backups"))).toThrow();
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
