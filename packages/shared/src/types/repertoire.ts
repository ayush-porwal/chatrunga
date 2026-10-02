/**
 * Repertoire contract shared by the main process (authority: SQLite, grading, scheduling) and the
 * renderer (study/practice UI). See docs/repertoire-design.md §7–§10.
 *
 * Times are epoch milliseconds (UTC). Every mutation of a repertoire bumps its `revision`; inputs
 * carrying `expectedRevision` are refused when the stored revision moved on (a stale draft).
 */
import type { MoveNode } from "./chess";

/** Version prefix of `positionKey` (chess/repertoire-position.ts); bump when the key changes. */
export const REPERTOIRE_POSITION_KEY_VERSION = 1;
/** Version of the deterministic scheduler (chess/repertoire-scheduler.ts). */
export const REPERTOIRE_SCHEDULER_VERSION = 1;

/** The side the player trains. Board orientation is presentation only. */
export type RepertoireColor = "white" | "black";
/** Reference chapters are study material only: they never create training cards. */
export type ChapterKind = "opening" | "reference";

/* ------------------------------------------------------------------ repertoires and chapters */

export type RepertoireSummary = {
  id: string;
  name: string;
  color: RepertoireColor;
  description: string;
  tags: string[];
  revision: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  chapterCount: number;
  /** Unique trainable decisions (one per position key, however many chapters reach it). */
  decisionCount: number;
  dueCount: number;
  lastStudiedAt: number | null;
};

export type RepertoireChapterSummary = {
  id: string;
  title: string;
  sortOrder: number;
  kind: ChapterKind;
  enabled: boolean;
  rootFen: string;
  revision: number;
  nodeCount: number;
  /** Due decisions supported by this chapter; chapter totals can overlap (transpositions). */
  dueCount: number;
};

export type RepertoireDetail = RepertoireSummary & {
  chapters: RepertoireChapterSummary[];
  workspace: RepertoireWorkspaceState | null;
};

/**
 * How a node's incoming edge counts:
 * - `reference`: study-only; its whole subtree never trains.
 * - `included`: an intended move of the player (an accepted choice).
 * - `covered`: an opponent reply the repertoire prepares for.
 */
export type RepertoireEdgeKind = "reference" | "included" | "covered";

export type RepertoireNodeMeta = {
  edge: RepertoireEdgeKind;
  /** "Start training here": positions before this node (on its route) don't train. */
  trainingStart?: boolean;
  /** "Stop branch here": this node's position is the route's end; nothing after it trains. */
  trainingStop?: boolean;
  /** Disables this node and every descendant. */
  disabled?: boolean;
};

/**
 * A chapter: one authored occurrence tree. `tree` always contains the root node, id `"root"`,
 * whose `fenBefore`/`fenAfter` are `rootFen`. Node ids are chapter-local.
 */
export type RepertoireChapter = RepertoireChapterSummary & {
  /** Every PGN tag as imported/edited (unknown tags too), e.g. `{ Event: "…", ECO: "B90" }`. */
  headers: Record<string, string>;
  tree: MoveNode[];
  /** Keyed by node id; a node without an entry uses the defaults (see repertoire-index.ts). */
  nodeMeta: Record<string, RepertoireNodeMeta>;
};

/** Root node id of every chapter tree. */
export const REPERTOIRE_ROOT_NODE_ID = "root";

/* ------------------------------------------------------------------ decisions and progress */

/** The player's intended choices at one position, repertoire-wide. */
export type RepertoireDecision = {
  repertoireId: string;
  positionKey: string;
  /** Stored choices (UCI). The effective set is this ∩ currently supported occurrences. */
  acceptedUcis: string[];
  preferredUci: string | null;
  prompt: string | null;
  hint: string | null;
  /** Feedback shown when a specific legal move outside the repertoire is played. */
  wrongMoveFeedback: Record<string, string>;
  paused: boolean;
};

export type RepertoireProgress = {
  repertoireId: string;
  positionKey: string;
  /** 0 = new or lapsed; 1–6 index STAGE_INTERVALS_DAYS. */
  stage: number;
  dueAt: number | null;
  lastAttemptAt: number | null;
  lapses: number;
  unaidedSuccesses: number;
  /** Fingerprint of the effective accepted set the progress was earned against. */
  acceptanceFingerprint: string;
  schedulerVersion: number;
  /** No supporting occurrence any more; history kept so restoring the choices recovers it. */
  suspended: boolean;
};

/* ------------------------------------------------------------------ practice */

export type PracticeMode = "review-due" | "learn-new";

export type PracticeScope = {
  repertoireId: string;
  /** Which decisions are queued; omitted = every enabled opening chapter. */
  chapterIds?: string[];
  maxDepthPlies?: number;
  cardLimit?: number;
  newCardLimit?: number;
};

export type StartPracticeInput = PracticeScope & { mode: PracticeMode };

export type PracticeCardState =
  | "unanswered"
  | "answered-correct"
  | "answered-wrong"
  | "revealed"
  | "skipped";

export type PracticeLeadUpMove = { san: string; uci: string; fen: string };

export type PracticeCard = {
  queueItemId: string;
  positionKey: string;
  fen: string;
  orientation: RepertoireColor;
  /** The authored path from the chapter root to this position (each move with its fen after). */
  leadUp: PracticeLeadUpMove[];
  chapterId: string;
  nodeId: string;
  prompt: string | null;
  stage: "new" | "review";
  state: PracticeCardState;
  /** 0 none; 1 prompt/hint text; 2 piece to move; 3 from/to squares. */
  hintStage: 0 | 1 | 2 | 3;
  attemptsSoFar: number;
};

export type PracticeTotals = {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  revealed: number;
  skipped: number;
  remaining: number;
};

export type PracticeSessionSnapshot = {
  sessionId: string;
  repertoireId: string;
  mode: PracticeMode;
  scope: PracticeScope;
  status: "active" | "finished";
  /** Index into `cards` of the current card. */
  cursor: number;
  cards: PracticeCard[];
  totals: PracticeTotals;
};

export type PracticeAction = { kind: "hint" } | { kind: "reveal" } | { kind: "skip" };

export type PracticeActionInput = {
  sessionId: string;
  queueItemId: string;
  action: PracticeAction;
};

export type RecordAttemptInput = {
  sessionId: string;
  queueItemId: string;
  /** Client idempotency token: a replayed request returns the first committed result. */
  attemptId: string;
  /** Full UCI including promotion (`e7e8q`). The main process decides legality and success. */
  uci: string;
};

export type AttemptResult = {
  outcome: "correct" | "outside-repertoire" | "illegal" | "already-final";
  /** Revealed only once the card's grade is final; empty before. */
  acceptedUcis: string[];
  preferredUci: string | null;
  feedback: string | null;
  card: PracticeCard;
  /** This attempt fixed the card's scheduled grade. */
  finalGrade: boolean;
};

export type PracticeActionResult = {
  card: PracticeCard;
  revealed?: { ucis: string[]; preferredUci: string | null; explanation: string | null };
};

export type PracticeSummary = {
  sessionId: string;
  repertoireId: string;
  unaided: number;
  assisted: number;
  missed: number;
  skipped: number;
  /** Ids of the chapters the session's cards came from. */
  chapters: string[];
  missedPositionKeys: string[];
};

/* ------------------------------------------------------------------ import / export */

export type PreviewImportInput = { pgn: string };

export type ImportInvalidBranch = {
  /** SAN sequence from the game's root to the illegal move's parent, e.g. `"1. e4 e5 2. Nf3"`. */
  path: string;
  san: string;
  reason: string;
};

export type ImportPreviewGame = {
  index: number;
  proposedTitle: string;
  rootFen: string;
  headers: Record<string, string>;
  nodeCount: number;
  /** The parsed tree (deterministic ids) so `excludeNodeIds` can name branches to drop. */
  tree: MoveNode[];
  warnings: string[];
  invalidBranches: ImportInvalidBranch[];
};

export type ImportPreview = {
  jobId: string;
  games: ImportPreviewGame[];
};

export type ImportSelection = {
  gameIndex: number;
  title: string;
  kind: ChapterKind;
  include: boolean;
  /** Preview node ids to drop, each with its subtree. */
  excludeNodeIds?: string[];
};

export type ImportCommitInput = {
  jobId: string;
  repertoireId: string;
  selections: ImportSelection[];
  expectedRevision: number;
};

export type ImportResult = {
  repertoire: RepertoireDetail;
  chaptersAdded: number;
};

export type ExportInput = {
  repertoireId: string;
  /** Omitted = every chapter, in order. */
  chapterIds?: string[];
};

export type ExportResult = {
  pgn: string;
  chapterCount: number;
  /** Where the save dialog wrote it; null when cancelled or without a dialog (web preview). */
  savedPath: string | null;
};

/* ------------------------------------------------------------------ mutations */

export type CreateRepertoireInput = {
  name: string;
  color: RepertoireColor;
  description?: string;
  tags?: string[];
  /** Root of the first chapter; omitted = the standard starting position. */
  rootFen?: string;
  /** Title of the first chapter; defaults to the repertoire name. */
  firstChapterTitle?: string;
};

export type UpdateRepertoireMetadataInput = {
  id: string;
  expectedRevision: number;
  patch: { name?: string; description?: string; tags?: string[] };
};

export type SaveChapterInput = {
  repertoireId: string;
  /** A new chapter when its id isn't stored yet. */
  chapter: RepertoireChapter;
  /** The repertoire's revision the draft was based on. */
  expectedRevision: number;
};

export type ChapterSaveResult = {
  repertoire: RepertoireDetail;
  chapter: RepertoireChapter;
  decisionsChanged: number;
};

export type UpdateDecisionInput = {
  repertoireId: string;
  positionKey: string;
  expectedRevision: number;
  patch: {
    acceptedUcis?: string[];
    preferredUci?: string | null;
    prompt?: string | null;
    hint?: string | null;
    wrongMoveFeedback?: Record<string, string>;
    paused?: boolean;
  };
};

export type DecisionSaveResult = {
  repertoire: RepertoireDetail;
  decision: RepertoireDecision;
};

export type RepertoireChangeResult = {
  repertoire: RepertoireDetail;
};

export type RemoveChapterInput = {
  repertoireId: string;
  chapterId: string;
  expectedRevision: number;
};

export type DuplicateRepertoireInput = {
  id: string;
  name?: string;
};

export type ArchiveRepertoireInput = {
  id: string;
  archived: boolean;
  expectedRevision: number;
};

export type RemoveRepertoireInput = {
  id: string;
  expectedRevision: number;
};

export type RepertoireWorkspaceState = {
  lastChapterId: string | null;
  lastNodeId: string | null;
  orientation: RepertoireColor;
  practiceDraft: StartPracticeInput | null;
};

export type SaveWorkspaceInput = {
  repertoireId: string;
  workspace: RepertoireWorkspaceState;
};

export type RepertoireListFilters = {
  color?: RepertoireColor | "all";
  query?: string;
  /** true: only archived; false/omitted: only active. */
  archived?: boolean;
};

export type RepertoireDueSummary = {
  dueCount: number;
  repertoireCount: number;
  continue: { repertoireId: string; chapterId: string; nodeId: string } | null;
};

/** One place a position is reached in the repertoire (from the derived index). */
export type RepertoireOccurrence = {
  chapterId: string;
  chapterTitle: string;
  nodeId: string;
  /** SAN path from the chapter root, e.g. `"1. e4 e5 2. Bc4 Nc6 3. Nf3"`. */
  path: string;
  ply: number;
};

export type RepertoireChangedEvent = {
  /** null: several repertoires may have changed (e.g. after an import of many). */
  repertoireId: string | null;
  revision: number;
  kind: "created" | "updated" | "removed" | "progress";
};
