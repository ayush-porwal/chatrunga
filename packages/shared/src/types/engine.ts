import type { Color } from "./chess";

export type EngineProtocol = "uci";
export type EngineStatus = "idle" | "starting" | "ready" | "thinking" | "error";
/** Every engine runs as a native UCI process from the engines table (managed download or user-added). */
export type EngineRuntime = "custom-uci";

export type EngineConfig = {
  id: string;
  name: string;
  executablePath: string;
  workingDirectory: string | null;
  weightsPath: string | null;
  imagePath: string | null;
  args: string[];
  protocol: EngineProtocol;
  runtime: EngineRuntime;
  isAvailable: boolean;
  isDefault: boolean;
  isHumanPrediction?: boolean;
  /**
   * For Maia engines: the rating bucket this weight file represents. The
   * rating curve needs one Maia engine per rating, each tagged with its bucket.
   */
  maiaRating?: MaiaRating;
  createdAt: number;
  updatedAt: number;
};

export type CreateEngineInput = {
  name: string;
  executablePath: string;
  workingDirectory?: string | null;
  weightsPath?: string | null;
  imagePath?: string | null;
  args?: string[];
  isDefault?: boolean;
  isHumanPrediction?: boolean;
  maiaRating?: MaiaRating;
};

export type UpdateEngineInput = Partial<CreateEngineInput>;

export type EngineTestResult = {
  ok: boolean;
  name?: string;
  author?: string;
  isHumanPrediction?: boolean;
  error?: string;
};

export type StartEngineGameInput = {
  engineId: string;
  /** Chosen by the renderer; the search's events carry it, so late output of an older search is ignored. */
  searchId: string;
  /** The match this move belongs to: a new one resets the engine (`ucinewgame`), even from the same position. */
  gameKey?: string;
  side: Color;
  fen: string;
  moves: string[];
  moveTimeMs?: number | null;
  depth?: number | null;
  /**
   * When set, sends `go wtime … btime … winc … binc …` (milliseconds). Omit `movetime` / `depth`.
   * Standard UCI clock units are milliseconds.
   */
  clock?: EngineGoClock | null;
};

export type StartLiveAnalysisInput = {
  engineId: string;
  /** See `StartEngineGameInput.searchId`. */
  searchId: string;
  fen: string;
  moves: string[];
  multipv?: number | null;
  /** Search to this depth, then stop (Ready). Neither this nor moveTimeMs: search until stopped. */
  depth?: number | null;
  /** Search for this long (ms), then stop. */
  moveTimeMs?: number | null;
};

/** Clock snapshot passed to UCI `go` for timed games. */
export type EngineGoClock = {
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
};

export type ProbeEvalInput = {
  engineId: string;
  fen: string;
  moves: string[];
  /** Short probe — 250–500 ms typical */
  movetimeMs: number;
};

export type EngineScore = {
  type: "cp" | "mate";
  value: number;
};

/** Win/draw/loss in permille (sums to ~1000), side-to-move perspective, as UCI `wdl` reports it. */
export type Wdl = { win: number; draw: number; loss: number };

export type EngineInfo = {
  engineId: string;
  /** The search this line belongs to (live engine only; review and probes don't set it). */
  searchId?: string;
  depth?: number;
  seldepth?: number;
  multipv?: number;
  nodes?: number;
  nps?: number;
  score?: EngineScore;
  /** Present when the engine was asked for `UCI_ShowWDL`. */
  wdl?: Wdl;
  pv?: string[];
  raw: string;
  receivedAt: number;
};

export type EngineBestMove = {
  engineId: string;
  searchId?: string;
  move: string;
  ponder?: string;
};

export type EngineError = {
  engineId?: string;
  searchId?: string;
  message: string;
};

export type AnalysisLine = {
  multipv: number;
  depth: number;
  seldepth?: number;
  nodes?: number;
  /** Side-to-move perspective of the searched position. */
  score: EngineScore;
  /** Same score from White's perspective. */
  scoreWhite: EngineScore;
  /** Side-to-move perspective of the searched position. */
  wdl?: Wdl;
  /** UCI moves, starting from the searched position. */
  pv: string[];
};

export type MoveClassification =
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "missed_tactic"
  | "human_error";

export type MaiaRating = 1100 | 1300 | 1500 | 1700 | 1900;

/** One move of a Maia policy distribution. `prob` in [0, 1] is the real lc0 policy (VerboseMoveStats `P`). */
export type MaiaMoveProb = { uci: string; prob: number };

/**
 * Per-rating Maia output for a single position (the position BEFORE the move).
 * Derived from `go nodes 1` with `VerboseMoveStats` and `PolicyTemperature 1`,
 * i.e. the raw policy head over every legal move.
 * `topMoves[0]` is the highest-policy move at this rating; sorted descending.
 */
export type RatingPrediction = {
  rating: MaiaRating;
  /** Top ~10 moves by policy, sorted descending. */
  topMoves: MaiaMoveProb[];
  /** Policy of the played move from the full distribution (0 if legal but negligible). */
  playedProb?: number;
  /** 1-based rank of the played move in the full policy. */
  playedRank?: number;
  /** Policy of the main engine's best move. */
  bestProb?: number;
  /** 1-based rank of the main engine's best move in the full policy. */
  bestRank?: number;
  /** Maia value head (V), side to move, in [-1, 1]. */
  value?: number;
  /** Maia WDL, side to move, permille. */
  wdl?: Wdl;
  engineId?: string;
};

/** Game-ending state of a position, as far as it can be read from the FEN. */
export type TerminalState = "checkmate" | "stalemate" | "draw";

export type MoveReview = {
  nodeId: string;
  ply: number;
  san: string;
  playedMove: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: EngineScore | null;
  evalAfter: EngineScore | null;
  /** Evaluation after the engine's recommended continuation, when available. */
  bestEvalAfter?: EngineScore | null;
  evalLoss: number | null;
  classification: MoveClassification;
  bestMove: string | null;
  bestLine: string[];
  /** MultiPV lines of `fenBefore` (side to move = mover). */
  topLines: AnalysisLine[];
  /** MultiPV lines of `fenAfter`: the opponent's best replies to the played move. Empty when terminal. */
  replyLines?: AnalysisLine[];
  /** 1-based rank of the played move among `topLines`; null when it is outside the MultiPV window. */
  playedRank?: number | null;
  /** Score of the played move from the same "before" search (mover perspective) when it is in `topLines`. */
  playedLineScore?: EngineScore | null;
  /** WDL of `fenBefore` from `topLines[0]`, mover perspective. */
  wdlBefore?: Wdl | null;
  /** WDL of `fenAfter` from `replyLines[0]`, perspective of the side to move after the move (the opponent). */
  wdlAfter?: Wdl | null;
  /**
   * Game-ending state of `fenAfter`. When set, `evalAfter` is synthesized:
   * `{ type: "mate", value: 0 }` (side to move is mated) or `{ type: "cp", value: 0 }` for draws.
   */
  terminal?: TerminalState | null;
  /**
   * Single-Maia compatibility field for older saved reviews. New Game Review
   * consumers should use `humanPredictions`.
   */
  humanPrediction?: string | null;
  /**
   * Multi-Maia rating distribution, one entry per Maia level that ran (real
   * policy). Only trustworthy when the review's `schemaVersion >= 2`.
   */
  humanPredictions?: RatingPrediction[];
  /** Real tactical motifs of the engine's best move only (fork/pin/skewer/hanging/mate...). */
  motifs: string[];
  clockRemainingMs?: number;
  /** Mover's own clock delta (previous own clock - current clock + increment). */
  timeSpentMs?: number;
};

export type GameReviewSummary = {
  totalMoves: number;
  best: number;
  excellent: number;
  good: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  missedTactics: number;
  humanErrors?: number;
  averageCentipawnLoss: number | null;
};

/** AI commentary for one reviewed move, written by the user's OpenRouter model. */
export type ReviewCommentary = {
  ply: number;
  /** The coach's explanation (the structured answer's body). */
  prose: string;
  /** Short title naming the idea (at most 8 words). Absent on older saved reviews. */
  headline?: string;
  generatedAt: number;
  providerModel: string;
  /**
   * Fingerprint of the commentary settings (model, detail, rating, side) this explanation was
   * generated with. A settings change makes it stale for future on-demand requests. Absent on
   * older saved reviews, which are treated as current.
   */
  settingsKey?: string;
};

/** The AI coach's explanation of a finished puzzle (kept for the session only, never saved). */
export type PuzzleExplanation = Pick<ReviewCommentary, "prose" | "headline" | "generatedAt" | "providerModel">;

/** One position for {@link AnalysePositionsInput}: searched with `multipv` lines (1–5). */
export type AnalysePositionInput = { fen: string; multipv: number };

/**
 * Engine lines for a few single positions (the puzzle explanation), searched with the Game review
 * engine settings: `moveTimeMs` per position, Threads / Hash from settings. `requestId` cancels it
 * through `engines.cancelReview`.
 */
export type AnalysePositionsInput = {
  requestId: string;
  engineId: string;
  moveTimeMs: number;
  positions: AnalysePositionInput[];
};

export type AnalysePositionsResult = {
  engineName: string;
  /** Per position, in order: its lines (empty for a finished position). */
  lines: AnalysisLine[][];
};

/**
 * Fields older builds wrote into saved reviews: a "Next time" `takeaway`, and `fallback` /
 * `source` marking explanations from the retired offline template ("local-fallback") or hosted
 * coach ("server"). Only read by {@link savedReviewCommentary}.
 */
type LegacyReviewCommentary = ReviewCommentary & {
  takeaway?: unknown;
  fallback?: unknown;
  source?: unknown;
};

/**
 * Commentary from a saved review, keeping only real AI explanations: entries from the retired
 * offline template are dropped (so the AI is asked when that move is viewed) and legacy-only
 * fields are stripped.
 */
export function savedReviewCommentary(
  items: readonly ReviewCommentary[] | undefined
): ReviewCommentary[] | undefined {
  if (!items) return items;
  return (items as readonly LegacyReviewCommentary[]).flatMap((item) => {
    if (item.fallback === true || item.source === "local-fallback") return [];
    const { takeaway, fallback, source, ...current } = item;
    void takeaway;
    void fallback;
    void source;
    return [current];
  });
}

/** Current `GameReview.schemaVersion`. Reviews below 2 carry fake (uniform) Maia probabilities. */
export const GAME_REVIEW_SCHEMA_VERSION = 2;

export type GameReview = {
  /**
   * The review operation that produced it (ReviewGameInput.reviewId). Correlates usage analytics
   * for a review opened later; missing on reviews saved before it was recorded.
   */
  reviewId?: string;
  /** 2 for reviews produced with real Maia policy; missing/<2 means Maia data is untrusted. */
  schemaVersion?: number;
  engineId: string;
  engineName?: string;
  engineSettings?: {
    multipv: number;
    moveTimeMs: number | null;
    depth: number | null;
    threads?: number;
    hashMb?: number;
  };
  maiaEngines?: { rating: number; engineId: string; name: string }[];
  predictionEngineIds?: string[];
  depth: number | null;
  moveTimeMs: number | null;
  multipv?: number;
  createdAt: number;
  summary: GameReviewSummary;
  moves: MoveReview[];
  /** AI commentary, keyed by ply; requested on demand as moves are viewed. */
  commentary?: ReviewCommentary[];
};

export type ReviewMoveInputItem = {
  nodeId: string;
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  /** PGN `%clk` of the mover after this move (e.g. "0:04:58"). */
  clockAfter?: string | null;
};

export type ReviewGameInput = {
  reviewId: string;
  /** The library game being reviewed, if it has an id (usage analytics count distinct games). */
  gameId?: string | null;
  engineId: string;
  /**
   * Maia engine IDs (EngineConfig.maiaRating set). Main filters them to
   * available engines, de-duplicates by rating and applies the
   * `reviewMaiaLevels` setting. An empty array disables Maia; omitting the
   * field lets main pick every installed Maia when `reviewUseMaia` is on.
   */
  predictionEngineIds?: string[];
  /** PGN TimeControl tag (e.g. "600+5"); used for the increment in `timeSpentMs`. */
  timeControl?: string | null;
  rootFen: string;
  moves: ReviewMoveInputItem[];
  /**
   * If set (>0), sends `go nodes N`. Highest precedence — disables tree search.
   * Required for Maia / Lc0 policy probabilities (use nodes=1).
   */
  nodes?: number | null;
  /** If `nodes` is unset and this is set (>0), sends `go movetime`. */
  moveTimeMs?: number | null;
  /** If `nodes` and `moveTimeMs` are unset and this is set (>0), sends `go depth`. */
  depth?: number | null;
  /** Overrides the `reviewMultiPv` setting (1-5) when set. */
  multipv?: number | null;
};

export type ReviewProgressPhase = "before" | "after";

export type ReviewProgress = {
  reviewId: string;
  moveIndex: number;
  totalMoves: number;
  nodeId: string;
  ply: number;
  san: string;
  playedUci: string;
  fenBefore: string;
  fenAfter: string;
  phase: ReviewProgressPhase;
  fen: string;
  mover: "white" | "black";
  depth: number;
  lines: AnalysisLine[];
};

export type ReviewMoveCompleted = {
  reviewId: string;
  moveIndex: number;
  totalMoves: number;
  move: MoveReview;
};

export type ReviewCompleted = {
  reviewId: string;
  review: GameReview;
};

export type ReviewFailed = {
  reviewId: string;
  message: string;
};
