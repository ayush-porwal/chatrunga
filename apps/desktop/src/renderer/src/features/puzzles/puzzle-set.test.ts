import { describe, expect, it } from "vitest";
import { ratingRangeFor } from "@chaturanga/shared/chess/puzzle-rating";
import { DEFAULT_PUZZLE_FILTERS } from "../../stores/puzzle-draft-store";
import {
  drawnRatingRange,
  formatPuzzleTag,
  moreFiltersSummary,
  puzzleDatabasesKey,
  puzzleDatabasesOf,
  puzzleDatasetLabel,
  puzzleFiltersChanged,
  puzzleSetConfig,
  selectedPuzzleDatabase
} from "./puzzle-set";

describe("puzzle set", () => {
  it("formats tags", () => {
    expect(formatPuzzleTag("mateIn2")).toBe("mate in 2");
    expect(formatPuzzleTag("Caro-Kann_Defense")).toBe("Caro-Kann Defense");
    expect(formatPuzzleTag("fork")).toBe("fork");
  });

  it("names datasets by their short name, else the installed name", () => {
    expect(
      puzzleDatasetLabel("chess-position-analysis-results", "Chess Position Analysis Results")
    ).toBe("Chess positions");
    expect(puzzleDatasetLabel("lichess-puzzles", "Lichess Puzzle Database")).toBe(
      "Lichess puzzles"
    );
    expect(puzzleDatasetLabel("my-own", "My own set")).toBe("My own set");
  });

  it("draws from the chosen database, else Lichess puzzles, else the first puzzle set", () => {
    const installed = puzzleDatabasesOf([
      { id: "games", sourceId: "lichess-games", kind: "game-library" as const },
      { id: "pos", sourceId: "chess-positions", kind: "position" as const },
      { id: "lp", sourceId: "lichess-puzzles", kind: "puzzle" as const }
    ]);
    expect(installed.map((item) => item.id)).toStrictEqual(["pos", "lp"]);
    expect(selectedPuzzleDatabase(installed, "pos")?.id).toBe("pos");
    // Not chosen, or chosen and removed since.
    expect(selectedPuzzleDatabase(installed, "")?.id).toBe("lp");
    expect(selectedPuzzleDatabase(installed, "gone")?.id).toBe("lp");
    expect(selectedPuzzleDatabase(installed.slice(0, 1), "")?.id).toBe("pos");
    expect(selectedPuzzleDatabase([], "")).toBeNull();
  });

  it("starts the Puzzles page's set: its filters, the range around the rating now when asked", () => {
    const draft = { databaseId: "", ...DEFAULT_PUZZLE_FILTERS, themes: ["fork"] };
    const lichess = { id: "lp", sourceId: "lichess-puzzles" };
    expect(puzzleSetConfig(draft, lichess, 1700)).toMatchObject({
      databaseId: "lp",
      mode: "lichess-puzzle",
      difficulty: null,
      lichess: { ratingMin: 600, ratingMax: 2800, themes: ["fork"] }
    });
    expect(
      puzzleSetConfig({ ...draft, difficulty: "harder" }, lichess, 1700).lichess
    ).toMatchObject(ratingRangeFor(1700, "harder"));
    // Position sets have no rating: their difficulty range applies, never "around my rating".
    expect(
      puzzleSetConfig(
        { ...draft, difficulty: "harder" },
        { id: "pos", sourceId: "chess-positions" },
        1700
      )
    ).toMatchObject({
      mode: "position-training",
      difficulty: null,
      position: { difficultyMin: 1 }
    });
  });
});

describe("the Puzzles page's filters", () => {
  const draft = { databaseId: "", ...DEFAULT_PUZZLE_FILTERS };

  it("draws a Lichess set from its own range, or around the rating when asked", () => {
    expect(drawnRatingRange(draft, true, 1700)).toStrictEqual({
      ratingMin: 600,
      ratingMax: 2800,
      aroundRating: false
    });
    const harder = { ...draft, difficulty: "harder" as const };
    expect(drawnRatingRange(harder, true, 1700)).toStrictEqual({
      ...ratingRangeFor(1700, "harder"),
      aroundRating: true
    });
    // A position set has no rating to draw around.
    expect(drawnRatingRange(harder, false, 1700).aroundRating).toBe(false);
  });

  it("sums up the folded filters only when one is set", () => {
    expect(moreFiltersSummary([], 0)).toBeNull();
    expect(moreFiltersSummary(["Italian_Game"], 0)).toBe("Italian Game");
    expect(moreFiltersSummary(["Italian_Game", "Ruy_Lopez"], 20)).toBe(
      "2 openings · popularity 20+"
    );
    expect(moreFiltersSummary([], -10)).toBe("popularity -10+");
  });

  it("offers Reset filters once the set's own filters leave the defaults", () => {
    expect(puzzleFiltersChanged(draft, true)).toBe(false);
    expect(puzzleFiltersChanged(draft, false)).toBe(false);
    expect(puzzleFiltersChanged({ ...draft, themes: ["pin"] }, true)).toBe(true);
    // A Lichess filter doesn't count for a position set, nor a position one for Lichess.
    expect(puzzleFiltersChanged({ ...draft, themes: ["pin"] }, false)).toBe(false);
    expect(puzzleFiltersChanged({ ...draft, difficultyMax: 3 }, true)).toBe(false);
    expect(puzzleFiltersChanged({ ...draft, difficultyMax: 3 }, false)).toBe(true);
  });
});

describe("puzzleDatabasesKey", () => {
  const db = (id: string, kind: "puzzle" | "game-library", fileSizeBytes = 10, updatedAt = 1) => ({
    id,
    kind,
    fileSizeBytes,
    updatedAt
  });

  it("changes when a puzzle database is added, removed or replaced, not for other databases", () => {
    const key = puzzleDatabasesKey([db("a", "puzzle"), db("b", "puzzle")]);
    expect(
      puzzleDatabasesKey([db("b", "puzzle"), db("a", "puzzle"), db("g", "game-library")])
    ).toBe(key);
    expect(puzzleDatabasesKey([db("a", "puzzle")])).not.toBe(key);
    expect(puzzleDatabasesKey([db("a", "puzzle"), db("b", "puzzle", 10, 2)])).not.toBe(key);
    expect(puzzleDatabasesKey([db("a", "puzzle"), db("b", "puzzle", 11)])).not.toBe(key);
    expect(puzzleDatabasesKey([])).toBe("");
  });
});
