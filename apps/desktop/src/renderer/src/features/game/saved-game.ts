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

/** Loads a saved game and its newest analysis (with the list of all of them) into the stores. */
export function openSavedGame(saved: SavedGame): void {
  useGameStore.getState().loadGame(sessionFromSavedGame(saved));
  useReviewStore.getState().loadReview(savedReview(saved), saved.reviews ?? []);
}

/** The renumbering each opened game's reviews need (see reviewWithRealPlies), for switching later. */
const plyShifts = new Map<string, number>();

/** Bumped by each switch, so only the latest one lands. */
let analysisRequest = 0;

/**
 * Shows another saved analysis of the loaded game (and its AI commentary) instead of the one
 * shown. False when it's gone, or something changed while it loaded: the board moved to another
 * game, a later switch was asked for, a review started (its result must still be saved), or the
 * analysis shown changed (a run finished).
 */
export async function showSavedAnalysis(gameId: string, reviewId: string): Promise<boolean> {
  const request = ++analysisRequest;
  const shownBefore = useReviewStore.getState().review?.reviewId ?? null;
  const review = await window.chaturanga?.games.getReview(gameId, reviewId);
  const store = useReviewStore.getState();
  if (
    !review ||
    request !== analysisRequest ||
    useGameStore.getState().gameId !== gameId ||
    store.status === "running" ||
    (store.review?.reviewId ?? null) !== shownBefore
  ) {
    return false;
  }
  store.loadReview(reviewWithRealPlies(review, plyShifts.get(gameId) ?? 0));
  return true;
}

/** A saved game's stored review, numbered like its (renumbered) tree. */
export function savedReview(saved: SavedGame): GameReview | null {
  const shift = legacyPlyShift(saved.moveTree);
  plyShifts.set(saved.id, shift);
  return reviewWithRealPlies(saved.review ?? null, shift);
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
