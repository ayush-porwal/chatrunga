import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_PUZZLE_SETTINGS,
  type GamePuzzleQueueStatus,
  type GamePuzzleSummary
} from "@chaturanga/shared/types/game-puzzles";
import {
  canStartGeneration,
  gameCountText,
  kindAvailable,
  limitChoice,
  limitFromChoice,
  settingsToStart,
  toggled
} from "./generate-puzzles";
import {
  myGamesBlocker,
  myGamesFacts,
  myGamesSourcesLine,
  queueActive,
  queueProgress
} from "./my-games-card";

const source = (games: number, eligible = games, processed = 0, puzzles = 0) => ({
  games,
  eligible,
  processed,
  puzzles
});

const summary: GamePuzzleSummary = {
  sources: {
    lichess: source(120, 120, 30, 14),
    chesscom: source(40, 38, 10, 6),
    imported: source(0)
  },
  puzzles: 20,
  due: 7,
  engine: "ready",
  maiaInstalled: true
};

const idle: GamePuzzleQueueStatus = {
  paused: false,
  waitingForEngine: false,
  done: 0,
  total: 0,
  current: null
};

describe("the My games card", () => {
  it("adds the sources up into its facts", () => {
    expect(myGamesFacts(summary)).toStrictEqual([
      { label: "Games", value: "160" },
      { label: "Processed", value: "40" },
      { label: "Puzzles", value: "20" },
      { label: "Due", value: "7" }
    ]);
  });

  it("lists the sources that have games", () => {
    expect(myGamesSourcesLine(summary)).toBe("Lichess 120 · Chess.com 40");
    const none = {
      ...summary,
      sources: { lichess: source(0), chesscom: source(0), imported: source(0) }
    };
    expect(myGamesSourcesLine(none)).toBeNull();
  });

  it("says why Generate can't run and which settings fix it", () => {
    const empty = { lichess: source(0), chesscom: source(0), imported: source(0) };
    expect(myGamesBlocker({ ...summary, sources: empty })).toMatchObject({
      kind: "no-games",
      settings: "lichess"
    });
    const noAccount = { ...empty, imported: source(12, 0) };
    expect(myGamesBlocker({ ...summary, sources: noAccount })).toMatchObject({
      kind: "no-account",
      settings: "lichess"
    });
    expect(myGamesBlocker({ ...summary, engine: "missing" })).toMatchObject({
      kind: "engine-missing",
      settings: "engines"
    });
    expect(myGamesBlocker({ ...summary, engine: "lc0" })).toMatchObject({ kind: "lc0" });
    expect(myGamesBlocker(summary)).toBeNull();
  });
});

describe("the queue's progress", () => {
  const running: GamePuzzleQueueStatus = {
    ...idle,
    done: 2,
    total: 20,
    current: {
      gameId: "g3",
      white: "Magnus",
      black: "Hikaru",
      date: null,
      source: "dialog",
      progress: { phase: "check", done: 4, total: 12 }
    }
  };

  it("is active while games are left or one is being worked on", () => {
    expect(queueActive(undefined)).toBe(false);
    expect(queueActive(idle)).toBe(false);
    expect(queueActive({ ...idle, done: 3, total: 3 })).toBe(false);
    expect(queueActive(running)).toBe(true);
  });

  it("counts the game being worked on, names it and its step", () => {
    expect(queueProgress(running)).toStrictEqual({
      headline: "Game 3 of 20",
      detail: "Magnus – Hikaru · Checking candidates 4/12",
      percent: 10
    });
  });

  it("says when it is paused or waiting for the engine", () => {
    expect(queueProgress({ ...running, paused: true }).detail).toBe("Magnus – Hikaru · Paused");
    expect(queueProgress({ ...running, waitingForEngine: true }).detail).toBe(
      "Magnus – Hikaru · Waiting while the engine is in use"
    );
  });

  it("says which game is next before one starts", () => {
    expect(queueProgress({ ...idle, done: 0, total: 5 })).toMatchObject({
      headline: "Game 1 of 5",
      detail: null
    });
  });
});

describe("the Generate puzzles dialog", () => {
  const settings = { ...DEFAULT_GAME_PUZZLE_SETTINGS };

  it("toggles an item in or out, in the list's own order", () => {
    expect(toggled(["c", "a"], "b", ["a", "b", "c"])).toStrictEqual(["a", "b", "c"]);
    expect(toggled(["a", "b"], "a", ["a", "b"])).toStrictEqual(["b"]);
  });

  it("leaves out the kinds that need Maia 3 until it is installed", () => {
    expect(kindAvailable("tricky", false)).toBe(false);
    expect(kindAvailable("mistake", false)).toBe(true);
    expect(settingsToStart(settings, false).kinds).toStrictEqual([
      "mistake",
      "missed-chance",
      "opponent-chance"
    ]);
    expect(settingsToStart(settings, true)).toBe(settings);
  });

  it("starts only with a kind and a matching game", () => {
    const count = { eligible: 4, withoutUserSide: 0 };
    expect(canStartGeneration(settings, count)).toBe(true);
    expect(canStartGeneration(settings, { ...count, eligible: 0 })).toBe(false);
    expect(canStartGeneration(settings, undefined)).toBe(false);
    expect(canStartGeneration({ ...settings, kinds: [] }, count)).toBe(false);
  });

  it("says how many games match, and how many are skipped without a connected account", () => {
    expect(gameCountText({ eligible: 1, withoutUserSide: 0 })).toBe("1 game matches");
    expect(gameCountText({ eligible: 24, withoutUserSide: 3 })).toBe(
      "24 games match · 3 without a connected account are skipped"
    );
  });

  it("reads How many as a number, or every game", () => {
    expect(limitChoice(50)).toBe("50");
    expect(limitChoice(null)).toBe("all");
    expect(limitFromChoice("100")).toBe(100);
    expect(limitFromChoice("all")).toBeNull();
  });
});
