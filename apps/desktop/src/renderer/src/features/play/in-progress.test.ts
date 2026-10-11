import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { LichessPlayingGame } from "@chaturanga/shared/types/lichess";
import {
  mainlineSummary,
  pickInProgress,
  savedEngineGameSides,
  type BoardMatchInput,
  type LiveGameInput,
  type SavedGameInput
} from "./in-progress";

const WHITE_TO_MOVE = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7";
const BLACK_TO_MOVE = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 b - - 1 9";

const live: LiveGameInput = {
  savedId: "saved-live",
  opponent: "nightowl_77",
  clock: "10+0",
  speed: "rapid",
  rated: true,
  yourColor: "white",
  fen: WHITE_TO_MOVE,
  lastMove: "f8e8"
};

const playing: LichessPlayingGame = {
  id: "abcd1234",
  fen: BLACK_TO_MOVE,
  lastMove: "e2e4",
  yourColor: "black",
  opponent: { name: "rookandroll", rating: 1800 },
  speed: "blitz",
  rated: false,
  isMyTurn: true
};

const boardMatch: BoardMatchInput = {
  savedId: "on-board",
  engineName: "Stockfish (managed)",
  humanColor: "white",
  fen: BLACK_TO_MOVE,
  lastMove: "g1f3"
};

const saved: SavedGameInput = {
  id: "saved-1",
  white: "Stockfish (managed)",
  black: "You",
  fen: BLACK_TO_MOVE,
  lastMove: "c2c3",
  plies: 16
};

const none = { live: null, playing: [], boardMatch: null, saved: null };

describe("pickInProgress", () => {
  it("prefers the live Lichess game on the board over everything else", () => {
    const card = pickInProgress({ live, playing: [playing], boardMatch, saved });
    expect(card).toMatchObject({
      source: "live",
      tag: "Live on Lichess",
      title: "You vs nightowl_77",
      detail: "10+0 · Rated · your move",
      excludeGameId: "saved-live",
      orientation: "white",
      lastMove: "f8e8"
    });
  });

  it("names the opponent to move, and the speed for a game without a clock", () => {
    const card = pickInProgress({
      ...none,
      live: { ...live, clock: null, rated: false, fen: BLACK_TO_MOVE }
    });
    expect(card?.detail).toBe("Rapid · Casual · nightowl_77 to move");
  });

  it("then a Lichess game of yours in progress elsewhere, resumed by its id", () => {
    const card = pickInProgress({ ...none, playing: [playing], boardMatch, saved });
    expect(card).toMatchObject({
      source: "lichess",
      targetId: "abcd1234",
      excludeGameId: null,
      title: "You vs rookandroll",
      detail: "Blitz · Casual · your move",
      orientation: "black"
    });
  });

  it("prefers a Lichess game where it's your move", () => {
    const waiting = { ...playing, id: "waiting1", isMyTurn: false };
    const card = pickInProgress({ ...none, playing: [waiting, playing] });
    expect(card).toMatchObject({ source: "lichess", targetId: "abcd1234" });
    expect(pickInProgress({ ...none, playing: [waiting] })?.targetId).toBe("waiting1");
  });

  it("then the engine match on the board, by the engine's display name", () => {
    const card = pickInProgress({ ...none, boardMatch, saved });
    expect(card).toMatchObject({
      source: "board",
      tag: "In progress",
      title: "You vs Stockfish",
      detail: "Engine game · Move 9 · Stockfish to move",
      excludeGameId: "on-board",
      live: false
    });
  });

  it("then the newest saved unfinished engine game, from your side", () => {
    const card = pickInProgress({ ...none, saved });
    expect(card).toMatchObject({
      source: "saved",
      targetId: "saved-1",
      excludeGameId: "saved-1",
      title: "You vs Stockfish",
      detail: "Engine game · Move 9 · your move",
      orientation: "black"
    });
  });

  it("skips a saved game without a move or without you on one side, and is null with nothing in progress", () => {
    expect(pickInProgress({ ...none, saved: { ...saved, plies: 0 } })).toBeNull();
    expect(pickInProgress({ ...none, saved: { ...saved, black: "Maia 1500" } })).toBeNull();
    expect(pickInProgress({ ...none, saved: { ...saved, white: "You" } })).toBeNull();
    expect(pickInProgress(none)).toBeNull();
  });
});

describe("savedEngineGameSides", () => {
  it("finds you by the name Play writes, on exactly one side", () => {
    expect(savedEngineGameSides("You", "Maia 1500 (managed)")).toStrictEqual({
      human: "white",
      engine: "Maia 1500"
    });
    expect(savedEngineGameSides("Stockfish", "you")).toStrictEqual({
      human: "black",
      engine: "Stockfish"
    });
    expect(savedEngineGameSides("You", null)).toStrictEqual({ human: "white", engine: "Engine" });
    expect(savedEngineGameSides("Alice", null)).toBeNull();
    expect(savedEngineGameSides("You", "you")).toBeNull();
  });
});

describe("mainlineSummary", () => {
  const node = (id: string, parentId: string | null, uci: string | null, children: string[]) =>
    ({
      id,
      parentId,
      uci,
      san: null,
      fenBefore: START_FEN,
      fenAfter: `${id}-fen`,
      ply: 0,
      nags: [],
      comment: null,
      arrows: [],
      highlights: [],
      children
    }) satisfies MoveNode;

  it("follows the first child to the end of the main line", () => {
    const tree = [
      node("root", null, null, ["a", "side"]),
      node("a", "root", "e2e4", ["b"]),
      node("side", "root", "d2d4", []),
      node("b", "a", "e7e5", [])
    ];
    expect(mainlineSummary(tree)).toStrictEqual({ fen: "b-fen", lastMove: "e7e5", plies: 2 });
  });

  it("is the root position, without a last move, for a game with no moves", () => {
    expect(mainlineSummary([node("root", null, null, [])])).toStrictEqual({
      fen: "root-fen",
      lastMove: null,
      plies: 0
    });
    expect(mainlineSummary([])).toBeNull();
  });
});
