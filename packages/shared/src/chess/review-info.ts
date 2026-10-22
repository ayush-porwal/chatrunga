import type { SavedReviewInfo } from "../types/chess";
import { savedReviewCommentary, type GameReview } from "../types/engine";
import { isRecord } from "../types/guards";

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const sideRating = (side: unknown): number | null =>
  isRecord(side) ? finiteOrNull(side.rating) : null;

/**
 * Which Maia read the moves, and at what ratings: Maia 3 when the review records it (White's and
 * Black's ratings, in that order, when both are readable), else Maia 1 when it ran Maia engines
 * (its levels, ascending); no model for neither.
 */
function maiaOf(review: GameReview): Pick<SavedReviewInfo, "maiaLevels" | "maiaModel"> {
  // Stored by any build: checked, not trusted.
  const maia: unknown = review.maia;
  if (isRecord(maia) && maia.model === "maia3") {
    const white = sideRating(maia.white);
    const black = sideRating(maia.black);
    return {
      maiaLevels: white !== null && black !== null ? [white, black] : [],
      maiaModel: "maia3"
    };
  }
  const maiaEngines: readonly unknown[] = Array.isArray(review.maiaEngines)
    ? review.maiaEngines
    : [];
  const ratings = maiaEngines
    .map((engine) => finiteOrNull(isRecord(engine) ? engine.rating : null))
    .filter((rating): rating is number => rating !== null);
  const maiaLevels = [...new Set(ratings)].sort((a, b) => a - b);
  return maiaLevels.length ? { maiaLevels, maiaModel: "maia1" } : { maiaLevels };
}

/**
 * How a saved analysis is listed (main stores these columns; the renderer adds a new run's).
 * Stored reviews come from older builds too, so every field is checked rather than trusted.
 */
export function savedReviewInfo(review: GameReview, reviewId: string): SavedReviewInfo {
  return {
    reviewId,
    createdAt: finiteOrNull(review.createdAt) ?? Date.now(),
    engineId: typeof review.engineId === "string" ? review.engineId.trim() || null : null,
    engineName: typeof review.engineName === "string" ? review.engineName.trim() || null : null,
    moveTimeMs: finiteOrNull(review.moveTimeMs) ?? finiteOrNull(review.engineSettings?.moveTimeMs),
    depth: finiteOrNull(review.depth) ?? finiteOrNull(review.engineSettings?.depth),
    ...maiaOf(review),
    moveCount: Array.isArray(review.moves) ? review.moves.length : 0,
    // The comments the app shows: older offline-template explanations are dropped on load.
    commentaryCount: Array.isArray(review.commentary)
      ? (savedReviewCommentary(review.commentary)?.length ?? 0)
      : 0
  };
}

/**
 * One line naming an analysis, for choosing between a game's analyses:
 * `Oct 2, 8:15 PM · Stockfish 17 · 1 s/move · Maia 3 · 1500/1600 · 12 AI comments`.
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

/**
 * The Maia an analysis read the moves with: Maia 3 at White's/Black's ratings (`Maia 3 ·
 * 1500/1600`, one rating when both sides were read at it), or Maia 1's levels (`Maia 1100–1900`).
 */
function reviewInfoMaia(info: SavedReviewInfo): string | null {
  const levels = info.maiaLevels;
  if (info.maiaModel === "maia3") {
    if (levels.length < 2) return "Maia 3";
    const [white, black] = levels;
    return `Maia 3 · ${white === black ? white : `${white}/${black}`}`;
  }
  if (!levels.length) return null;
  return `Maia ${levels.length > 1 ? `${levels[0]}–${levels[levels.length - 1]}` : levels[0]}`;
}

/** How an analysis was made: `Stockfish 17 · 1 s/move · Maia 1100–1900 · 12 AI comments`. */
export function reviewInfoDetails(info: SavedReviewInfo): string {
  const search = reviewInfoSearch(info);
  const maia = reviewInfoMaia(info);
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
