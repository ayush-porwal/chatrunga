import type { ModeRating } from "@chaturanga/shared/types/ratings";

/** "just now", "5m ago", "2h ago", "3d ago". */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Where a mode's rating comes from, under it in Settings → Ratings: "from Lichess · updated 2h ago"
 * for a synced one ("provisional on Lichess · …" while Lichess calls it so); null for a typed-in one.
 */
export function ratingSourceLabel(rating: ModeRating, now: number): string | null {
  if (rating.source === "manual") return null;
  const updated = `updated ${timeAgo(rating.syncedAt, now)}`;
  return rating.provisional ? `provisional on Lichess · ${updated}` : `from Lichess · ${updated}`;
}
