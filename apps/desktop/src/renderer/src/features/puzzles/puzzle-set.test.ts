import { describe, expect, it } from "vitest";
import type { PuzzleSessionConfig } from "./PuzzlePage";
import { formatPuzzleTag, puzzleDatasetLabel, puzzleSetSummary } from "./puzzle-set";

const config: PuzzleSessionConfig = {
  databaseId: "db1",
  mode: "lichess-puzzle",
  lichess: { ratingMin: 600, ratingMax: 2800, popularityMin: 0, lengths: [], themes: [], openings: [], side: "any" },
  position: { difficultyMin: 1, difficultyMax: 4, tags: ["initiative", "development"] }
};

describe("puzzle set", () => {
  it("formats tags", () => {
    expect(formatPuzzleTag("mateIn2")).toBe("mate in 2");
    expect(formatPuzzleTag("Caro-Kann_Defense")).toBe("Caro-Kann Defense");
    expect(formatPuzzleTag("fork")).toBe("fork");
  });

  it("names datasets by their short name, else the installed name", () => {
    expect(puzzleDatasetLabel("chess-position-analysis-results", "Chess Position Analysis Results")).toBe("Chess positions");
    expect(puzzleDatasetLabel("lichess-puzzles", "Lichess Puzzle Database")).toBe("Lichess puzzles");
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
    ).toBe("Lichess puzzles · Rating 1200–1800 · Black to move · Popularity 50+ · fork, mate in 2 · short · Caro-Kann Defense");
  });

  it("says when the range is around the solver's rating, and names a retry set by its size", () => {
    const around = { ...config, difficulty: "easier" as const, lichess: { ...config.lichess, ratingMin: 1050, ratingMax: 1350 } };
    expect(puzzleSetSummary(around, "Lichess puzzles")).toBe("Lichess puzzles · Rating 1050–1350 (easier, around yours)");
    expect(puzzleSetSummary({ ...config, retryIds: ["a", "b"] }, "Lichess puzzles")).toBe("Lichess puzzles · 2 failed puzzles again");
    expect(puzzleSetSummary({ ...config, retryIds: ["a"] }, "Lichess puzzles")).toBe("Lichess puzzles · 1 failed puzzle again");
  });

  it("describes a position set by its difficulty and tags", () => {
    const positions = { ...config, mode: "position-training" as const };
    expect(puzzleSetSummary(positions, "Chess positions")).toBe("Chess positions · Difficulty 1–4 · initiative, development");
    expect(puzzleSetSummary({ ...positions, position: { difficultyMin: 2, difficultyMax: 3, tags: [] } }, "Chess positions")).toBe(
      "Chess positions · Difficulty 2–3"
    );
  });
});
