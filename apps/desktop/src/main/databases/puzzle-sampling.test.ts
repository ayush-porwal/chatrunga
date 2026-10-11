import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PuzzleSampleInput } from "@chaturanga/shared/types/database";

const fakes = await vi.hoisted(async () => import("./__fixtures__/database-fakes"));
vi.mock("electron", () => ({ app: { getPath: () => fakes.userData } }));
vi.mock("../db/external-database-repository", () => ({
  externalDatabaseRepository: fakes.externalDatabaseRepository
}));
vi.mock("./puzzle-scan", async (importOriginal) =>
  fakes.countingFullScans(await importOriginal<typeof import("./puzzle-scan")>())
);

import { logger } from "../logger";
import { puzzleOfTheDay, samplePuzzle, setPuzzleScanner } from "./puzzle-sampling";
import { workerScanner, type ScanJob } from "./puzzle-scan";
import {
  dailyRecord,
  dir,
  gatedScanner,
  gatedScans,
  inThreadScanner,
  isQuick,
  LICHESS_HEADER,
  releaseGatedScans,
  resetDatabaseFakes,
  SOURCE
} from "./__fixtures__/puzzle-files";

const { fullScans, rows, userData } = fakes;

/** A module instance of its own, for tests that start without the in-memory picks. */
async function freshModule() {
  vi.resetModules();
  return import("./puzzle-sampling");
}

beforeEach(async () => {
  await resetDatabaseFakes();
  setPuzzleScanner(inThreadScanner);
});

afterEach(() => {
  releaseGatedScans();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("samplePuzzle", () => {
  const header =
    "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
  // White to move before the opponent's (White's) e2e4; Black solves with e7e5.
  const row = (id: string, rating: number) =>
    `${id},rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4 e7e5,${rating},80,90,100,short opening,,`;
  const input = (
    overrides: Partial<NonNullable<PuzzleSampleInput["lichess"]>> = {}
  ): PuzzleSampleInput => ({
    databaseId: "puzzles",
    lichess: {
      ratingMin: 0,
      ratingMax: 3000,
      popularityMin: 0,
      lengths: [],
      themes: [],
      openings: [],
      side: "any",
      ...overrides
    }
  });

  async function install(lines: string[]) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "puzzles.csv.zst");
    await writeFile(file, zstdCompressSync(Buffer.from([header, ...lines].join("\n"))));
    rows.set(SOURCE, {
      id: "puzzles",
      sourceId: SOURCE,
      filePath: file,
      name: "Puzzles",
      format: "csv.zst"
    });
  }

  it("reaches puzzles past the file's first matches once the whole-file pool is filled", async () => {
    await install(Array.from({ length: 3000 }, (_, index) => row(`p${index}`, 1500)));
    await samplePuzzle(input());
    const seen = new Set<number>();
    await vi.waitFor(
      async () => {
        const sample = await samplePuzzle(input());
        seen.add(Number(sample.id.slice(1)));
        expect([...seen].some((index) => index >= 500)).toBe(true);
      },
      { timeout: 5_000, interval: 1 }
    );
  });

  it("serves a small match set again to a new session instead of reporting no match", async () => {
    await install([row("a", 2500), row("b", 2500)]);
    const filters = input({ ratingMin: 2000 });
    // Two matches: the quick scan read the whole file, so it holds every match (no full scan).
    const first = await samplePuzzle(filters);
    const second = await samplePuzzle({ ...filters, excludeIds: [first.id] });
    expect(second.id).not.toBe(first.id);
    await expect(samplePuzzle({ ...filters, excludeIds: ["a", "b"] })).rejects.toThrow(
      /No puzzle matched/
    );
    // A new session (nothing excluded) still gets puzzles.
    expect(["a", "b"]).toContain((await samplePuzzle(filters)).id);
  });

  it("reuses a quick scan that read the whole file instead of scanning it again", async () => {
    await install([row("a", 2500), row("b", 2500), row("low", 800)]);
    const filters = input({ ratingMin: 2000 });
    const first = await samplePuzzle(filters);
    expect(["a", "b"]).toContain((await samplePuzzle({ ...filters, excludeIds: [first.id] })).id);
    // No match at all: answered from the first scan from then on.
    await expect(samplePuzzle(input({ ratingMin: 2900 }))).rejects.toThrow(/No puzzle matched/);
    await expect(samplePuzzle(input({ ratingMin: 2900 }))).rejects.toThrow(/No puzzle matched/);
    // A full scan starts within samplePuzzle (requestFullScan), so none started by now means none.
    expect(fullScans.count).toBe(0);
  });

  it("answers a rare filter from one scan of the whole file", async () => {
    await install([
      ...Array.from({ length: 3000 }, (_, index) => row(`p${index}`, 1500)),
      row("rare", 2900)
    ]);
    const filters = input({ ratingMin: 2800 });
    expect((await samplePuzzle(filters)).id).toBe("rare");
    expect((await samplePuzzle(filters)).id).toBe("rare");
    // A full scan starts within samplePuzzle (requestFullScan), so none started by now means none.
    expect(fullScans.count).toBe(0);
  });

  it("serves only the puzzles asked for by id, then says none are left", async () => {
    await install([row("a", 1500), row("b", 2500), row("c", 900), row("d", 1500)]);
    const retry: PuzzleSampleInput = { databaseId: "puzzles", ids: ["d", "b", "gone"] };
    const first = await samplePuzzle(retry);
    const second = await samplePuzzle({ ...retry, excludeIds: [first.id] });
    expect([first.id, second.id].sort()).toEqual(["b", "d"]);
    expect(second.ratingDeviation).toBe(80);
    await expect(samplePuzzle({ ...retry, excludeIds: ["b", "d"] })).rejects.toThrow(
      /No puzzles left to try again/
    );
    // The ids are their own pool: the same file's other requests are unaffected.
    expect(["a", "b", "c", "d"]).toContain((await samplePuzzle(input())).id);
  });

  it("serves nothing for an empty id list, not any puzzle", async () => {
    await install([row("a", 1500), row("b", 2500)]);
    await expect(samplePuzzle({ databaseId: "puzzles", ids: [] })).rejects.toThrow(
      /No puzzles left to try again/
    );
  });

  it("reaches fresh puzzles past the excluded ones at the file's start", async () => {
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1500)));
    const excludeIds = Array.from({ length: 600 }, (_, index) => `p${index}`);
    const sample = await samplePuzzle({ ...input(), excludeIds });
    expect(Number(sample.id.slice(1))).toBeGreaterThanOrEqual(600);
  });

  it("scans in the scanner, never in this thread", async () => {
    const scanner = vi.fn(gatedScanner(() => true));
    setPuzzleScanner(scanner);
    await install([row("a", 1500)]);
    expect((await samplePuzzle(input())).id).toBe("a");
    expect(scanner).toHaveBeenCalledTimes(1);
  });

  it("shares one quick scan between identical requests in flight", async () => {
    // The same draw for both: each must still get its own puzzle from the one shared result.
    vi.spyOn(Math, "random").mockReturnValue(0);
    setPuzzleScanner(gatedScanner());
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1500)));
    const first = samplePuzzle(input());
    const second = samplePuzzle(input());
    await vi.waitFor(() => expect(gatedScans.length).toBe(1));
    // oxlint-disable-next-line chaturanga/no-test-sleep -- an absence check: the second request joining shows no event, only no second scan
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gatedScans.filter(isQuick)).toHaveLength(1);
    gatedScans[0].release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).not.toBe(b.id);
    expect(gatedScans.filter(isQuick)).toHaveLength(1);
  });

  it("stops the quick scan of a request replaced by one with other filters", async () => {
    setPuzzleScanner(gatedScanner());
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1000 + index)));
    const older = samplePuzzle(input({ ratingMin: 1100 }));
    older.catch(() => undefined);
    await vi.waitFor(() => expect(gatedScans.length).toBe(1));
    const newer = samplePuzzle(input({ ratingMin: 1500 }));
    await expect(older).rejects.toThrow(/replaced by a newer one/);
    expect(gatedScans[0].cancelled).toBe(true);
    await vi.waitFor(() => expect(gatedScans.length).toBe(2));
    gatedScans[1].release();
    expect(Number((await newer).id.slice(1))).toBeGreaterThanOrEqual(500);
  });

  it("runs at most two whole-file scans at once", async () => {
    setPuzzleScanner(gatedScanner((job) => job.maxMatches !== undefined));
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1500)));
    for (const ratingMin of [100, 200, 300, 400]) await samplePuzzle(input({ ratingMin }));
    const full = () => gatedScans.filter((scan) => !isQuick(scan));
    expect(full()).toHaveLength(2);
    full()[0].release();
    await vi.waitFor(() => expect(full()).toHaveLength(3));
    // Of the waiting ones, the newest filters are scanned first.
    expect(full().map((scan) => scan.job.input.lichess?.ratingMin)).toEqual([100, 200, 400]);
  });

  it("reports a scanner that fails, distinctly from no match, and works again afterwards", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await install([row("a", 1500)]);
    setPuzzleScanner(workerScanner(join(userData, "no-such-worker.js")));
    await expect(samplePuzzle(input())).rejects.toThrow(
      /Couldn't search Puzzles for puzzles: the puzzle scanner .* is missing/
    );
    setPuzzleScanner(inThreadScanner);
    expect((await samplePuzzle(input())).id).toBe("a");
  });

  it("reports a worker that crashes or exits without an answer", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await install([row("a", 1500)]);
    await mkdir(userData, { recursive: true });
    const crashing = join(userData, "crashing-worker.mjs");
    const silent = join(userData, "silent-worker.mjs");
    await writeFile(crashing, 'throw new Error("boom");');
    await writeFile(silent, "");
    setPuzzleScanner(workerScanner(crashing));
    await expect(samplePuzzle(input({ ratingMin: 1 }))).rejects.toThrow(
      /the puzzle scanner crashed \(boom\)/
    );
    setPuzzleScanner(workerScanner(silent));
    await expect(samplePuzzle(input({ ratingMin: 2 }))).rejects.toThrow(
      /stopped without an answer \(exit code 0\)/
    );
  });

  it("tries a failed whole-file scan again later", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    fullScans.fail = true;
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1500)));
    await samplePuzzle(input());
    await vi.waitFor(() => expect(fullScans.count).toBe(1));
    // The failure is logged once it is recorded (the retry clock starts then).
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
    fullScans.fail = false;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    await samplePuzzle(input());
    await vi.waitFor(() => expect(fullScans.count).toBe(2));
  });

  it("logs a failed whole-file scan once and keeps serving from the quick scan", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    fullScans.fail = true;
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1500)));
    await samplePuzzle(input());
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0])).toMatch(/corrupt block/);
    await samplePuzzle(input());
    await samplePuzzle(input());
    // A retry would start within samplePuzzle (requestFullScan): none did, inside the retry delay.
    expect(fullScans.count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips a malformed row instead of reporting no match", async () => {
    const broken = "bad,not-a-fen,e2e4 e7e5,1500,80,90,100,short,,";
    await install([broken, broken, broken, row("good", 1500)]);
    expect((await samplePuzzle(input())).id).toBe("good");
  });

  it("doesn't let rows too short to make a puzzle fill the sample", async () => {
    // More one-move rows than a quick scan keeps, all before the only real puzzle.
    const oneMove = (id: string) =>
      `${id},rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4,1500,80,90,100,short,,`;
    await install([
      ...Array.from({ length: 600 }, (_, index) => oneMove(`short${index}`)),
      row("good", 1500)
    ]);
    expect((await samplePuzzle(input())).id).toBe("good");
  });

  it("applies the filters and the excluded ids", async () => {
    await install([row("low", 800), row("high", 2500), row("done", 2500)]);
    const sample = await samplePuzzle({ ...input({ ratingMin: 2000 }), excludeIds: ["done"] });
    expect(sample.id).toBe("high");
    expect(sample.sideToMove).toBe("black");
    await expect(
      samplePuzzle({ ...input({ ratingMin: 2000 }), excludeIds: ["done", "high"] })
    ).rejects.toThrow(/No puzzle matched/);
  });
});

describe("puzzleOfTheDay", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const lichessRow = (id: string, rating: number, popularity = 90, plays = 2000) =>
    `${id},${START},e2e4 e7e5,${rating},80,${popularity},${plays},short,,`;
  const positionRow = (id: string, difficulty: number) =>
    `${id},game,1,https://lichess.org/game,${START},e2e4,${difficulty}`;

  async function installFile(sourceId: string, name: string, lines: string[]) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${sourceId}.csv`);
    await writeFile(file, lines.join("\n"));
    rows.set(sourceId, { id: sourceId, sourceId, filePath: file, name, format: "csv" });
  }
  const installLichess = (lines: string[]) =>
    installFile("lichess-puzzles", "Lichess puzzles", [LICHESS_HEADER, ...lines]);
  const installPositions = (lines: string[]) =>
    installFile("chess-position-analysis-results", "Chess positions", [
      "internal_id,lichess_game_id,move_number,lichess_url,fen,best_move,difficulty",
      ...lines
    ]);

  it("is null when no puzzle database is installed", async () => {
    expect(await puzzleOfTheDay({ date: "2026-10-10" })).toBeNull();
  });

  it("gives the same puzzle for a date, and another one on another day", async () => {
    await installLichess(Array.from({ length: 50 }, (_, index) => lichessRow(`p${index}`, 1600)));
    const today = await puzzleOfTheDay({ date: "2026-10-10" });
    expect(today).toMatchObject({ databaseId: "lichess-puzzles", sideToMove: "black" });
    expect((await puzzleOfTheDay({ date: "2026-10-10" }))?.id).toBe(today?.id);
    expect((await puzzleOfTheDay({ date: "2026-10-11" }))?.id).not.toBe(today?.id);
    // Not just remembered: a fresh start without the stored pick picks the same one from the file.
    await rm(dailyRecord);
    const fresh = await freshModule();
    fresh.setPuzzleScanner(inThreadScanner);
    expect((await fresh.puzzleOfTheDay({ date: "2026-10-10" }))?.id).toBe(today?.id);
  });

  /** A fresh start (nothing in memory) whose scans are counted. */
  async function restarted() {
    const fresh = await freshModule();
    const scans: ScanJob[] = [];
    fresh.setPuzzleScanner((job) => {
      scans.push(job);
      return inThreadScanner(job);
    });
    return { puzzleOfTheDay: fresh.puzzleOfTheDay, scans };
  }

  it("answers a restart the same day from the stored pick, without scanning", async () => {
    await installLichess(Array.from({ length: 50 }, (_, index) => lichessRow(`p${index}`, 1600)));
    const today = await puzzleOfTheDay({ date: "2026-10-10" });
    const fresh = await restarted();
    expect(await fresh.puzzleOfTheDay({ date: "2026-10-10" })).toEqual(today);
    expect(fresh.scans).toEqual([]);
  });

  it("scans again on a new date or after the file changed", async () => {
    await installLichess(Array.from({ length: 50 }, (_, index) => lichessRow(`p${index}`, 1600)));
    await puzzleOfTheDay({ date: "2026-10-10" });
    const nextDay = await restarted();
    const tomorrow = await nextDay.puzzleOfTheDay({ date: "2026-10-11" });
    expect(nextDay.scans).toHaveLength(1);
    // That pick is the stored one now: a new file the same day isn't answered from it.
    await installLichess([lichessRow("replaced", 1600)]);
    const changed = await restarted();
    expect((await changed.puzzleOfTheDay({ date: "2026-10-11" }))?.id).not.toBe(tomorrow?.id);
    expect(changed.scans).toHaveLength(1);
  });

  it("ignores a damaged or incomplete stored pick and replaces it", async () => {
    await installLichess(Array.from({ length: 50 }, (_, index) => lichessRow(`p${index}`, 1600)));
    const today = await puzzleOfTheDay({ date: "2026-10-10" });
    const stored = JSON.parse(await readFile(dailyRecord, "utf8")) as Record<string, unknown>;
    for (const damaged of [
      "{ not json",
      JSON.stringify({ ...stored, sample: { ...today, solutionMoves: [] } }),
      JSON.stringify({ ...stored, sample: { ...today, sideToMove: undefined } }),
      // Every field there, but no position to play: an empty or malformed FEN, or a solution
      // that no longer plays from it.
      JSON.stringify({ ...stored, sample: { ...today, initialFen: "" } }),
      JSON.stringify({ ...stored, sample: { ...today, initialFen: "not a fen" } }),
      JSON.stringify({ ...stored, sample: { ...today, solutionMoves: ["a1a1"] } }),
      JSON.stringify({
        ...stored,
        sample: { ...today, sideToMove: today?.sideToMove === "white" ? "black" : "white" }
      })
    ]) {
      await writeFile(dailyRecord, damaged);
      const fresh = await restarted();
      expect(await fresh.puzzleOfTheDay({ date: "2026-10-10" })).toEqual(today);
      expect(fresh.scans).toHaveLength(1);
      expect(JSON.parse(await readFile(dailyRecord, "utf8"))).toEqual(stored);
    }
  });

  it("picks a mid-rated, popular, often played Lichess puzzle when the file has one", async () => {
    await installLichess([
      ...Array.from({ length: 20 }, (_, index) => lichessRow(`easy${index}`, 900)),
      ...Array.from({ length: 20 }, (_, index) => lichessRow(`unpopular${index}`, 1600, 40)),
      ...Array.from({ length: 20 }, (_, index) => lichessRow(`rare${index}`, 1600, 90, 10)),
      lichessRow("good", 1700)
    ]);
    expect((await puzzleOfTheDay({ date: "2026-10-10" }))?.id).toBe("good");
    // Nothing in that band: still a puzzle.
    await installLichess([lichessRow("hard", 2800)]);
    expect((await puzzleOfTheDay({ date: "2026-10-10" }))?.id).toBe("hard");
  });

  it("takes the Lichess set before a position set, and the position set alone otherwise", async () => {
    await installPositions([positionRow("easy", 1), positionRow("mid", 2)]);
    expect(await puzzleOfTheDay({ date: "2026-10-10" })).toMatchObject({
      id: "mid",
      databaseId: "chess-position-analysis-results",
      difficulty: 2
    });
    await installLichess([lichessRow("lichess", 1600)]);
    expect((await puzzleOfTheDay({ date: "2026-10-10" }))?.id).toBe("lichess");
  });

  it("skips a puzzle database that can't be read, and fails only when every one does", async () => {
    // A Lichess file that claims to be compressed but isn't: its scan fails.
    await installLichess([lichessRow("broken", 1600)]);
    rows.set("lichess-puzzles", { ...rows.get("lichess-puzzles")!, format: "csv.zst" });
    await expect(puzzleOfTheDay({ date: "2026-10-10" })).rejects.toThrow(/Lichess puzzles/);
    await installPositions([positionRow("mid", 2)]);
    expect((await puzzleOfTheDay({ date: "2026-10-10" }))?.id).toBe("mid");
  });
});
