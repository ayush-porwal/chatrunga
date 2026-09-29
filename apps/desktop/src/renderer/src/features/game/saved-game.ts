import { importPgnText, legacyPlyShift, nodeIdForBoardFen, withRealPlies } from "@chaturanga/shared/chess/pgn";
import type { GameReview } from "@chaturanga/shared/types/engine";
import type { GameHeaders, GameSession, SavedGame } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";

/** A saved game row as a loadable game session. */
export function sessionFromSavedGame(saved: SavedGame): GameSession {
  return {
    id: saved.id,
    source: saved.source,
    headers: savedHeaders(saved),
    rootFen: saved.initialFen ?? saved.moveTree[0]?.fenAfter,
    currentFen: saved.currentFen,
    // Older rows have no node cursor; find the node for the saved board position.
    currentNodeId: saved.currentNodeId ?? nodeIdForBoardFen(saved.moveTree, saved.currentFen, "root"),
    moveTree: withRealPlies(saved.moveTree),
    pgn: saved.pgn
  };
}

/**
 * Every header of a saved game: the stored set, or for rows saved before headers were stored, the
 * ones in its PGN (Elo, time control, opening, termination…), so reopening doesn't drop them.
 */
function savedHeaders(saved: SavedGame): GameHeaders {
  const columns: GameHeaders = {
    event: saved.event,
    site: saved.site,
    date: saved.date,
    round: saved.round,
    white: saved.white,
    black: saved.black,
    result: saved.result
  };
  if (saved.headers) return { ...saved.headers, result: saved.result };
  try {
    return { ...importPgnText(saved.pgn).game.headers, ...columns };
  } catch {
    return columns;
  }
}

/** Loads a saved game and its stored review into the stores. */
export function openSavedGame(saved: SavedGame): void {
  useGameStore.getState().loadGame(sessionFromSavedGame(saved));
  useReviewStore.getState().loadReview(savedReview(saved));
}

/** A saved game's stored review, numbered like its (renumbered) tree. */
export function savedReview(saved: SavedGame): GameReview | null {
  return reviewWithRealPlies(saved.review ?? null, legacyPlyShift(saved.moveTree));
}

/** A review saved with a ply-0-rooted tree, renumbered the way `withRealPlies` renumbers the tree. */
export function reviewWithRealPlies(review: GameReview | null, shift: number): GameReview | null {
  if (!review || !shift) return review;
  return {
    ...review,
    moves: review.moves.map((move) => ({ ...move, ply: move.ply + shift })),
    ...(review.commentary
      ? { commentary: review.commentary.map((item) => ({ ...item, ply: item.ply + shift })) }
      : {})
  };
}
