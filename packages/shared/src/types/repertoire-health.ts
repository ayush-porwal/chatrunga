/**
 * Repertoire health check (docs/repertoire-games-and-practice.md §6.3): flags a background queue
 * in main stores per repertoire and position. Study's choices panel, its Explorer and Insights
 * show them.
 */

/**
 * - `engine-disagrees`: a practised move of the player's loses ≥ 10 win-% against the engine's best;
 * - `no-answer`: a covered reply after which the player has no practised move (and no stop/end);
 * - `common-mistake`: at a covered opponent position Maia puts ≥ 30% on a move losing ≥ 20 win-%.
 */
export const REPERTOIRE_HEALTH_FLAG_KINDS = [
  "engine-disagrees",
  "no-answer",
  "common-mistake"
] as const;
export type RepertoireHealthFlagKind = (typeof REPERTOIRE_HEALTH_FLAG_KINDS)[number];

export type RepertoireHealthFlag = {
  repertoireId: string;
  /** The position the flag is about (before the flagged move). */
  positionKey: string;
  /** Its FEN, so the flag can be shown and opened without the repertoire's index. */
  fen: string;
  kind: RepertoireHealthFlagKind;
  /** The flagged move (UCI): the player's weak move, the covered reply, or the opponent's mistake. */
  uci: string;
  /** `uci` in SAN, from `fen`. */
  san: string;
  /** The engine's best move (UCI) where the flag has one: the better move, or the punishment. */
  bestUci: string | null;
  /**
   * `bestUci` in SAN: from `fen` for `engine-disagrees`, from the position after `uci` for
   * `common-mistake` (the punishment).
   */
  bestSan: string | null;
  /** Win-% lost by `uci` against `bestUci` (for the side that plays it); null for `no-answer`. */
  loss: number | null;
  /** Maia's probability of `uci` at `rating` (`common-mistake` only). */
  probability: number | null;
  rating: number | null;
  /** The line to `fen` in the repertoire (its first occurrence), e.g. "1. e4 c6 2. d4". */
  line: string;
  /** Where Study opens the flag: the position's first occurrence. */
  chapterId: string;
  nodeId: string;
  /** The repertoire revision the flag was found against. */
  revision: number;
  checkedAt: number;
};

/** A repertoire's place in the health queue: waiting, being checked, checked, or failed. */
export type RepertoireHealthState = "queued" | "running" | "done" | "failed";

/** Insights' Repertoire health card: one row per repertoire. */
export type RepertoireHealthSummary = {
  repertoireId: string;
  name: string;
  /** Flags per kind (positions still in the repertoire only). */
  counts: Record<RepertoireHealthFlagKind, number>;
  /** null: never checked. */
  state: RepertoireHealthState | null;
  /** When it was last checked through (null: never), and the revision it was. */
  checkedAt: number | null;
  checkedRevision: number | null;
  /** The last check's error (state `failed`). */
  error: string | null;
};

/** The repertoire being checked, and how far through its positions. */
export type RepertoireHealthCurrent = {
  repertoireId: string;
  name: string;
  done: number;
  total: number;
};

export type RepertoireHealthQueueStatus = {
  paused: boolean;
  /** Holding while the user uses an engine elsewhere. */
  waitingForEngine: boolean;
  /** Holding while the puzzle queue runs a game (one engine-heavy queue at a time). */
  waitingForPuzzles: boolean;
  /** Why the queue stopped short (no usable default engine, or it won't start), else null. */
  problem: string | null;
  /** Repertoires waiting, in order (the running one not included). */
  queued: string[];
  current: RepertoireHealthCurrent | null;
};

/** `repertoireExplorer:healthProgress`: the queue's status, and whose flags just changed. */
export type RepertoireHealthEvent = {
  status: RepertoireHealthQueueStatus;
  /** The repertoire whose flags were rewritten, else null. */
  flagsChanged: string | null;
};
