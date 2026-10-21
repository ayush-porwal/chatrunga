import { useEffect } from "react";
import { createGameFromFen, exportGameToPgn } from "@chaturanga/shared/chess/pgn";
import type { BroadcastLiveGame, BroadcastPlayer } from "@chaturanga/shared/types/broadcast";
import type { GameHeaders, GameSession, SaveGameInput } from "@chaturanga/shared/types/chess";
import { withoutMoveSounds } from "../../app/useMoveSounds";
import { useRoundStream } from "../../queries/broadcasts";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { useGameStore } from "../../stores/game-store";
import { mainlinePath } from "../game/move-tree-model";
import { mergeLiveLine, pruneToLiveLine, restoreRemovedMoves } from "./live-line";

/**
 * A broadcast game opened on the analysis board keeps following the live game: new moves join
 * its main line (the cursor follows them while it is on the live position), and whatever the user
 * plays stays beside them as variations until "Back to live" clears it. The board is never saved
 * to the library (Export PGN keeps a copy).
 */

/** Where a followed game comes from, for its title and the way back to its tournament. */
export type BroadcastGameRef = {
  tourId: string;
  tourName: string;
  roundId: string;
  roundName: string;
  gameId: string;
};

function playerName(player: BroadcastPlayer): string {
  return player.title ? `${player.title} ${player.name}` : player.name;
}

/** The analysis board's copy of a live game, on its live position. Null if its moves don't play. */
export function broadcastSession(
  game: BroadcastLiveGame,
  ref: BroadcastGameRef
): GameSession | null {
  const headers: GameHeaders = {
    event: game.headers.event ?? ref.tourName,
    site: game.headers.site,
    date: game.headers.date,
    round: game.headers.round ?? ref.roundName,
    white: playerName(game.white),
    black: playerName(game.black),
    whiteElo: game.white.rating === null ? null : String(game.white.rating),
    blackElo: game.black.rating === null ? null : String(game.black.rating),
    timeControl: game.headers.timeControl,
    result: game.result === "½-½" ? "1/2-1/2" : game.result
  };
  const start = createGameFromFen({ fen: game.initialFen, source: "pgn-import", headers });
  const merged = mergeLiveLine(start.moveTree, game.moves);
  if (!merged) return null;
  const tip = merged.moveTree.find((node) => node.id === merged.liveIds.at(-1));
  return {
    ...start,
    moveTree: merged.moveTree,
    currentNodeId: tip?.id ?? start.currentNodeId,
    currentFen: tip?.fenAfter ?? start.currentFen,
    pgn: exportGameToPgn({ headers, moveTree: merged.moveTree })
  };
}

/**
 * The boards that held a broadcast game: never saved to the library, even after the follow ended
 * (a board is a number that is never reused).
 */
const broadcastBoards = new Set<number>();

/** Whether `board` held a broadcast game (autosave leaves it alone). */
export function isBroadcastBoard(board: number): boolean {
  return broadcastBoards.has(board);
}

/** Starts following `ref`'s game on the board now loaded (its tree already has the live line). */
export function followBoard(ref: BroadcastGameRef, liveIds: string[]): void {
  const game = useBroadcastStore.getState().games[ref.gameId];
  const { board } = useGameStore.getState();
  broadcastBoards.add(board);
  useBroadcastStore.getState().setFollow({
    ...ref,
    board,
    liveIds,
    result: game?.result ?? "*"
  });
}

/**
 * Back / Forward brought a followed game's board back (a copy of it as it was left): follow it
 * again, merging the live moves played since.
 */
export function refollowBoard(ref: BroadcastGameRef): void {
  const board = useGameStore.getState();
  const game = useBroadcastStore.getState().games[ref.gameId];
  if (game && !mergeLiveLine(board.moveTree, game.moves)) return;
  // The main line as it was left stands for the live line until the streamed game merges in.
  followBoard(
    ref,
    mainlinePath(board.moveTree).map((node) => node.id)
  );
  if (game) applyLiveGame(game);
}

/** Whether `board` is the broadcast game being followed now. */
export function isFollowedBoard(board: number): boolean {
  return useBroadcastStore.getState().follow?.board === board;
}

/** Merges the followed game's latest live moves into the board. */
export function applyLiveGame(game: BroadcastLiveGame): void {
  const { follow } = useBroadcastStore.getState();
  if (follow?.gameId !== game.id) return;
  const state = useGameStore.getState();
  if (state.board !== follow.board) return;
  const merged = mergeLiveLine(state.moveTree, game.moves, follow.liveIds);
  if (!merged) return;
  const unchanged =
    merged.moveTree.length === state.moveTree.length &&
    merged.moveTree.every((node, index) => node === state.moveTree[index]);
  const previousTip = follow.liveIds.at(-1);
  const tip = merged.liveIds.at(-1) ?? "root";
  if (!unchanged) {
    // On the live position (or a move taken back) the board moves on with the game; anywhere
    // else it stays put.
    const following =
      state.currentNodeId === previousTip ||
      !merged.moveTree.some((node) => node.id === state.currentNodeId);
    state.replaceMoveTree(merged.moveTree, following ? tip : state.currentNodeId);
  }
  // Every change, a corrected result going back to "*" included.
  if (game.result !== follow.result)
    state.patchHeaders({ result: game.result === "½-½" ? "1/2-1/2" : game.result });
  const sameLine =
    merged.liveIds.length === follow.liveIds.length &&
    merged.liveIds.every((id, index) => id === follow.liveIds[index]);
  if (!sameLine || game.result !== follow.result)
    useBroadcastStore.getState().patchFollow({ liveIds: merged.liveIds, result: game.result });
}

/**
 * A library copy of the followed board as it stands (your moves included): a new game of its own,
 * which the board's following never touches. Null when no broadcast game is followed here.
 */
export function followedCopy(): SaveGameInput | null {
  const { follow } = useBroadcastStore.getState();
  const state = useGameStore.getState();
  if (follow?.board !== state.board) return null;
  return {
    id: crypto.randomUUID(),
    source: "pgn-import",
    headers: state.headers,
    rootFen: state.moveTree.at(0)?.fenAfter ?? state.currentFen,
    currentFen: state.currentFen,
    currentNodeId: state.currentNodeId,
    pgn: exportGameToPgn({ headers: state.headers, moveTree: state.moveTree }),
    moveTree: state.moveTree
  };
}

/** Back to the live position, clearing every move the user played (undo puts them back). */
export function backToLive(): number {
  const { follow } = useBroadcastStore.getState();
  if (!follow) return 0;
  const state = useGameStore.getState();
  if (state.board !== follow.board) return 0;
  const { moveTree, removed } = pruneToLiveLine(state.moveTree, follow.liveIds);
  state.replaceMoveTree(moveTree, follow.liveIds.at(-1) ?? "root");
  useBroadcastStore.getState().setCleared(removed.length ? { board: follow.board, removed } : null);
  return removed.length;
}

/** Puts back what the last "Back to live" cleared (live moves since stay the main line). */
export function undoBackToLive(): void {
  const { cleared } = useBroadcastStore.getState();
  const state = useGameStore.getState();
  if (!cleared || cleared.board !== state.board) return;
  state.replaceMoveTree(restoreRemovedMoves(state.moveTree, cleared.removed), state.currentNodeId);
  useBroadcastStore.getState().setCleared(null);
}

/**
 * Merges the followed game's moves into its board as they arrive, starting with any that arrived
 * while it wasn't followed (put in silently: they weren't played just now). Returns the stop.
 */
export function followLiveMoves(): () => void {
  const { follow, games } = useBroadcastStore.getState();
  const waiting = follow ? games[follow.gameId] : undefined;
  if (waiting) withoutMoveSounds(() => applyLiveGame(waiting));
  return useBroadcastStore.subscribe((state, previous) => {
    const gameId = state.follow?.gameId;
    if (!gameId) return;
    const game = state.games[gameId];
    if (game && game !== previous.games[gameId]) applyLiveGame(game);
  });
}

/**
 * Keeps the followed game live while `shown` (its board on screen): its round's stream stays open
 * and its moves are merged as they arrive. Elsewhere it waits, its stream closed, so no move lands
 * (or sounds, or restarts the engine) behind another page; shown again, it catches up. Loading
 * another board ends the follow. Mount once in the shell.
 */
export function useBroadcastFollow(shown: boolean): void {
  const roundId = useBroadcastStore((state) => state.follow?.roundId ?? null);
  useRoundStream(shown ? roundId : null);
  useEffect(() => (shown ? followLiveMoves() : undefined), [shown]);
  useEffect(
    () =>
      useGameStore.subscribe((state) => {
        const { follow } = useBroadcastStore.getState();
        if (follow && state.board !== follow.board) useBroadcastStore.getState().setFollow(null);
      }),
    []
  );
}
