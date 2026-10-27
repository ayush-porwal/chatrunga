import { DEFAULT_GAME_PUZZLE_SETTINGS } from "@chaturanga/shared/types/game-puzzles";
import { describe, expect, it } from "vitest";
import {
  parseGamePuzzleAttemptInput,
  parseGamePuzzleQuery,
  parseGamePuzzleSettings
} from "./validate-game-puzzles";

describe("game puzzle IPC inputs", () => {
  it("accepts the dialog's settings, each choice once and nothing else", () => {
    expect(parseGamePuzzleSettings({ ...DEFAULT_GAME_PUZZLE_SETTINGS, extra: true })).toStrictEqual(
      DEFAULT_GAME_PUZZLE_SETTINGS
    );
    expect(
      parseGamePuzzleSettings({
        sources: ["lichess", "lichess"],
        timeControls: [],
        limit: null,
        skipProcessed: false,
        kinds: ["tricky"],
        depth: "deep"
      })
    ).toStrictEqual({
      sources: ["lichess"],
      timeControls: [],
      limit: null,
      skipProcessed: false,
      kinds: ["tricky"],
      depth: "deep"
    });
  });

  it("accepts a query with only the filters it sets", () => {
    expect(parseGamePuzzleQuery({})).toStrictEqual({});
    expect(
      parseGamePuzzleQuery({
        kinds: ["mistake"],
        sources: ["imported"],
        difficulty: { min: 1200, max: 2600 },
        excludeIds: ["a", "b"],
        limit: 20
      })
    ).toStrictEqual({
      kinds: ["mistake"],
      sources: ["imported"],
      difficulty: { min: 1200, max: 2600 },
      excludeIds: ["a", "b"],
      limit: 20
    });
    expect(parseGamePuzzleQuery({ difficulty: null })).toStrictEqual({ difficulty: null });
  });

  it("accepts an attempt's scheduler outcome", () => {
    expect(parseGamePuzzleAttemptInput({ puzzleId: "p1", outcome: "reveal" })).toStrictEqual({
      puzzleId: "p1",
      outcome: "reveal"
    });
  });

  it.each([
    [() => parseGamePuzzleSettings(null), /settings/],
    [() => parseGamePuzzleSettings({ ...DEFAULT_GAME_PUZZLE_SETTINGS, limit: 30 }), /game limit/],
    [() => parseGamePuzzleSettings({ ...DEFAULT_GAME_PUZZLE_SETTINGS, depth: "max" }), /depth/],
    [
      () => parseGamePuzzleSettings({ ...DEFAULT_GAME_PUZZLE_SETTINGS, kinds: ["blunder"] }),
      /puzzle kinds/
    ],
    [
      () => parseGamePuzzleSettings({ ...DEFAULT_GAME_PUZZLE_SETTINGS, timeControls: "blitz" }),
      /time controls/
    ],
    [() => parseGamePuzzleQuery({ difficulty: { min: 2000, max: 1000 } }), /difficulty range/],
    [() => parseGamePuzzleQuery({ difficulty: { min: 100, max: 1000 } }), /minimum difficulty/],
    [() => parseGamePuzzleQuery({ excludeIds: [""] }), /excluded puzzles/],
    [() => parseGamePuzzleQuery({ limit: 0 }), /limit/],
    [() => parseGamePuzzleAttemptInput({ puzzleId: "p1", outcome: "assisted" }), /outcome/],
    [() => parseGamePuzzleAttemptInput({ outcome: "wrong" }), /puzzle id/]
  ])("rejects malformed input %#", (parse, message) => {
    expect(parse).toThrow(message);
  });
});
