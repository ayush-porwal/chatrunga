import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { BroadcastGame } from "@chaturanga/shared/types/broadcast";
import type { StreamedGame } from "../../stores/broadcast-store";
import { boardModel, clockNowMs, clockToMs, streamedClocks } from "./board-state";

const player = (name: string, federation: string | null = null) => ({
  name,
  title: null,
  rating: null,
  federation,
  fideId: null
});

const SUMMARY: BroadcastGame = {
  id: "Game0001",
  name: "A - B",
  white: player("A", "NOR"),
  black: player("B", "IND"),
  whiteClockMs: 3_600_000,
  blackClockMs: 3_500_000,
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  lastMove: "e2e4",
  thinkTimeSec: 30,
  result: "*"
};

const STREAMED: StreamedGame = {
  id: "Game0001",
  roundId: "Round001",
  white: player("A"),
  black: player("B"),
  initialFen: START_FEN,
  moves: [
    { uci: "e2e4", san: "e4", clock: "1:00:00" },
    { uci: "e7e5", san: "e5", clock: "0:58:20" }
  ],
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  lastMove: "e7e5",
  result: "*",
  headers: { event: null, round: null, date: null, timeControl: null, site: null },
  lastMoveAt: 50_000
};

describe("board cards", () => {
  it("reads [%clk] times", () => {
    expect(clockToMs("1:02:03")).toBe(3_723_000);
    expect(clockToMs("0:00:59.5")).toBe(59_500);
    expect(clockToMs("soon")).toBeNull();
  });

  it("takes each side's clock from its own moves", () => {
    expect(streamedClocks(STREAMED)).toStrictEqual({ white: 3_600_000, black: 3_500_000 });
    // Black moving first (a set-up position) shifts whose clock each move carries.
    const blackFirst = { ...STREAMED, initialFen: SUMMARY.fen };
    expect(streamedClocks(blackFirst)).toStrictEqual({ white: 3_500_000, black: 3_600_000 });
  });

  it("dates the summary's last move from its think time, and runs only the side to move", () => {
    const board = boardModel(SUMMARY, undefined, 100_000);
    expect(board).toMatchObject({ sideToMove: "black", lastMoveAt: 70_000, plies: null });
    expect(clockNowMs(board, "black", 100_000)).toBe(3_470_000);
    expect(clockNowMs(board, "white", 100_000)).toBe(3_600_000);
  });

  it("prefers the streamed game, keeping the summary's federations", () => {
    const board = boardModel(SUMMARY, STREAMED, 100_000);
    expect(board).toMatchObject({
      fen: STREAMED.fen,
      lastMove: "e7e5",
      sideToMove: "white",
      lastMoveAt: 50_000,
      plies: 2,
      white: { federation: "NOR" }
    });
    expect(clockNowMs(board, "white", 60_000)).toBe(3_590_000);
  });

  it("stops the clocks once the game has a result", () => {
    const board = boardModel({ ...SUMMARY, result: "1-0", thinkTimeSec: null }, undefined, 100_000);
    expect(clockNowMs(board, "black", 999_999)).toBe(3_500_000);
  });
});
