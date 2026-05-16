import type { Color } from "./chess";

export type EngineProtocol = "uci";
export type EngineStatus = "idle" | "starting" | "ready" | "thinking" | "error";
export type EngineRuntime = "wasm" | "native-bundled" | "custom-uci";

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
  isBundled: boolean;
  isAvailable: boolean;
  isDefault: boolean;
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
};

export type UpdateEngineInput = Partial<CreateEngineInput>;

export type EngineTestResult = {
  ok: boolean;
  name?: string;
  author?: string;
  error?: string;
};

export type StartEngineGameInput = {
  engineId: string;
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
  fen: string;
  moves: string[];
  multipv?: number | null;
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

export type EngineInfo = {
  engineId: string;
  depth?: number;
  seldepth?: number;
  multipv?: number;
  nodes?: number;
  nps?: number;
  score?: EngineScore;
  pv?: string[];
  raw: string;
  receivedAt: number;
};

export type EngineBestMove = {
  engineId: string;
  move: string;
  ponder?: string;
};

export type EngineError = {
  engineId?: string;
  message: string;
};

export type AnalysisLine = {
  multipv: number;
  depth: number;
  score: EngineScore;
  scoreWhite: EngineScore;
  pv: string[];
};

export type MoveClassification =
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "missed_tactic";

export type MoveReview = {
  nodeId: string;
  ply: number;
  san: string;
  playedMove: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: EngineScore | null;
  evalAfter: EngineScore | null;
  evalLoss: number | null;
  classification: MoveClassification;
  bestMove: string | null;
  bestLine: string[];
  topLines: AnalysisLine[];
  motifs: string[];
  clockRemainingMs?: number;
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
  averageCentipawnLoss: number | null;
};

export type GameReview = {
  engineId: string;
  depth: number | null;
  moveTimeMs: number | null;
  createdAt: number;
  summary: GameReviewSummary;
  moves: MoveReview[];
};

export type ReviewMoveInputItem = {
  nodeId: string;
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
};

export type ReviewGameInput = {
  reviewId: string;
  engineId: string;
  rootFen: string;
  moves: ReviewMoveInputItem[];
  /** If set (>0), sends `go movetime` — best default for NN engines (lc0, Maia). */
  moveTimeMs?: number | null;
  /** If set (>0) and `moveTimeMs` is omitted, sends `go depth`. */
  depth?: number | null;
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
