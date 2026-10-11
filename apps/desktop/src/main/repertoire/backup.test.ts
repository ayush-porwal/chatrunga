import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepertoireBackupDocument } from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { backupHelpers, replaceSelection } from "./__fixtures__/backup-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/backup-env"));
vi.mock("electron", () => env.electronModule);
vi.mock("./backup-restore-runner", async (importOriginal) =>
  env.inThreadRestores(await importOriginal<typeof import("./backup-restore-runner")>())
);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { seed, exportText } = backupHelpers(service, getDb);
const { userData, files, sent, showOpenDialog, showSaveDialog } = env;

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);

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
    const copyId = (
      await service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: true }]
      })
    ).restored[0].repertoireId;
    expect(service.getRepertoire(copyId).chapterCount).toBe(1);

    // Replacing it with a healthy backup keeps the damaged data in the retained backup.
    const repair = (await service.previewBackupImport({ json: healthy }))!;
    expect(repair.repertoires[0]).toMatchObject({ diff: null, damaged: true });
    const path = (
      await service.restoreBackup({
        jobId: repair.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).restored[0].retainedBackupPath!;
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
    await expect(
      service.restoreBackup({
        jobId: preview.jobId,
        selections: [replaceSelection(detail.id, detail.revision)]
      })
    ).rejects.toThrow(/^Invalid expectedRevision: repertoire changed/);
    expect(
      (
        await service.restoreBackup({
          jobId: preview.jobId,
          selections: [replaceSelection(detail.id, edited.revision)]
        })
      ).restored[0].mode
    ).toBe("replace");
    expect(() => service.refreshBackupPreview(preview.jobId)).toThrow(/Invalid jobId/);
  });

  it.each([
    ["as exported", ""],
    // Saved again by an editor that adds a byte order mark.
    ["starting with a byte order mark", "\uFEFF"]
  ])(
    "reads a picked file (%s), and returns null when the open dialog is cancelled",
    async (_kind, prefix) => {
      seed();
      const { path, text } = await exportText(false);
      writeFileSync(path, `${prefix}${text}`, "utf8");
      expect(await service.previewBackupImport({ pickFile: true })).toBeNull();
      showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
      const preview = await service.previewBackupImport({ pickFile: true });
      expect(preview?.repertoires[0].hasProgress).toBe(false);
      expect(showOpenDialog.mock.calls[1][0]).toMatchObject({
        properties: ["openFile"],
        filters: [{ name: "Chaturanga backup", extensions: ["json"] }]
      });
    }
  );

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
    const document = JSON.parse(text) as { apiKey?: string; repertoires: { settings?: unknown }[] };
    document.apiKey = "sk-secret";
    document.repertoires[0].settings = { enginePath: "/usr/local/bin/stockfish" };
    const preview = (await service.previewBackupImport({ json: JSON.stringify(document) }))!;
    const result = await service.restoreBackup({
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
    await expect(restoreWith(cancelled.jobId)).rejects.toThrow(
      "Invalid jobId: the backup preview expired or was cancelled; choose the file again"
    );

    const expiring = (await service.previewBackupImport({ json: text }))!;
    now += 30 * 60_000;
    await expect(restoreWith(expiring.jobId)).rejects.toThrow(/Invalid jobId/);

    const jobs: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      jobs.push((await service.previewBackupImport({ json: text }))!.jobId);
    }
    await expect(restoreWith(jobs[0])).rejects.toThrow(/Invalid jobId/);
    expect((await restoreWith(jobs[3])).restored).toHaveLength(1);
  });
});
