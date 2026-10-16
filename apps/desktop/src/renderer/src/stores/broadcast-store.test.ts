import { afterEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { BroadcastLiveGame } from "@chaturanga/shared/types/broadcast";
import { useBroadcastStore } from "./broadcast-store";

const player = { name: "A", title: null, rating: null, federation: null, fideId: null };

function game(moves: string[]): BroadcastLiveGame {
  return {
    id: "Game0001",
    roundId: "Round001",
    white: player,
    black: player,
    initialFen: START_FEN,
    moves: moves.map((uci) => ({ uci, san: uci, clock: null })),
    fen: START_FEN,
    lastMove: moves.at(-1) ?? null,
    result: "*",
    headers: { event: null, round: null, date: null, timeControl: null, site: null }
  };
}

const lastMoveAt = () => useBroadcastStore.getState().games.Game0001?.lastMoveAt;

describe("broadcast store", () => {
  afterEach(() => {
    vi.useRealTimers();
    useBroadcastStore.setState({ games: {}, connections: {}, follow: null, cleared: null });
  });

  it("dates a move it sees arrive, not the moves already there", () => {
    vi.useFakeTimers({ now: 5000 });
    const { receiveGame } = useBroadcastStore.getState();
    receiveGame(game(["e2e4"]));
    expect(lastMoveAt()).toBeNull();
    receiveGame(game(["e2e4"]));
    expect(lastMoveAt()).toBeNull();
    receiveGame(game(["e2e4", "e7e5"]));
    expect(lastMoveAt()).toBe(5000);
  });

  it("takes the summary's date for the last move only while the game is still on it", () => {
    const { receiveGame, dateLastMove } = useBroadcastStore.getState();
    receiveGame(game(["e2e4"]));
    dateLastMove("Game0001", "e7e5", 100);
    expect(lastMoveAt()).toBeNull();
    dateLastMove("Game0001", "e2e4", 100);
    expect(lastMoveAt()).toBe(100);
    // A date seen arriving isn't replaced.
    dateLastMove("Game0001", "e2e4", 50);
    expect(lastMoveAt()).toBe(100);
  });
});
