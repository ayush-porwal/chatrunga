import { describe, expect, it } from "vitest";
import type { PuzzleSessionConfig } from "./PuzzlePage";
import { ratingRangeFor } from "@chaturanga/shared/chess/puzzle-rating";
import { DEFAULT_PUZZLE_FILTERS } from "../../stores/puzzle-draft-store";
import {
  formatPuzzleTag,
  puzzleDatabasesOf,
  puzzleDatasetLabel,
  puzzleSetConfig,
  puzzleSetSummary,
  selectedPuzzleDatabase
} from "./puzzle-set";

const config: PuzzleSessionConfig = {
  databaseId: "db1",
  mode: "lichess-puzzle",
  lichess: {
    ratingMin: 600,
    ratingMax: 2800,
    popularityMin: 0,
    lengths: [],
    themes: [],
    openings: [],
    side: "any"
  },
  position: { difficultyMin: 1, difficultyMax: 4, tags: ["initiative", "development"] }
};

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

  it("describes a Lichess set by the filters that narrow it", () => {
    expect(puzzleSetSummary(config, "Lichess puzzles")).toBe("Lichess puzzles · Rating 600–2800");
    expect(
      puzzleSetSummary(
        {
          ...config,
          lichess: {
            ratingMin: 1200,
            ratingMax: 1800,
            popularityMin: 50,
            lengths: ["short"],
            themes: ["fork", "mateIn2"],
            openings: ["Caro-Kann_Defense"],
            side: "black"
          }
        },
        "Lichess puzzles"
      )
    ).toBe(
      "Lichess puzzles · Rating 1200–1800 · Black to move · Popularity 50+ · fork, mate in 2 · short · Caro-Kann Defense"
    );
  });

  it("says when the range is around the solver's rating, and names a retry set by its size", () => {
    const around = {
      ...config,
      difficulty: "easier" as const,
      lichess: { ...config.lichess, ratingMin: 1050, ratingMax: 1350 }
    };
    expect(puzzleSetSummary(around, "Lichess puzzles")).toBe(
      "Lichess puzzles · Rating 1050–1350 (easier, around yours)"
    );
    expect(puzzleSetSummary({ ...config, retryIds: ["a", "b"] }, "Lichess puzzles")).toBe(
      "Lichess puzzles · 2 failed puzzles again"
    );
    expect(puzzleSetSummary({ ...config, retryIds: ["a"] }, "Lichess puzzles")).toBe(
      "Lichess puzzles · 1 failed puzzle again"
    );
  });

  it("describes a position set by its difficulty and tags", () => {
    const positions = { ...config, mode: "position-training" as const };
    expect(puzzleSetSummary(positions, "Chess positions")).toBe(
      "Chess positions · Difficulty 1–4 · initiative, development"
    );
    expect(
      puzzleSetSummary(
        { ...positions, position: { difficultyMin: 2, difficultyMax: 3, tags: [] } },
        "Chess positions"
      )
    ).toBe("Chess positions · Difficulty 2–3");
  });

  it("draws from the chosen database, else Lichess puzzles, else the first puzzle set", () => {
    const installed = puzzleDatabasesOf([
      { id: "games", sourceId: "lichess-games", kind: "game-library" as const },
      { id: "pos", sourceId: "chess-positions", kind: "position" as const },
      { id: "lp", sourceId: "lichess-puzzles", kind: "puzzle" as const }
    ]);
    expect(installed.map((item) => item.id)).toEqual(["pos", "lp"]);
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
