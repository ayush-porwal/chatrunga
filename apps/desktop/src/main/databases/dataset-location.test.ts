import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { datasetDir, relocatedDatasetPath, rescueLegacyDatasets } from "./dataset-location";

const roots: string[] = [];
function userData(): string {
  const root = mkdtempSync(join(tmpdir(), "chaturanga-datasets-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("rescueLegacyDatasets", () => {
  it("moves dataset files (and partial downloads) out of Chromium's folder, leaving Chromium's own files", () => {
    const root = userData();
    const legacy = join(root, "databases");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "lichess-puzzles-lichess_db_puzzle.csv.zst"), "data");
    writeFileSync(join(legacy, "chess-position-analysis-results-chess-positions.csv.part"), "partial");
    writeFileSync(join(legacy, "Databases.db"), "chromium");

    expect(rescueLegacyDatasets(root).sort()).toEqual([
      "chess-position-analysis-results-chess-positions.csv.part",
      "lichess-puzzles-lichess_db_puzzle.csv.zst"
    ]);
    expect(readdirSync(datasetDir(root)).sort()).toEqual([
      "chess-position-analysis-results-chess-positions.csv.part",
      "lichess-puzzles-lichess_db_puzzle.csv.zst"
    ]);
    expect(readdirSync(legacy)).toEqual(["Databases.db"]);
  });

  it("does nothing without the old folder, and never overwrites a file already moved", () => {
    const root = userData();
    expect(rescueLegacyDatasets(root)).toEqual([]);
    mkdirSync(join(root, "databases"));
    mkdirSync(datasetDir(root));
    writeFileSync(join(root, "databases", "lichess-puzzles-a.csv.zst"), "old");
    writeFileSync(join(datasetDir(root), "lichess-puzzles-a.csv.zst"), "new");
    expect(rescueLegacyDatasets(root)).toEqual([]);
    expect(existsSync(join(root, "databases", "lichess-puzzles-a.csv.zst"))).toBe(true);
  });
});

describe("relocatedDatasetPath", () => {
  it("maps a path registered in the old folder to the new one", () => {
    const root = "/data";
    expect(relocatedDatasetPath("/data/databases/lichess-puzzles-a.csv.zst", root)).toBe(
      join(datasetDir(root), "lichess-puzzles-a.csv.zst")
    );
    expect(relocatedDatasetPath("/elsewhere/a.csv", root)).toBeNull();
  });
});
