import type { SavedReviewInfo } from "../types/chess";
import { savedReviewCommentary, type GameReview } from "../types/engine";

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * How a saved analysis is listed (main stores these columns; the renderer adds a new run's).
 * Stored reviews come from older builds too, so every field is checked rather than trusted.
 */
export function savedReviewInfo(review: GameReview, reviewId: string): SavedReviewInfo {
  const maiaEngines = Array.isArray(review.maiaEngines) ? review.maiaEngines : [];
  const ratings = maiaEngines
    .map((engine) => finiteOrNull(engine?.rating))
    .filter((rating): rating is number => rating !== null);
  return {
    reviewId,
    createdAt: finiteOrNull(review.createdAt) ?? Date.now(),
    engineName: typeof review.engineName === "string" ? review.engineName.trim() || null : null,
    moveTimeMs: finiteOrNull(review.moveTimeMs) ?? finiteOrNull(review.engineSettings?.moveTimeMs),
    depth: finiteOrNull(review.depth) ?? finiteOrNull(review.engineSettings?.depth),
    maiaLevels: [...new Set(ratings)].sort((a, b) => a - b),
    moveCount: Array.isArray(review.moves) ? review.moves.length : 0,
    // The comments the app shows: older offline-template explanations are dropped on load.
    commentaryCount: Array.isArray(review.commentary)
      ? (savedReviewCommentary(review.commentary)?.length ?? 0)
      : 0
  };
}

/**
 * One line naming an analysis, for choosing between a game's analyses:
 * `Oct 2, 8:15 PM · Stockfish 17 · 1 s/move · Maia 1100–1900 · 12 AI comments`.
 */
export function reviewInfoLabel(info: SavedReviewInfo, locale?: string): string {
  return `${reviewInfoWhen(info, locale)} · ${reviewInfoDetails(info)}`;
}

/** When an analysis was made, the way it's picked out in a list: `Oct 2, 8:15 PM`. */
export function reviewInfoWhen(info: SavedReviewInfo, locale?: string): string {
  return new Date(info.createdAt).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** How an analysis was made: `Stockfish 17 · 1 s/move · Maia 1100–1900 · 12 AI comments`. */
export function reviewInfoDetails(info: SavedReviewInfo): string {
  const search = reviewInfoSearch(info);
  const maia = info.maiaLevels.length
    ? `Maia ${info.maiaLevels.length > 1 ? `${info.maiaLevels[0]}–${info.maiaLevels[info.maiaLevels.length - 1]}` : info.maiaLevels[0]}`
    : null;
  const comments = info.commentaryCount
    ? `${info.commentaryCount} AI comment${info.commentaryCount === 1 ? "" : "s"}`
    : null;
  return [info.engineName ?? "Engine", search, maia, comments].filter(Boolean).join(" · ");
}

/** How an analysis was made, in brief (a list row's second line): `Stockfish 17 · 1 s/move`. */
export function reviewInfoBrief(info: SavedReviewInfo): string {
  return [info.engineName ?? "Engine", reviewInfoSearch(info)].filter(Boolean).join(" · ");
}

function reviewInfoSearch(info: SavedReviewInfo): string | null {
  if (info.moveTimeMs !== null) {
    const time =
      info.moveTimeMs >= 1000
        ? `${+(info.moveTimeMs / 1000).toFixed(1)} s`
        : `${info.moveTimeMs} ms`;
    return `${time}/move`;
  }
  return info.depth !== null ? `depth ${info.depth}` : null;
}
