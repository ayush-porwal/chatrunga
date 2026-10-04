import { statusForFen } from "@chaturanga/shared/chess/position";

type PositionStatus = ReturnType<typeof statusForFen>;

const cache = new Map<string, PositionStatus>();
const CACHE_SIZE = 64;

/**
 * `statusForFen` with a small cache, cheap enough to call from store selectors: a selector runs on
 * every store update, and the same few positions are asked for by several components per move.
 */
export function positionStatus(fen: string): PositionStatus {
  const hit = cache.get(fen);
  if (hit) return hit;
  const status = statusForFen(fen);
  const oldest = cache.keys().next();
  if (cache.size >= CACHE_SIZE && !oldest.done) cache.delete(oldest.value);
  cache.set(fen, status);
  return status;
}
