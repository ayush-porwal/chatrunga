import { statSync } from "node:fs";
import type { AnalysisLine, MoveReview } from "@chaturanga/shared/types/engine";

/** One reviewed move, as the next move of the same line needs it. */
export type CachedMove = {
  review: MoveReview;
  /** The engine's lines for the position after the move (the next move's top lines). */
  replyLines: AnalysisLine[];
};

/**
 * Finished review moves, kept per review configuration (engine, its settings, search budget,
 * MultiPV, Maia levels, rating, review version). Reviewing again with the same configuration — after
 * Cancel, or after changing a later move — reuses the moves already done; any change of
 * configuration is a different key, so its results are never mixed in. Bounded (least recently
 * used configurations and moves go first); lives as long as the app.
 */
export class ReviewCache {
  private readonly jobs = new Map<string, Map<string, CachedMove>>();

  constructor(
    private readonly maxJobs = 4,
    private readonly maxMovesPerJob = 4_000
  ) {}

  /** The moves cached for `jobKey` (created if new), most recent configuration kept last. */
  job(jobKey: string): Map<string, CachedMove> {
    let moves = this.jobs.get(jobKey);
    if (moves) this.jobs.delete(jobKey);
    else moves = new Map();
    this.jobs.set(jobKey, moves);
    while (this.jobs.size > this.maxJobs) this.jobs.delete(this.jobs.keys().next().value!);
    return moves;
  }

  static put(moves: Map<string, CachedMove>, key: string, move: CachedMove, max: number): void {
    moves.delete(key);
    moves.set(key, move);
    while (moves.size > max) moves.delete(moves.keys().next().value!);
  }

  get maxMoves(): number {
    return this.maxMovesPerJob;
  }
}

/**
 * A move's cache key: the position, the move and the move before it (the review's classification
 * reads the previous move), so the same move in the same position reuses its analysis.
 */
export function moveKey(fenBefore: string, uci: string, previousUci: string | null): string {
  return `${fenBefore}|${uci}|${previousUci ?? ""}`;
}

/**
 * The size and modification time of an engine's binary or weights file, so a file replaced at the
 * same path (an engine update installs in place) is a different configuration; null when missing.
 */
export function fileStamp(path: string | null): string | null {
  if (!path) return null;
  try {
    const file = statSync(path);
    return `${file.size}:${file.mtimeMs}`;
  } catch {
    return null;
  }
}
