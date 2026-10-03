import { describe, expect, it } from "vitest";
import type {
  BackupImportPreview,
  BackupImportPreviewRepertoire
} from "@chaturanga/shared/types/repertoire";
import {
  backupSummary,
  backupWarningsNotice,
  buildRestoreInput,
  formatBytes,
  initialRestoreRows,
  isStaleRevisionError,
  replacedDirtyDraftName,
  restoreDiffLine,
  restoreLossLines,
  restoreMetadataLine,
  restoreNotice,
  restoreRowsReducer,
  shortenPath
} from "./backup";

function entry(patch: Partial<BackupImportPreviewRepertoire> = {}): BackupImportPreviewRepertoire {
  return {
    sourceId: "rep-1",
    name: "My 1.e4",
    color: "white",
    chapterCount: 4,
    decisionCount: 20,
    hasProgress: true,
    existing: null,
    diff: null,
    ...patch
  };
}

const existing = { id: "rep-2", name: "Black vs e4", revision: 7, color: "black" as const };
const diff = {
  chaptersAdded: 2,
  chaptersChanged: 1,
  chaptersRemoved: 0,
  decisionsChanged: 5,
  progressEntries: 40,
  progressDiscarded: 12,
  sessionsDiscarded: 3,
  linksAdded: 0,
  linksRemoved: 0,
  metadataChanged: [] as string[]
};

function previewOf(...repertoires: BackupImportPreviewRepertoire[]): BackupImportPreview {
  return {
    jobId: "job-1",
    formatVersion: 1,
    exportedAt: 0,
    app: { name: "Chaturanga", version: "1.0.0" },
    repertoires,
    warnings: []
  };
}

const preview = previewOf(
  entry(),
  entry({
    sourceId: "rep-2",
    name: "Black vs e4",
    color: "black",
    hasProgress: false,
    existing,
    diff
  })
);

describe("restore rows", () => {
  it("starts with everything included as a new copy, with progress when the backup has it", () => {
    expect(initialRestoreRows(preview)).toEqual([
      {
        sourceId: "rep-1",
        include: true,
        mode: "new-copy",
        includeProgress: true,
        newName: "My 1.e4 (restored)"
      },
      {
        sourceId: "rep-2",
        include: true,
        mode: "new-copy",
        includeProgress: false,
        newName: "Black vs e4 (restored)"
      }
    ]);
  });

  it("toggles include, progress and name on the addressed row only", () => {
    let rows = initialRestoreRows(preview);
    rows = restoreRowsReducer(preview, rows, {
      type: "include",
      sourceId: "rep-1",
      include: false
    });
    rows = restoreRowsReducer(preview, rows, {
      type: "progress",
      sourceId: "rep-1",
      includeProgress: false
    });
    rows = restoreRowsReducer(preview, rows, { type: "name", sourceId: "rep-1", newName: "Mine" });
    expect(rows[0]).toMatchObject({ include: false, includeProgress: false, newName: "Mine" });
    expect(rows[1]).toEqual(initialRestoreRows(preview)[1]);
  });

  it("only replaces a repertoire that exists here", () => {
    const rows = initialRestoreRows(preview);
    const refused = restoreRowsReducer(preview, rows, {
      type: "mode",
      sourceId: "rep-1",
      mode: "replace"
    });
    expect(refused).toEqual(rows);
    const allowed = restoreRowsReducer(preview, rows, {
      type: "mode",
      sourceId: "rep-2",
      mode: "replace"
    });
    expect(allowed[1]?.mode).toBe("replace");
  });

  it("can't replace a repertoire of the other color", () => {
    const other = previewOf(
      entry({ existing, diff: { ...diff, metadataChanged: ["name", "color"] } })
    );
    const rows = initialRestoreRows(other);
    expect(
      restoreRowsReducer(other, rows, { type: "mode", sourceId: "rep-1", mode: "replace" })
    ).toEqual(rows);
  });

  it("can't replace a repertoire of the other color even when it has no diff (damaged)", () => {
    const damaged = previewOf(entry({ existing, diff: null, damaged: true }));
    const rows = initialRestoreRows(damaged);
    expect(
      restoreRowsReducer(damaged, rows, { type: "mode", sourceId: "rep-1", mode: "replace" })
    ).toEqual(rows);
    const sameColor = previewOf(
      entry({ existing: { ...existing, color: "white" }, diff: null, damaged: true })
    );
    expect(
      restoreRowsReducer(sameColor, initialRestoreRows(sameColor), {
        type: "mode",
        sourceId: "rep-1",
        mode: "replace"
      })[0]?.mode
    ).toBe("replace");
  });

  it("keeps choices on a refreshed preview unless it no longer allows them", () => {
    let rows = initialRestoreRows(preview);
    rows = restoreRowsReducer(preview, rows, { type: "mode", sourceId: "rep-2", mode: "replace" });
    rows = restoreRowsReducer(preview, rows, { type: "name", sourceId: "rep-1", newName: "Mine" });
    const same = restoreRowsReducer(preview, rows, { type: "refresh", preview });
    expect(same).toEqual(rows);
    const gone = previewOf(entry({ hasProgress: false }), entry({ sourceId: "rep-2" }));
    expect(restoreRowsReducer(preview, rows, { type: "refresh", preview: gone })).toEqual([
      { ...rows[0], includeProgress: false },
      { ...rows[1], mode: "new-copy" }
    ]);
  });

  it("can't restore progress the backup doesn't have", () => {
    const rows = initialRestoreRows(preview);
    const next = restoreRowsReducer(preview, rows, {
      type: "progress",
      sourceId: "rep-2",
      includeProgress: true
    });
    expect(next[1]?.includeProgress).toBe(false);
  });

  it("ignores unknown repertoires and resets from a new preview", () => {
    const rows = initialRestoreRows(preview);
    expect(
      restoreRowsReducer(preview, rows, { type: "include", sourceId: "nope", include: false })
    ).toBe(rows);
    const other = previewOf(entry({ sourceId: "x", name: "X" }));
    expect(restoreRowsReducer(preview, rows, { type: "reset", preview: other })).toEqual(
      initialRestoreRows(other)
    );
  });
});

describe("buildRestoreInput", () => {
  it("sends expectedRevision only for a replace, and a trimmed or default name for a copy", () => {
    let rows = initialRestoreRows(preview);
    rows = restoreRowsReducer(preview, rows, { type: "name", sourceId: "rep-1", newName: "  A  " });
    rows = restoreRowsReducer(preview, rows, { type: "mode", sourceId: "rep-2", mode: "replace" });
    expect(buildRestoreInput(preview, rows)).toEqual({
      jobId: "job-1",
      selections: [
        { sourceId: "rep-1", mode: "new-copy", includeProgress: true, newName: "A" },
        { sourceId: "rep-2", mode: "replace", includeProgress: false, expectedRevision: 7 }
      ]
    });
    rows = restoreRowsReducer(preview, rows, { type: "name", sourceId: "rep-1", newName: "   " });
    expect(buildRestoreInput(preview, rows).selections[0]?.newName).toBe("My 1.e4 (restored)");
  });

  it("leaves out excluded rows and prefers re-read revisions", () => {
    let rows = initialRestoreRows(preview);
    rows = restoreRowsReducer(preview, rows, {
      type: "include",
      sourceId: "rep-1",
      include: false
    });
    rows = restoreRowsReducer(preview, rows, { type: "mode", sourceId: "rep-2", mode: "replace" });
    const input = buildRestoreInput(preview, rows, new Map([["rep-2", 9]]));
    expect(input.selections).toEqual([
      { sourceId: "rep-2", mode: "replace", includeProgress: false, expectedRevision: 9 }
    ]);
  });

  it("falls back to a new copy when the repertoire to replace isn't here", () => {
    const rows = initialRestoreRows(preview).map((row) => ({ ...row, mode: "replace" as const }));
    expect(buildRestoreInput(preview, rows).selections[0]).toEqual({
      sourceId: "rep-1",
      mode: "new-copy",
      includeProgress: true,
      newName: "My 1.e4 (restored)"
    });
  });
});

describe("formatting", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3.25 * 1024 * 1024)).toBe("3.3 MB");
    expect(formatBytes(200 * 1024)).toBe("200 KB");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("shortens long paths to their start and file name", () => {
    expect(shortenPath("/tmp/a.json")).toBe("/tmp/a.json");
    const long = "/Users/someone/Library/Application Support/Chaturanga/backups/2026/rep.json";
    const short = shortenPath(long, 40);
    expect(short.length).toBeLessThanOrEqual(40);
    expect(short.startsWith("/Users")).toBe(true);
    expect(short.endsWith("/…/rep.json")).toBe(true);
  });

  it("summarises a backup", () => {
    expect(backupSummary([{ chapterCount: 4 }, { chapterCount: 8 }, { chapterCount: 0 }])).toBe(
      "3 repertoires · 12 chapters"
    );
    expect(backupSummary([{ chapterCount: 1 }])).toBe("1 repertoire · 1 chapter");
  });

  it("describes what replacing changes", () => {
    expect(restoreDiffLine(diff, true)).toBe(
      "+2 chapters · 1 changed · −0 · 5 decisions changed · 40 progress entries"
    );
    expect(restoreDiffLine({ ...diff, chaptersAdded: 1, progressEntries: 1 }, true)).toBe(
      "+1 chapter · 1 changed · −0 · 5 decisions changed · 1 progress entry"
    );
    expect(restoreDiffLine(diff, false)).toBe("+2 chapters · 1 changed · −0 · 5 decisions changed");
    expect(restoreDiffLine({ ...diff, linksRemoved: 2 }, false)).toBe(
      "+2 chapters · 1 changed · −0 · 5 decisions changed · game links +0 −2"
    );
  });

  it("says what a replace discards", () => {
    expect(restoreLossLines(diff, false)).toEqual([
      "Current progress (12 progress entries) is discarded",
      "3 practice sessions and their history are discarded"
    ]);
    expect(restoreLossLines({ ...diff, progressDiscarded: 1, sessionsDiscarded: 1 }, true)).toEqual(
      [
        "Current progress (1 progress entry) is replaced by the backup's",
        "1 practice session and its history is discarded"
      ]
    );
    expect(
      restoreLossLines({ ...diff, progressDiscarded: 0, sessionsDiscarded: 0 }, false)
    ).toEqual([]);
  });

  it("names changed repertoire fields", () => {
    expect(restoreMetadataLine(diff)).toBeNull();
    expect(restoreMetadataLine({ ...diff, metadataChanged: ["name"] })).toBe(
      "Also changes its name"
    );
    expect(
      restoreMetadataLine({ ...diff, metadataChanged: ["name", "description", "archivedAt"] })
    ).toBe("Also changes its name, notes and archived state");
  });

  it("finds the dirty study draft a replace would overwrite", () => {
    const input = {
      jobId: "job-1",
      selections: [
        { sourceId: "rep-2", mode: "replace" as const, includeProgress: false, expectedRevision: 7 }
      ]
    };
    expect(replacedDirtyDraftName(preview, input, { repertoireId: "rep-2", dirty: true })).toBe(
      "Black vs e4"
    );
    expect(replacedDirtyDraftName(preview, input, { repertoireId: "rep-2", dirty: false })).toBe(
      null
    );
    expect(replacedDirtyDraftName(preview, input, { repertoireId: "rep-1", dirty: true })).toBe(
      null
    );
    const copy = {
      ...input,
      selections: [{ sourceId: "rep-2", mode: "new-copy" as const, includeProgress: false }]
    };
    expect(replacedDirtyDraftName(preview, copy, { repertoireId: "rep-2", dirty: true })).toBe(
      null
    );
  });

  it("maps warnings to a notice", () => {
    expect(backupWarningsNotice([])).toBeNull();
    expect(backupWarningsNotice(["  ", ""])).toBeNull();
    expect(backupWarningsNotice(["Unknown game link dropped"])).toEqual({
      title: "This backup has a warning",
      lines: ["Unknown game link dropped"]
    });
    expect(backupWarningsNotice(["a", " a ", "b"])).toEqual({
      title: "This backup has 2 warnings",
      lines: ["a", "b"]
    });
  });

  it("recognises a stale-revision refusal", () => {
    expect(
      isStaleRevisionError("Invalid expectedRevision: repertoire changed (stored 8, expected 7)")
    ).toBe(true);
    expect(isStaleRevisionError("Invalid expectedRevision: required to replace a repertoire")).toBe(
      false
    );
    expect(isStaleRevisionError("Invalid backup: chapter revision is not a number")).toBe(false);
  });

  it("lists restored names and retained backups", () => {
    const input = {
      jobId: "job-1",
      selections: [
        { sourceId: "rep-1", mode: "new-copy" as const, includeProgress: true, newName: "A" },
        { sourceId: "rep-2", mode: "replace" as const, includeProgress: false, expectedRevision: 7 }
      ]
    };
    const notice = restoreNotice(preview, input, {
      restored: [
        { sourceId: "rep-1", repertoireId: "new", mode: "new-copy", retainedBackupPath: null },
        {
          sourceId: "rep-2",
          repertoireId: "rep-2",
          mode: "replace",
          retainedBackupPath: "/b/rep-2.json"
        }
      ]
    });
    expect(notice).toEqual({
      text: "Restored “A” and “Black vs e4”.",
      details: ["Previous “Black vs e4” saved to /b/rep-2.json"]
    });
  });

  it("names a replaced repertoire as the backup renames it, and the saved copy by its old name", () => {
    const renamed = previewOf(entry({ sourceId: "rep-2", name: "Sicilian", existing, diff }));
    const notice = restoreNotice(
      renamed,
      {
        jobId: "job-1",
        selections: [
          { sourceId: "rep-2", mode: "replace", includeProgress: false, expectedRevision: 7 }
        ]
      },
      {
        restored: [
          {
            sourceId: "rep-2",
            repertoireId: "rep-2",
            mode: "replace",
            retainedBackupPath: "/b/rep-2.json"
          }
        ]
      }
    );
    expect(notice).toEqual({
      text: "Restored “Sicilian”.",
      details: ["Previous “Black vs e4” saved to /b/rep-2.json"]
    });
  });
});
