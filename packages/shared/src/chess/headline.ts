import type { RatingCurve } from "../schemas/rating-curve";
import { probFor } from "./rating-curve";

/**
 * Maia rating-curve note renderer (fixed copy, not LLM-generated).
 *
 * Maps a RatingCurve interpretation label to the short Maia note shown in the
 * Game Review commentary panel. Fixed templates per label, so the note is
 * deterministic and never hallucinates.
 *
 * Returns `null` when the label is `neutral` — the panel then omits the note.
 *
 * Percentages are rounded to the nearest 5% (clamped to 5-95).
 *
 * Copy is intentionally framed as a Maia model estimate, not as a measured
 * claim about a population of human players.
 */
export function renderHeadline(curve: RatingCurve): string | null {
  switch (curve.interpretation.label) {
    case "trap_at_low_rating":
      return renderTrap(curve);

    case "rating_cliff": {
      const cliff = curve.interpretation.cliffRating;
      if (!cliff) return "Maia estimates drop sharply at higher rating buckets.";
      return `Maia estimates drop sharply above ${cliff - 200}.`;
    }

    case "only_master_finds":
      return "Difficult — the lower-rated Maia models rarely select this.";

    case "your_level_blindspot": {
      const pct = roundPctTo5(probFor(curve, curve.userRatingBucket, "played") * 100);
      return `Maia assigns this move ${pct}% weight at your level, despite the engine's concern.`;
    }

    case "found_what_your_level_misses":
      return "Strong engine choice — lower-rated Maia models rarely select it.";

    case "opening_principle":
      return "Standard idea — the models agree on this continuation.";

    case "neutral":
      return null;

    default: {
      // Exhaustiveness check: a new label must get copy here; unknown labels render nothing.
      const exhaustive: never = curve.interpretation.label;
      void exhaustive;
      return null;
    }
  }
}

function renderTrap(curve: RatingCurve): string {
  const userPlayedProb = probFor(curve, curve.userRatingBucket, "played");
  // Specific variant lands when the player is squarely in the trap zone.
  if (userPlayedProb > 0.4 && userPlayedProb <= 0.7) {
    const pct = roundPctTo5(userPlayedProb * 100);
    return `Maia assigns this move ${pct}% weight in the lower buckets, even though the engine dislikes it.`;
  }
  // Otherwise the generic punch line wins.
  return "The lower-rated Maia models frequently select this move.";
}

function roundPctTo5(pct: number): number {
  return Math.max(5, Math.min(95, Math.round(pct / 5) * 5));
}
