import { nodeIdForBoardFen, withRealPlies } from "@chaturanga/shared/chess/pgn";
import type { GameSession, SavedGame } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";

/** A saved game row as a loadable game session. */
export function sessionFromSavedGame(saved: SavedGame): GameSession {
  return {
    id: saved.id,
    source: saved.source,
    headers: {
      event: saved.event,
      site: saved.site,
      date: saved.date,
      round: saved.round,
      white: saved.white,
      black: saved.black,
      result: saved.result
    },
    rootFen: saved.initialFen ?? saved.moveTree[0]?.fenAfter,
    currentFen: saved.currentFen,
    // Older rows have no node cursor; find the node for the saved board position.
    currentNodeId: saved.currentNodeId ?? nodeIdForBoardFen(saved.moveTree, saved.currentFen, "root"),
    moveTree: withRealPlies(saved.moveTree),
    pgn: saved.pgn
  };
}

/** Loads a saved game and its stored review into the stores. */
export function openSavedGame(saved: SavedGame): void {
  useGameStore.getState().loadGame(sessionFromSavedGame(saved));
  useReviewStore.getState().loadReview(saved.review ?? null);
}
