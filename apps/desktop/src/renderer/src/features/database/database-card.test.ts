import { describe, expect, it } from "vitest";
import {
  externalDatabaseSources,
  type DatabaseDownloadProgress,
  type ExternalDatabaseSource,
  type InstalledDatabase
} from "@chaturanga/shared/types/database";
import { databaseAction, databaseFacts, downloadProgressText, formatBytes } from "./database-card";

const [puzzles, positions] = externalDatabaseSources as ExternalDatabaseSource[];

const installed = (source: ExternalDatabaseSource, recordCount: number | null) =>
  ({
    id: `db-${source.id}`,
    sourceId: source.id,
    name: source.name,
    provider: source.provider,
    kind: source.kind,
    format: source.format,
    filePath: `/data/${source.id}`,
    fileSizeBytes: 281_440_256,
    recordCount,
    sourceUrl: source.url,
    pageUrl: source.pageUrl,
    license: source.license,
    downloadedAt: new Date(2026, 9, 9).getTime(),
    updatedAt: 0
  }) satisfies InstalledDatabase;

const progress = (
  state: DatabaseDownloadProgress["state"],
  extra: Partial<DatabaseDownloadProgress> = {}
): DatabaseDownloadProgress => ({
  sourceId: puzzles.id,
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
  state,
  ...extra
});

const medium = (date: Date) => date.toLocaleDateString(undefined, { dateStyle: "medium" });

describe("databaseFacts", () => {
  it("before a download: about how many records, the format and the update date", () => {
    const facts = databaseFacts(puzzles, undefined);
    expect(facts.map((fact) => fact.label)).toStrictEqual(["Puzzles", "Format", "Updated"]);
    expect(facts[0]?.value).toMatch(/^About 5[.,]9/);
    expect(facts[1]?.value).toBe("CSV.ZST");
    expect(facts[2]?.value).toBe(medium(new Date(2026, 4, 2)));
  });

  it("leaves out what a source doesn't say instead of showing dashes", () => {
    expect(databaseFacts(positions, undefined)).toStrictEqual([{ label: "Format", value: "CSV" }]);
  });

  it("once downloaded: the records, the size on disk and the download date", () => {
    const facts = databaseFacts(puzzles, installed(puzzles, 5_939_980));
    expect(facts.map((fact) => fact.label)).toStrictEqual(["Puzzles", "On disk", "Downloaded"]);
    expect(facts[0]?.value).toMatch(/^5[.,]9/);
    expect(facts[1]?.value).toBe("268 MB");
    expect(facts[2]?.value).toBe(medium(new Date(2026, 9, 9)));
    // No count from the file or the source: no records fact.
    expect(
      databaseFacts(positions, installed(positions, null)).map((fact) => fact.label)
    ).toStrictEqual(["On disk", "Downloaded"]);
  });
});

describe("databaseAction", () => {
  const base = { source: puzzles, installed: undefined, progress: undefined, starting: false };

  it("offers Download, which reads as starting until the first progress arrives", () => {
    expect(databaseAction(base)).toStrictEqual({ kind: "download", starting: false });
    expect(databaseAction({ ...base, starting: true })).toStrictEqual({
      kind: "download",
      starting: true
    });
  });

  it("shows a running download, even over an installed copy being replaced", () => {
    const running = progress("downloading", { downloadedBytes: 10 });
    expect(databaseAction({ ...base, progress: running })).toStrictEqual({
      kind: "downloading",
      progress: running
    });
    expect(
      databaseAction({ ...base, installed: installed(puzzles, 1), progress: running }).kind
    ).toBe("downloading");
  });

  it("a failed download offers Try again", () => {
    expect(databaseAction({ ...base, progress: progress("failed") })).toStrictEqual({
      kind: "failed"
    });
  });

  it("a finished download keeps its full bar until the list shows it, then offers training", () => {
    const done = progress("completed", { percent: 100 });
    expect(databaseAction({ ...base, progress: done }).kind).toBe("downloading");
    expect(
      databaseAction({ ...base, installed: installed(puzzles, 1), progress: done, starting: true })
    ).toStrictEqual({ kind: "train" });
  });

  it("only puzzle and position sets can be trained with", () => {
    const library: ExternalDatabaseSource = { ...puzzles, kind: "game-library" };
    expect(
      databaseAction({ ...base, source: library, installed: installed(library, 1) })
    ).toStrictEqual({
      kind: "none"
    });
  });
});

describe("downloadProgressText", () => {
  it("bytes of the total and the percent when known; main's message first", () => {
    expect(
      downloadProgressText(
        progress("downloading", {
          downloadedBytes: 118_174_515,
          totalBytes: 281_440_256,
          percent: 42
        })
      )
    ).toBe("Downloading… 113 MB of 268 MB, 42%");
    expect(
      downloadProgressText(
        progress("downloading", { downloadedBytes: 512, message: "Connecting…" })
      )
    ).toBe("Connecting… 512 B");
  });

  it("formats sizes with one decimal below 100 units", () => {
    expect(formatBytes(3_250_586)).toBe("3.1 MB");
    expect(formatBytes(1023)).toBe("1023 B");
  });
});
