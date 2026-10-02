import type { SavedReviewInfo } from "../types/chess";
import type { GameReview } from "../types/engine";

/** How a saved analysis is listed (main stores these columns; the renderer adds a new run's). */
export function savedReviewInfo(review: GameReview, reviewId: string): SavedReviewInfo {
  return {
    reviewId,
    createdAt: Number.isFinite(review.createdAt) ? review.createdAt : Date.now(),
    engineName: review.engineName?.trim() || null,
    moveTimeMs: review.moveTimeMs ?? review.engineSettings?.moveTimeMs ?? null,
    depth: review.depth ?? review.engineSettings?.depth ?? null,
    maiaLevels: [...new Set((review.maiaEngines ?? []).map((engine) => engine.rating))].sort((a, b) => a - b),
    moveCount: Array.isArray(review.moves) ? review.moves.length : 0,
    commentaryCount: review.commentary?.length ?? 0
  };
}

/**
 * One line naming an analysis, for choosing between a game's analyses:
 * `Oct 2, 20:15 · Stockfish 17 · 1 s/move · Maia 1100–1900 · 12 AI comments`.
 */
export function reviewInfoLabel(info: SavedReviewInfo, locale?: string): string {
  const when = new Date(info.createdAt).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const search =
    info.moveTimeMs !== null
      ? `${info.moveTimeMs >= 1000 ? `${+(info.moveTimeMs / 1000).toFixed(1)} s` : `${info.moveTimeMs} ms`}/move`
      : info.depth !== null
        ? `depth ${info.depth}`
        : null;
  const maia = info.maiaLevels.length
    ? `Maia ${info.maiaLevels.length > 1 ? `${info.maiaLevels[0]}–${info.maiaLevels[info.maiaLevels.length - 1]}` : info.maiaLevels[0]}`
    : null;
  const comments = info.commentaryCount ? `${info.commentaryCount} AI comment${info.commentaryCount === 1 ? "" : "s"}` : null;
  return [when, info.engineName ?? "Engine", search, maia, comments].filter(Boolean).join(" · ");
}
