import { useEffect, useState } from "react";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import type {
  BroadcastGame,
  BroadcastLiveGame,
  BroadcastPlayer,
  BroadcastResult,
  BroadcastRoundDetail
} from "@chaturanga/shared/types/broadcast";
import type { Color } from "@chaturanga/shared/types/chess";
import { useBroadcastStore, type StreamedGame } from "../../stores/broadcast-store";

/** A board of a round as its card shows it: the summary's, brought up to date by the stream. */
export type BoardModel = {
  id: string;
  white: BroadcastPlayer;
  black: BroadcastPlayer;
  fen: string;
  lastMove: string | null;
  result: BroadcastResult;
  sideToMove: Color;
  /** Each side's time left as of the last move (ms), when the source sends clocks. */
  clocks: Record<Color, number | null>;
  /** When the last move was played (epoch ms), if known: the side to move's clock runs from it. */
  lastMoveAt: number | null;
  /** Moves played (plies), when the stream has sent the game. */
  plies: number | null;
};

/** `[%clk]` time ("1:02:03", "0:00:59.5") in ms, or null. */
export function clockToMs(clock: string | null): number | null {
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(clock?.trim() ?? "");
  if (!match) return null;
  return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
}

function sideOf(fen: string): Color {
  return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

/** Each side's last clock in a streamed game's moves. */
export function streamedClocks(game: BroadcastLiveGame): Record<Color, number | null> {
  const first = sideOf(game.initialFen);
  const clocks: Record<Color, number | null> = { white: null, black: null };
  game.moves.forEach((move, index) => {
    const mover: Color = index % 2 === 0 ? first : first === "white" ? "black" : "white";
    const ms = clockToMs(move.clock);
    if (ms !== null) clocks[mover] = ms;
  });
  return clocks;
}

/**
 * The card's board: the streamed game when there is one (it is newer), else the round summary's.
 * `readAt` is when the summary was read: its think time dates the last move.
 */
export function boardModel(
  game: BroadcastGame,
  streamed: StreamedGame | undefined,
  readAt: number
): BoardModel {
  const summaryLastMoveAt =
    game.result === "*" && game.thinkTimeSec !== null ? readAt - game.thinkTimeSec * 1000 : null;
  if (!streamed) {
    return {
      id: game.id,
      white: game.white,
      black: game.black,
      fen: game.fen,
      lastMove: game.lastMove,
      result: game.result,
      sideToMove: sideOf(game.fen),
      clocks: { white: game.whiteClockMs, black: game.blackClockMs },
      lastMoveAt: summaryLastMoveAt,
      plies: null
    };
  }
  // The summary's players carry federations and FIDE ids the PGN may lack.
  const clocks = streamedClocks(streamed);
  return {
    id: game.id,
    white: mergePlayer(game.white, streamed.white),
    black: mergePlayer(game.black, streamed.black),
    fen: streamed.fen,
    lastMove: streamed.lastMove,
    result: streamed.result,
    sideToMove: sideOf(streamed.fen),
    clocks: {
      white: clocks.white ?? game.whiteClockMs,
      black: clocks.black ?? game.blackClockMs
    },
    lastMoveAt:
      streamed.lastMoveAt ?? (streamed.lastMove === game.lastMove ? summaryLastMoveAt : null),
    plies: streamed.moves.length
  };
}

function mergePlayer(summary: BroadcastPlayer, streamed: BroadcastPlayer): BroadcastPlayer {
  return {
    name: summary.name,
    title: summary.title ?? streamed.title,
    rating: summary.rating ?? streamed.rating,
    federation: summary.federation ?? streamed.federation,
    fideId: summary.fideId ?? streamed.fideId
  };
}

/**
 * A side's clock now: the side to move's runs from its last move while the game is on. Null
 * without a clock.
 */
export function clockNowMs(board: BoardModel, color: Color, now: number): number | null {
  const clock = board.clocks[color];
  if (clock === null) return null;
  const running = board.result === "*" && board.sideToMove === color && board.lastMoveAt !== null;
  return running ? Math.max(0, clock - (now - (board.lastMoveAt ?? now))) : clock;
}

export function clockText(ms: number | null): string {
  return ms === null ? "" : formatMillisecondsClock(ms);
}

/** Under this much time the clock shows as low. */
export const LOW_TIME_MS = 5 * 60_000;

export function isLive(board: Pick<BoardModel, "result">): boolean {
  return board.result === "*";
}

/** `Date.now()`, refreshed every second while mounted (running clocks). */
export function useSecondClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The analysis board's clock runs from the last move: date a streamed game's from the round
 * summary (read at `readAt`) when the stream can't.
 */
export function dateFromSummary(
  detail: BroadcastRoundDetail,
  gameId: string,
  readAt: number
): void {
  const game = detail.games.find((item) => item.id === gameId);
  if (!game) return;
  const store = useBroadcastStore.getState();
  const board = boardModel(game, store.games[gameId], readAt);
  if (board.lastMoveAt !== null) store.dateLastMove(gameId, board.lastMove, board.lastMoveAt);
}
