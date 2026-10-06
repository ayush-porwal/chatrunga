import { importPgnText, nodeIdForBoardFen, withRealPlies } from "@chaturanga/shared/chess/pgn";
import type { GameReview } from "@chaturanga/shared/types/engine";
import type {
  GameHeaders,
  GameSession,
  MoveNode,
  SavedGame,
  SavedReviewInfo
} from "@chaturanga/shared/types/chess";
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
    currentNodeId:
      saved.currentNodeId ?? nodeIdForBoardFen(saved.moveTree, saved.currentFen, "root"),
    moveTree: withRealPlies(saved.moveTree),
    pgn: saved.pgn,
    ...(saved.analysisBoard === undefined ? {} : { analysisBoard: saved.analysisBoard })
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

/** Bumped by each switch (and each game opened), so only the latest one lands. */
let analysisRequest = 0;

/** Loads a saved game and its newest analysis (with the list of all of them) into the stores. */
export function openSavedGame(saved: SavedGame): void {
  // A switch still loading belongs to the board being replaced (even if it's this same game).
  analysisRequest += 1;
  useGameStore.getState().loadGame(sessionFromSavedGame(saved));
  useReviewStore.getState().loadReview(savedReview(saved), saved.reviews ?? []);
}

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
  store.loadReview(alignReviewToTree(review, useGameStore.getState().moveTree));
  return true;
}

/**
 * The saved analysis Game review shows: the one loaded, or the newest for a review saved before
 * reviews had ids. Null while none is shown.
 */
export function shownAnalysisId(
  analyses: readonly SavedReviewInfo[],
  review: GameReview | null
): string | null {
  if (!review) return null;
  const id = review.reviewId;
  return id && analyses.some((info) => info.reviewId === id) ? id : (analyses[0]?.reviewId ?? null);
}

/**
 * After saved analyses of the game on the board were deleted (their ids, or `"all"`): they leave
 * the list, and when the one shown went, the newest left is shown instead, or none, so Game review
 * offers Analyze again. A review running keeps the board; another game opened meanwhile is left
 * alone.
 */
export async function showAfterAnalysesDeleted(
  gameId: string,
  deleted: readonly string[] | "all"
): Promise<void> {
  if (useGameStore.getState().gameId !== gameId) return;
  const store = useReviewStore.getState();
  const gone = (reviewId: string) => deleted === "all" || deleted.includes(reviewId);
  const shownId = shownAnalysisId(store.analyses, store.review);
  const left = store.analyses.filter((info) => !gone(info.reviewId));
  store.setAnalyses(left);
  const shown = store.review;
  if (!shown || shownId === null || !gone(shownId) || store.status === "running") return;
  const next = left[0];
  if (next && (await showSavedAnalysis(gameId, next.reviewId).catch(() => false))) return;
  const now = useReviewStore.getState();
  if (
    useGameStore.getState().gameId === gameId &&
    now.status !== "running" &&
    now.review?.createdAt === shown.createdAt &&
    now.review.reviewId === shown.reviewId
  ) {
    now.loadReview(null);
  }
}

/** A saved game's stored review, numbered like its (renumbered) tree. */
export function savedReview(saved: SavedGame): GameReview | null {
  return saved.review ? alignReviewToTree(saved.review, withRealPlies(saved.moveTree)) : null;
}

/**
 * A stored review numbered like `moveTree` (the session's, real plies). Each analysis is aligned
 * on its own, by a move it shares with the tree: one saved before real plies is renumbered, one
 * already rewritten with them is left as it is, whatever the game's other analyses are.
 */
export function alignReviewToTree(review: GameReview, moveTree: readonly MoveNode[]): GameReview {
  const plies = new Map(moveTree.map((node) => [node.id, node.ply]));
  const shared = review.moves.find((move) => plies.has(move.nodeId));
  const shift = shared ? plies.get(shared.nodeId)! - shared.ply : 0;
  return shift ? (reviewWithRealPlies(review, shift) ?? review) : review;
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
