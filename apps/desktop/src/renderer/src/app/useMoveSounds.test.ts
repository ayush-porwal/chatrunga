import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { Color } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../stores/game-store";
import { watchBoardSounds, withoutMoveSounds } from "./useMoveSounds";

// What the board asks to play, in order: a move's SAN ("move:Nf3") or a sound ("sound:victory").
const played = vi.hoisted(() => [] as string[]);
vi.mock("../sounds/sounds", () => ({
  playMoveSound: (san: string) => played.push(`move:${san}`),
  playSound: (kind: string) => played.push(`sound:${kind}`)
}));

const game = () => useGameStore.getState();
let stop: () => void = () => undefined;

/** A game on the board, at its root, the sounds followed from then on. Returns the main line's ids. */
function loadAtRoot(pgn: string): string[] {
  const { game: loaded } = importPgnText(pgn);
  game().loadGame(loaded);
  game().goToNode("root");
  stop = watchBoardSounds();
  return loaded.moveTree.filter((node) => node.san).map((node) => node.id);
}

/** An engine game set up now (the engine playing `engineSide`), past its setup task. */
function startEngineGame(engineSide: Color): void {
  stop = watchBoardSounds();
  game().reset();
  game().setMode("engine");
  game().setEngineSide(engineSide);
  vi.advanceTimersByTime(0);
}

function play(...ucis: string[]): void {
  for (const uci of ucis) game().makeUciMove(uci);
}

describe("watchBoardSounds", () => {
  beforeEach(() => {
    // Timers only: the clocks read the real time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    played.length = 0;
    game().reset();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  describe("stepping through a game", () => {
    it("a step forward plays the move it shows", () => {
      const line = loadAtRoot("1. e4 d5 2. exd5 Qxd5 3. Nc3 Qe5+ *");
      for (const id of line) game().goToNode(id);
      expect(played).toStrictEqual([
        "move:e4",
        "move:d5",
        "move:exd5",
        "move:Qxd5",
        "move:Nc3",
        "move:Qe5+"
      ]);
    });

    it("a step back plays nothing (not the move it undid)", () => {
      const line = loadAtRoot("1. e4 e5 2. Nf3 Nc6 *");
      game().goToNode(line[2]);
      game().undo();
      game().undo();
      expect(played).toStrictEqual([]);
    });

    it("a jump of more than one move (First, Last, a click in the list) plays nothing", () => {
      const line = loadAtRoot("1. e4 e5 2. Nf3 Nc6 *");
      game().goToNode(line[3]);
      game().goToNode("root");
      game().goToNode(line[1]);
      expect(played).toStrictEqual([]);
    });

    it("loading a game, or a step made without its sound, plays nothing", () => {
      const line = loadAtRoot("1. e4 e5 2. Nf3 Nc6 *");
      withoutMoveSounds(() => game().goToNode(line[0]));
      const { game: other } = importPgnText("1. d4 *");
      game().loadGame(other);
      expect(played).toStrictEqual([]);
    });

    it("stepping onto a finished game's mate plays the move, not a result", () => {
      const line = loadAtRoot("1. f3 e5 2. g4 Qh4# 0-1");
      game().goToNode(line[2]);
      game().flip();
      game().goToNode(line[3]);
      expect(played).toStrictEqual(["move:Qh4#"]);
    });
  });

  describe("a live game", () => {
    it("starts with the start sound once its setup is over", () => {
      startEngineGame("black");
      expect(played).toStrictEqual(["sound:start"]);
    });

    it("a mate plays the mating move, then the user's result", () => {
      startEngineGame("white");
      play("f2f3", "e7e5", "g2g4", "d8h4");
      expect(played).toStrictEqual([
        "sound:start",
        "move:f3",
        "move:e5",
        "move:g4",
        "move:Qh4#",
        "sound:victory"
      ]);
    });

    it.each([
      ["resigning", () => game().resign(), "sound:defeat"],
      ["agreeing a draw", () => game().agreeDraw(), "sound:draw"],
      ["losing on time", () => game().resolveTimeout("white"), "sound:defeat"],
      ["the Lichess server's win", () => game().endMatch("1-0", "Player resign"), "sound:victory"]
    ])("an ending off the board (%s) plays its result", (_, end, sound) => {
      startEngineGame("black");
      end();
      expect(played).toStrictEqual(["sound:start", sound]);
    });

    it("an aborted game plays no result", () => {
      startEngineGame("black");
      game().endMatch("*", "Game aborted");
      expect(played).toStrictEqual(["sound:start"]);
    });

    it("a game set up already over (a finished Lichess game opened) plays neither start nor result", () => {
      stop = watchBoardSounds();
      game().reset();
      game().setMode("online");
      game().setEngineSide("black");
      game().endMatch("0-1", "Player resign");
      vi.advanceTimersByTime(0);
      expect(played).toStrictEqual([]);
    });

    it("with sounds switched on mid-game, it plays its result but no start", () => {
      game().setMode("engine");
      game().setEngineSide("black");
      stop = watchBoardSounds();
      vi.advanceTimersByTime(0);
      game().resign();
      expect(played).toStrictEqual(["sound:defeat"]);
    });

    it("plays the result once", () => {
      startEngineGame("black");
      game().resign();
      game().endMatch("0-1", "Player resign");
      game().resign();
      expect(played).toStrictEqual(["sound:start", "sound:defeat"]);
    });

    it("warns once when the user's clock runs low on their turn", () => {
      startEngineGame("black");
      game().setEngineMatchClock({ initialMs: 60_000, incrementMs: 0 });
      game().setMatchClock({ whiteMs: 5_000, blackMs: 60_000, sideToMove: "white", running: true });
      vi.advanceTimersByTime(1_000);
      expect(played).toStrictEqual(["sound:start", "sound:lowTime"]);
    });

    it("doesn't warn while the opponent's clock runs", () => {
      startEngineGame("black");
      game().setEngineMatchClock({ initialMs: 60_000, incrementMs: 0 });
      game().setMatchClock({ whiteMs: 5_000, blackMs: 60_000, sideToMove: "black", running: true });
      vi.advanceTimersByTime(1_000);
      expect(played).toStrictEqual(["sound:start"]);
    });
  });

  describe("a refused move", () => {
    it("plays the error sound", () => {
      stop = watchBoardSounds();
      game().makeMove({ from: "e2", to: "e5" });
      expect(played).toStrictEqual(["sound:error"]);
    });

    it("after the game's end plays nothing", () => {
      startEngineGame("black");
      game().resign();
      game().makeMove({ from: "e2", to: "e4" });
      expect(played).toStrictEqual(["sound:start", "sound:defeat"]);
    });
  });
});
