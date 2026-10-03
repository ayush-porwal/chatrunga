import { describe, expect, it } from "vitest";
import type { InstalledDatabase, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { matchesCheapFilters, parseCsvLine, sampleFromLichessRow, sampleFromPositionRow } from "./puzzle-rows";

const database = { id: "db1", sourceId: "lichess-puzzles", name: "Lichess puzzles" } as InstalledDatabase;
// Real row shape from the Lichess puzzle CSV (FEN is before the opponent's move).
const LICHESS_ROW =
  '00sHx,q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17,e8d7 a2e6 d7d8 f7f8,1760,80,83,72,mate mateIn2 middlegame short,https://lichess.org/yyznGmXs/black#34,Italian_Game Italian_Game_Classical_Variation';
const lichessFilters = (overrides: Partial<NonNullable<PuzzleSampleInput["lichess"]>> = {}): PuzzleSampleInput => ({
  databaseId: "db1",
  lichess: { ratingMin: 1000, ratingMax: 2000, popularityMin: 50, lengths: [], themes: [], openings: [], side: "any", ...overrides }
});

describe("parseCsvLine", () => {
  it("splits quoted fields and unescapes doubled quotes", () => {
    expect(parseCsvLine('a,"b,c","say ""hi""",')).toEqual(["a", "b,c", 'say "hi"', ""]);
  });
});

describe("sampleFromLichessRow", () => {
  it("starts the puzzle after the opponent's move", () => {
    const sample = sampleFromLichessRow(database, parseCsvLine(LICHESS_ROW), lichessFilters());
    expect(sample).toMatchObject({
      id: "00sHx",
      opponentMove: "e8d7",
      solutionMoves: ["a2e6", "d7d8", "f7f8"],
      rating: 1760,
      ratingDeviation: 80,
      plays: 72,
      sideToMove: "white",
      themes: ["mate", "mateIn2", "middlegame", "short"],
      openingTags: ["Italian_Game", "Italian_Game_Classical_Variation"]
    });
  });

  it("applies rating, theme, opening, length and side filters", () => {
    const row = parseCsvLine(LICHESS_ROW);
    expect(sampleFromLichessRow(database, row, lichessFilters({ ratingMax: 1500 }))).toBeNull();
    expect(sampleFromLichessRow(database, row, lichessFilters({ popularityMin: 90 }))).toBeNull();
    expect(sampleFromLichessRow(database, row, lichessFilters({ themes: ["fork"] }))).toBeNull();
    expect(sampleFromLichessRow(database, row, lichessFilters({ openings: ["Sicilian_Defense"] }))).toBeNull();
    expect(sampleFromLichessRow(database, row, lichessFilters({ lengths: ["long"] }))).toBeNull();
    expect(sampleFromLichessRow(database, row, lichessFilters({ side: "black" }))).toBeNull();
    expect(sampleFromLichessRow(database, row, lichessFilters({ themes: ["mateIn2"], side: "white" }))).not.toBeNull();
  });

  it("skips incomplete rows", () => {
    expect(sampleFromLichessRow(database, ["id", "fen"], lichessFilters())).toBeNull();
  });

  it("skips a row whose solution line can't be played to the end", () => {
    // The last scripted move (f7f8 → f7f1) is illegal: the puzzle would get stuck there.
    const broken = parseCsvLine(LICHESS_ROW.replace("d7d8 f7f8", "d7d8 f7f1"));
    expect(sampleFromLichessRow(database, broken, lichessFilters())).toBeNull();
  });
});

describe("sampleFromPositionRow", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const row = ["p1", "", "", "https://lichess.org/abc", fen, "e2e4", "3", "0", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1"];

  it("reads the tag flags and difficulty", () => {
    expect(sampleFromPositionRow(database, row, { databaseId: "db1" })).toMatchObject({
      id: "p1",
      solutionMoves: ["e2e4"],
      themes: ["development", "centreControl"],
      difficulty: 3,
      sideToMove: "white"
    });
  });

  it("skips a row whose best move can't be played", () => {
    expect(sampleFromPositionRow(database, row.map((value) => (value === "e2e4" ? "e2e5" : value)), { databaseId: "db1" })).toBeNull();
  });

  it("filters by difficulty and tags", () => {
    const position = (difficultyMax: number, tags: string[]) => ({ databaseId: "db1", position: { difficultyMin: 0, difficultyMax, tags } });
    expect(sampleFromPositionRow(database, row, position(2, []))).toBeNull();
    expect(sampleFromPositionRow(database, row, position(5, ["endgame"]))).toBeNull();
    expect(sampleFromPositionRow(database, row, position(5, ["development"]))).not.toBeNull();
  });
});

describe("matchesCheapFilters", () => {
  it("agrees with the full row parser without doing any chess", () => {
    const row = parseCsvLine(LICHESS_ROW);
    const cases = [
      {},
      { ratingMax: 1500 },
      { popularityMin: 90 },
      { themes: ["fork"] },
      { themes: ["mateIn2"] },
      { openings: ["Sicilian_Defense"] },
      { lengths: ["long"] },
      { side: "black" as const },
      { side: "white" as const }
    ];
    for (const overrides of cases) {
      const input = lichessFilters(overrides);
      expect(matchesCheapFilters("lichess", row, input)).toBe(sampleFromLichessRow(database, row, input) !== null);
    }
  });

  it("reads openings from the OpeningTags column (the last), not GameUrl", () => {
    const row = parseCsvLine(LICHESS_ROW);
    const input = lichessFilters({ openings: ["Italian_Game_Classical_Variation"] });
    expect(matchesCheapFilters("lichess", row, input)).toBe(true);
    expect(sampleFromLichessRow(database, row, input)).not.toBeNull();
  });

  it("rejects a row with too few moves to make a puzzle", () => {
    const row = parseCsvLine(LICHESS_ROW.replace("e8d7 a2e6 d7d8 f7f8", "e8d7"));
    expect(sampleFromLichessRow(database, row, lichessFilters())).toBeNull();
    expect(matchesCheapFilters("lichess", row, lichessFilters())).toBe(false);
    expect(matchesCheapFilters("lichess", row, { databaseId: "db1" })).toBe(false);
  });
});
