import { create } from "zustand";
import type { BroadcastLiveGame, BroadcastResult } from "@chaturanga/shared/types/broadcast";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { NO_HUB_FILTER, type HubFilter } from "../features/broadcasts/broadcast-text";

/** A streamed game and when its last move arrived (for the clock of the side to move). */
export type StreamedGame = BroadcastLiveGame & {
  /** When the last move was seen arriving (epoch ms); null for moves already there on arrival. */
  lastMoveAt: number | null;
};

/**
 * A round stream's trouble, if any (null: connected, or not watched): retrying on its own, or
 * stopped for good (`error` says why).
 */
type RoundConnection = { error: string | null; retrying: boolean } | null;

/** The broadcast game on the analysis board, followed live. */
export type BroadcastFollow = {
  /** The game store's board it was loaded on: another board ends the follow. */
  board: number;
  tourId: string;
  tourName: string;
  roundId: string;
  roundName: string;
  gameId: string;
  /** The live line's node ids in the game's tree, root first (its last is the live position). */
  liveIds: string[];
  result: BroadcastResult;
};

/** A game you asked to hear about when it ends (a desktop notification), with its players. */
export type GameAlert = { roundId: string; white: string; black: string };

/** What "Back to live" cleared, kept for its undo (on the board it was cleared on). */
type ClearedMoves = { board: number; removed: MoveNode[] };

type BroadcastStore = {
  /** The latest of each streamed game, by game id. */
  games: Partial<Record<string, StreamedGame>>;
  connections: Partial<Record<string, RoundConnection>>;
  follow: BroadcastFollow | null;
  cleared: ClearedMoves | null;
  /** The hub's filter, kept while the app runs (into a tournament and back). */
  hubFilter: HubFilter;
  /** The games to notify about when they end, by game id (while the app runs). */
  alerts: Partial<Record<string, GameAlert>>;
  receiveGame: (game: BroadcastLiveGame) => void;
  /**
   * When a streamed game's last move was played, from the round summary's think time (the stream
   * only dates the moves it sees arrive). Ignored once the game has moved on from `lastMove`.
   */
  dateLastMove: (gameId: string, lastMove: string | null, at: number) => void;
  setConnection: (roundId: string, connection: RoundConnection) => void;
  setFollow: (follow: BroadcastFollow | null) => void;
  patchFollow: (patch: Partial<Omit<BroadcastFollow, "board">>) => void;
  setCleared: (cleared: ClearedMoves | null) => void;
  setHubFilter: (filter: HubFilter) => void;
  /** Asks for an alert when the game ends (`alert`), or drops it (null). */
  setAlert: (gameId: string, alert: GameAlert | null) => void;
};

export const useBroadcastStore = create<BroadcastStore>((set) => ({
  games: {},
  connections: {},
  follow: null,
  cleared: null,
  hubFilter: NO_HUB_FILTER,
  alerts: {},
  receiveGame: (game) =>
    set((state) => {
      const previous = state.games[game.id];
      // A new move arrived just now; the first sight of a game has moves of unknown age.
      const moved = previous !== undefined && game.moves.length !== previous.moves.length;
      const lastMoveAt = moved ? Date.now() : (previous?.lastMoveAt ?? null);
      return { games: { ...state.games, [game.id]: { ...game, lastMoveAt } } };
    }),
  dateLastMove: (gameId, lastMove, at) =>
    set((state) => {
      const game = state.games[gameId];
      if (!game || game.lastMoveAt !== null || game.lastMove !== lastMove) return state;
      return { games: { ...state.games, [gameId]: { ...game, lastMoveAt: at } } };
    }),
  setConnection: (roundId, connection) =>
    set((state) =>
      state.connections[roundId] === connection
        ? state
        : { connections: { ...state.connections, [roundId]: connection } }
    ),
  setFollow: (follow) => set({ follow, cleared: null }),
  patchFollow: (patch) =>
    set((state) => (state.follow ? { follow: { ...state.follow, ...patch } } : state)),
  setCleared: (cleared) => set({ cleared }),
  setHubFilter: (hubFilter) => set({ hubFilter }),
  setAlert: (gameId, alert) =>
    set((state) => {
      const { [gameId]: _dropped, ...rest } = state.alerts;
      return { alerts: alert ? { ...rest, [gameId]: alert } : rest };
    })
}));
