import type { GameReview, RatingPrediction } from "@chaturanga/shared/types/engine";
import type { SavedReviewInfo } from "@chaturanga/shared/types/chess";
import { savedReviewInfo } from "@chaturanga/shared/chess/review-info";
import { isRecord } from "@chaturanga/shared/types/guards";
import { parseStoredJson } from "../stored-json";

/** A saved analysis (table `game_reviews`): the review JSON plus what's needed to list it. */
export type GameReviewRow = {
  review_id: string;
  game_id: string;
  created_at: number;
  /** The engine row that ran it (`GameReview.engineId`); null when the review doesn't record one. */
  engine_id: string | null;
  engine_name: string | null;
  move_time_ms: number | null;
  depth: number | null;
  /**
   * Maia 1's ratings (`[1100, 1900]`), or `["maia3", { white, black }]` for a Maia 3 review (see
   * MAIA3_LISTING; the sides' ratings when it recorded them).
   */
  maia_levels_json: string;
  move_count: number;
  commentary_count: number;
  review_json: string;
};

/**
 * How a Maia 3 review is listed in `maia_levels_json` (it has no levels): this marker, then the
 * sides' ratings as an object. Builds that only know Maia 1 keep the array's integers as levels,
 * so they drop both and list the review without Maia (integers would read as "Maia 1500–1600").
 */
const MAIA3_LISTING = "maia3";

/** The listing columns of a review (everything but the ids and the JSON). */
export function reviewListingFields(review: GameReview) {
  const info = savedReviewInfo(review, "");
  const [white, black] = info.maiaLevels;
  return {
    created_at: info.createdAt,
    engine_id: info.engineId,
    engine_name: info.engineName,
    move_time_ms: info.moveTimeMs,
    depth: info.depth,
    maia_levels_json: JSON.stringify(
      info.maiaModel !== "maia3"
        ? info.maiaLevels
        : info.maiaLevels.length === 2
          ? [MAIA3_LISTING, { white, black }]
          : [MAIA3_LISTING]
    ),
    move_count: info.moveCount,
    commentary_count: info.commentaryCount
  };
}

const isInteger = (value: unknown): value is number => Number.isInteger(value);

/** Maia 3's listed ratings: White's and Black's (`{ white, black }`), else none. */
function listedMaia3Ratings(values: readonly unknown[]): number[] {
  for (const value of values) {
    if (isRecord(value) && isInteger(value.white) && isInteger(value.black))
      return [value.white, value.black];
  }
  // Listed by the first Maia 3 builds (in development only): the ratings as plain integers.
  return values.filter(isInteger);
}

/** The Maia a listing records: Maia 1's levels, or Maia 3. */
function listedMaia(json: string): Pick<SavedReviewInfo, "maiaLevels" | "maiaModel"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { maiaLevels: [] };
  }
  if (!Array.isArray(parsed)) return { maiaLevels: [] };
  const values: readonly unknown[] = parsed;
  if (values.includes(MAIA3_LISTING))
    return { maiaLevels: listedMaia3Ratings(values), maiaModel: "maia3" };
  const maiaLevels = values.filter(isInteger);
  return maiaLevels.length ? { maiaLevels, maiaModel: "maia1" } : { maiaLevels };
}

export function toSavedReviewInfo(
  row: Omit<GameReviewRow, "game_id" | "review_json">
): SavedReviewInfo {
  return {
    reviewId: row.review_id,
    createdAt: row.created_at,
    engineId: row.engine_id,
    engineName: row.engine_name,
    moveTimeMs: row.move_time_ms,
    depth: row.depth,
    ...listedMaia(row.maia_levels_json),
    moveCount: row.move_count,
    commentaryCount: row.commentary_count
  };
}

/** A review's id for its row: the run's id, or a stable one for a review saved before runs had ids. */
export function reviewRowId(review: GameReview, gameId: string): string {
  return review.reviewId?.trim() || `legacy-${gameId}-${review.createdAt}`;
}

/**
 * The move of a saved analysis Maia 3's rating curve goes into: its index in the analysis as
 * getReview placed it, and the move itself (its ply and the position after it), which the stored
 * move must still be.
 */
export type MaiaCurveTarget = {
  index: number;
  ply: number;
  fenAfter: string;
  curve: RatingPrediction[];
};

/** Moves are matched across saves of one analysis by ply and the position after them. */
const moveIdentity = (move: { ply?: unknown; fenAfter?: unknown }) =>
  JSON.stringify([move.ply, move.fenAfter]);

/**
 * A stored review's JSON with Maia 3's rating curve saved as one move's `humanPredictions`; null
 * when the JSON can't be read or that move isn't there any more.
 */
export function reviewJsonWithCurve(json: string, target: MaiaCurveTarget): string | null {
  let review: GameReview;
  try {
    review = parseStoredJson<GameReview>(json);
  } catch {
    return null;
  }
  // Stored by any build: checked, not trusted.
  if (!isRecord(review) || !Array.isArray(review.moves)) return null;
  const move: unknown = review.moves[target.index];
  if (!isRecord(move) || moveIdentity(move) !== moveIdentity(target)) return null;
  const moves = review.moves.map((item, index) =>
    index === target.index ? { ...item, humanPredictions: target.curve } : item
  );
  return JSON.stringify({ ...review, moves });
}

/**
 * `review` with the Maia 3 rating curves its stored version (`storedJson`) holds and it lacks.
 * Curves are saved into the stored analysis (engines.maiaCurve); a renderer that loaded the
 * analysis before then saves it again without them, and they must not be lost.
 */
export function withStoredCurves(review: GameReview, storedJson: string | undefined): GameReview {
  if (!storedJson || review.moves.every((move) => move.humanPredictions?.length)) return review;
  let stored: GameReview;
  try {
    stored = parseStoredJson<GameReview>(storedJson);
  } catch {
    return review;
  }
  if (!isRecord(stored) || !Array.isArray(stored.moves)) return review;
  const curves = new Map<string, RatingPrediction[]>();
  for (const move of stored.moves) {
    if (isRecord(move) && Array.isArray(move.humanPredictions) && move.humanPredictions.length)
      curves.set(moveIdentity(move), move.humanPredictions);
  }
  if (!curves.size) return review;
  return {
    ...review,
    moves: review.moves.map((move) => {
      const curve = move.humanPredictions?.length ? undefined : curves.get(moveIdentity(move));
      return curve ? { ...move, humanPredictions: curve } : move;
    })
  };
}
