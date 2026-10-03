/**
 * Repertoire data access (design §8.1): rows of the repertoire tables and their mapping to the
 * shared domain types. No policy lives here — service.ts owns revisions, reconciliation and
 * grading, and wraps every mutation in one `transaction`.
 */
import type { SQLInputValue } from "node:sqlite";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_POSITION_KEY_VERSION,
  REPERTOIRE_ROOT_NODE_ID,
  type ChapterKind,
  type PracticeCard,
  type PracticeMode,
  type PracticeScope,
  type RepertoireBackupChapter,
  type RepertoireChapter,
  type RepertoireChapterSummary,
  type RepertoireColor,
  type RepertoireDecision,
  type RepertoireGameLink,
  type RepertoireListFilters,
  type RepertoireNodeMeta,
  type RepertoireProgress,
  type RepertoireSummary,
  type RepertoireWorkspaceState,
  type StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { repertoireDb } from "./connection";

/** A stored chapter whose JSON can't be read. Recoverable: the row is left untouched. */
export class RepertoireCorruptChapterError extends Error {
  readonly chapterId: string;
  readonly reason: string;

  constructor(chapterId: string, reason: string) {
    super(`Repertoire chapter ${chapterId} is damaged and can't be opened: ${reason}`);
    this.name = "RepertoireCorruptChapterError";
    this.chapterId = chapterId;
    this.reason = reason;
  }
}

type RepertoireRow = {
  id: string;
  name: string;
  color: string;
  description: string;
  tags_json: string;
  revision: number;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

type RepertoireSummaryRow = RepertoireRow & {
  chapter_count: number;
  decision_count: number;
  due_count: number;
  last_studied_at: number | null;
};

type ChapterSummaryRow = {
  id: string;
  repertoire_id: string;
  title: string;
  sort_order: number;
  kind: string;
  enabled: number;
  root_fen: string;
  node_count: number;
  revision: number;
  created_at: number;
  updated_at: number;
  due_count?: number;
};

type ChapterRow = ChapterSummaryRow & {
  headers_json: string;
  tree_json: string;
  node_metadata_json: string;
};

type DecisionRow = {
  repertoire_id: string;
  position_key: string;
  accepted_ucis_json: string;
  preferred_uci: string | null;
  prompt: string | null;
  hint: string | null;
  wrong_move_feedback_json: string;
  paused: number;
  acceptance_fingerprint: string;
  updated_at: number;
};

type ProgressRow = {
  repertoire_id: string;
  position_key: string;
  stage: number;
  due_at: number | null;
  last_attempt_at: number | null;
  lapses: number;
  unaided_successes: number;
  acceptance_fingerprint: string;
  scheduler_version: number;
  suspended: number;
};

type SessionRow = {
  id: string;
  repertoire_id: string;
  mode: string;
  scope_json: string;
  snapshot_revision: number;
  queue_json: string;
  card_state_json: string;
  cursor: number;
  status: string;
  created_at: number;
  updated_at: number;
};

type AttemptRow = {
  attempt_id: string;
  session_id: string;
  queue_item_id: string;
  sequence: number;
  kind: string;
  uci: string | null;
  legal: number;
  correct: number;
  is_final_grade: number;
  outcome: string | null;
  position_key: string;
  fingerprint: string;
  result_json: string | null;
  at: number;
};

type WorkspaceRow = {
  repertoire_id: string;
  last_chapter_id: string | null;
  last_node_id: string | null;
  orientation: string;
  practice_draft_json: string | null;
  updated_at: number;
};

/** A repertoire's own columns (no aggregates). */
export type RepertoireRecord = Omit<
  RepertoireSummary,
  "chapterCount" | "decisionCount" | "dueCount" | "lastStudiedAt"
>;

/** A decision as stored, with the fingerprint of its effective set at the last reindex. */
export type StoredDecision = RepertoireDecision & { acceptanceFingerprint: string };

/** The frozen policy a practice card is graded against (design §8.3). */
export type FrozenPolicy = {
  acceptedUcis: string[];
  preferredUci: string | null;
  fingerprint: string;
  hint: string | null;
  wrongMoveFeedback: Record<string, string>;
  /** The occurrence's comment, shown once the answer is revealed. */
  explanation: string | null;
  /**
   * The authored comments of the accepted moves played from the occurrence, by UCI, shown with
   * the answer once the grade is final. Absent from sessions frozen before they were kept.
   */
  moveComments?: Record<string, string>;
  /** The decision's last graded attempt when the session froze it (null: never practised). */
  progressAt?: number | null;
};

/**
 * Rehearse-lines session state (kept in `card_state_json` beside the frozen policies). A line is
 * identified by its end node (see chess/repertoire-rehearsal.ts).
 */
export type RehearsalState = {
  chapterId: string;
  fromNodeId: string;
  /** The chapter revision the session was planned against; a change ends the session. */
  chapterRevision: number;
  maxDepthPlies: number;
  /** End node of the line being played. */
  lineEnd: string;
  /** How many times each opponent reply (node id) was supplied in this session. */
  seen: Record<string, number>;
  /** End nodes of the lines completed or skipped; they are not planned again. */
  finished: string[];
  linesStarted: number;
  linesCompleted: number;
  /** End nodes of the lines in the order they first appeared (a line's number is its index + 1). */
  lineOrder?: string[];
};

/** Key of the rehearsal state inside `card_state_json` (queue item ids never start with `$`). */
const REHEARSAL_KEY = "$rehearsal";

export type PracticeSessionRecord = {
  id: string;
  repertoireId: string;
  mode: PracticeMode;
  scope: PracticeScope;
  snapshotRevision: number;
  cards: PracticeCard[];
  policies: Record<string, FrozenPolicy>;
  /** Rehearse-lines only. */
  rehearsal?: RehearsalState;
  cursor: number;
  status: "active" | "finished";
  createdAt: number;
  updatedAt: number;
};

export type AttemptKind = "attempt" | "hint" | "reveal" | "skip";

export type AttemptRecord = {
  attemptId: string;
  sessionId: string;
  queueItemId: string;
  sequence: number;
  kind: AttemptKind;
  uci: string | null;
  legal: boolean;
  correct: boolean;
  isFinalGrade: boolean;
  outcome: string | null;
  positionKey: string;
  fingerprint: string;
  resultJson: string | null;
  at: number;
};

export type PositionIndexRow = {
  chapterId: string;
  nodeId: string;
  positionKey: string;
  scopeState: string;
  isDecision: boolean;
  ply: number;
};

function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return repertoireDb()
    .prepare(sql)
    .all(...params) as T[];
}

function get<T>(sql: string, ...params: SQLInputValue[]): T | null {
  return (
    (repertoireDb()
      .prepare(sql)
      .get(...params) as T | undefined) ?? null
  );
}

function run(sql: string, ...params: SQLInputValue[]): void {
  repertoireDb()
    .prepare(sql)
    .run(...params);
}

/** How a transaction locks: reads never take the write lock; writes take it up front. */
export type TransactionMode = "read" | "write";

/** The message a busy database gives the user (the write lock stayed held past the timeout). */
export const REPERTOIRE_BUSY_MESSAGE = "The repertoire database is busy; try again.";

/** True for SQLite's BUSY error (any extended code), as node:sqlite reports it. */
export function isBusyError(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && (code & 0xff) === 5;
}

/** The actionable busy error for a BUSY failure; any other error unchanged. */
export function actionableBusyError(error: unknown): unknown {
  return isBusyError(error) ? new Error(REPERTOIRE_BUSY_MESSAGE, { cause: error }) : error;
}

/**
 * Runs `work` in one transaction (joins an open one), rolling back on any error. A write takes the
 * write lock up front (IMMEDIATE), so it never fails mid-way on a lock held by the import writer;
 * on the main thread every write already waits its turn at the service's write gate, so the short
 * busy timeout is only a safety net. A read uses a plain deferred BEGIN: in WAL mode it sees one
 * consistent snapshot without ever taking the write lock, so it never waits for a writer. A BUSY
 * failure becomes the actionable busy error.
 */
export function transaction<T>(work: () => T, mode: TransactionMode = "write"): T {
  const db = repertoireDb();
  if (db.isTransaction) return work();
  try {
    db.exec(mode === "write" ? "BEGIN IMMEDIATE" : "BEGIN");
  } catch (error) {
    throw actionableBusyError(error);
  }
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw actionableBusyError(error);
  }
}

/** Parses a JSON column, returning `fallback` when it is unreadable (non-critical columns). */
function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function stringArray(text: string): string[] {
  const parsed = parseJson<unknown>(text, []);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function stringRecord(text: string | null): Record<string, string> {
  const parsed = parseJson<unknown>(text, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

const asColor = (value: string): RepertoireColor => (value === "black" ? "black" : "white");
const asKind = (value: string): ChapterKind => (value === "reference" ? "reference" : "opening");

function toRecord(row: RepertoireRow): RepertoireRecord {
  return {
    id: row.id,
    name: row.name,
    color: asColor(row.color),
    description: row.description,
    tags: stringArray(row.tags_json),
    revision: row.revision,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSummary(row: RepertoireSummaryRow): RepertoireSummary {
  return {
    ...toRecord(row),
    chapterCount: row.chapter_count,
    decisionCount: row.decision_count,
    // Archived repertoires contribute no due cards (design §8.3).
    dueCount: row.archived_at === null ? row.due_count : 0,
    lastStudiedAt: row.last_studied_at || null
  };
}

function toChapterSummary(row: ChapterSummaryRow): RepertoireChapterSummary {
  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order,
    kind: asKind(row.kind),
    enabled: row.enabled === 1,
    rootFen: row.root_fen,
    revision: row.revision,
    nodeCount: row.node_count,
    dueCount: row.due_count ?? 0
  };
}

/**
 * The chapter's tree, metadata and headers, checked structurally on load. Anything unreadable
 * throws RepertoireCorruptChapterError — never an empty tree in its place.
 */
function toChapter(row: ChapterRow): RepertoireChapter {
  const corrupt = (reason: string) => new RepertoireCorruptChapterError(row.id, reason);
  let tree: unknown;
  let nodeMeta: unknown;
  let headers: unknown;
  try {
    tree = JSON.parse(row.tree_json);
    nodeMeta = JSON.parse(row.node_metadata_json);
    headers = JSON.parse(row.headers_json);
  } catch {
    throw corrupt("its stored JSON is unreadable");
  }
  if (!Array.isArray(tree) || !tree.length) throw corrupt("the move tree is missing");
  for (const node of tree) {
    if (
      !node ||
      typeof node !== "object" ||
      typeof node.id !== "string" ||
      typeof node.fenAfter !== "string" ||
      !Array.isArray(node.children)
    ) {
      throw corrupt("a move-tree node is malformed");
    }
  }
  if (
    !tree.some((node: MoveNode) => node.id === REPERTOIRE_ROOT_NODE_ID && node.parentId === null)
  ) {
    throw corrupt("the move tree has no root");
  }
  if (!nodeMeta || typeof nodeMeta !== "object" || Array.isArray(nodeMeta)) {
    throw corrupt("the node metadata is malformed");
  }
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw corrupt("the headers are malformed");
  }
  return {
    ...toChapterSummary(row),
    headers: stringRecord(row.headers_json),
    tree: tree as MoveNode[],
    nodeMeta: nodeMeta as Record<string, RepertoireNodeMeta>
  };
}

function toDecision(row: DecisionRow): StoredDecision {
  return {
    repertoireId: row.repertoire_id,
    positionKey: row.position_key,
    acceptedUcis: stringArray(row.accepted_ucis_json),
    preferredUci: row.preferred_uci,
    prompt: row.prompt,
    hint: row.hint,
    wrongMoveFeedback: stringRecord(row.wrong_move_feedback_json),
    paused: row.paused === 1,
    acceptanceFingerprint: row.acceptance_fingerprint
  };
}

function toProgress(row: ProgressRow): RepertoireProgress {
  return {
    repertoireId: row.repertoire_id,
    positionKey: row.position_key,
    stage: row.stage,
    dueAt: row.due_at,
    lastAttemptAt: row.last_attempt_at,
    lapses: row.lapses,
    unaidedSuccesses: row.unaided_successes,
    acceptanceFingerprint: row.acceptance_fingerprint,
    schedulerVersion: row.scheduler_version,
    suspended: row.suspended === 1
  };
}

function sessionMode(mode: string): PracticeMode {
  return mode === "learn-new" || mode === "rehearse-lines" ? mode : "review-due";
}

function toSession(row: SessionRow): PracticeSessionRecord {
  const { [REHEARSAL_KEY]: rehearsal, ...policies } = parseJson<
    Record<string, FrozenPolicy> & { [REHEARSAL_KEY]?: RehearsalState }
  >(row.card_state_json, {});
  return {
    id: row.id,
    repertoireId: row.repertoire_id,
    mode: sessionMode(row.mode),
    scope: parseJson<PracticeScope>(row.scope_json, { repertoireId: row.repertoire_id }),
    snapshotRevision: row.snapshot_revision,
    cards: parseJson<PracticeCard[]>(row.queue_json, []),
    policies: policies as Record<string, FrozenPolicy>,
    ...(rehearsal ? { rehearsal: rehearsal as RehearsalState } : {}),
    cursor: row.cursor,
    status: row.status === "finished" ? "finished" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAttempt(row: AttemptRow): AttemptRecord {
  return {
    attemptId: row.attempt_id,
    sessionId: row.session_id,
    queueItemId: row.queue_item_id,
    sequence: row.sequence,
    kind: row.kind as AttemptKind,
    uci: row.uci,
    legal: row.legal === 1,
    correct: row.correct === 1,
    isFinalGrade: row.is_final_grade === 1,
    outcome: row.outcome,
    positionKey: row.position_key,
    fingerprint: row.fingerprint,
    resultJson: row.result_json,
    at: row.at
  };
}

function toWorkspace(row: WorkspaceRow): RepertoireWorkspaceState {
  return {
    lastChapterId: row.last_chapter_id,
    lastNodeId: row.last_node_id,
    orientation: asColor(row.orientation),
    practiceDraft: parseJson<StartPracticeInput | null>(row.practice_draft_json, null)
  };
}

/** Decisions that count: not paused, with at least one active supported occurrence. */
const COUNTED_DECISION = `d.paused = 0 AND EXISTS (SELECT 1 FROM repertoire_position_index i
  WHERE i.repertoire_id = d.repertoire_id AND i.position_key = d.position_key AND i.is_decision = 1)`;

/** Due progress rows (bound parameter: now) of counted decisions. */
const DUE_PROGRESS = `p.suspended = 0 AND p.due_at IS NOT NULL AND p.due_at <= ? AND EXISTS (
  SELECT 1 FROM repertoire_decisions d WHERE d.repertoire_id = p.repertoire_id
  AND d.position_key = p.position_key AND ${COUNTED_DECISION})`;

const SUMMARY_SELECT = `SELECT r.*,
  (SELECT COUNT(*) FROM repertoire_chapters c WHERE c.repertoire_id = r.id) AS chapter_count,
  (SELECT COUNT(*) FROM repertoire_decisions d WHERE d.repertoire_id = r.id AND ${COUNTED_DECISION})
    AS decision_count,
  (SELECT COUNT(*) FROM repertoire_progress p WHERE p.repertoire_id = r.id AND ${DUE_PROGRESS})
    AS due_count,
  MAX(
    COALESCE((SELECT w.updated_at FROM repertoire_workspace_state w WHERE w.repertoire_id = r.id), 0),
    COALESCE((SELECT MAX(c.updated_at) FROM repertoire_chapters c WHERE c.repertoire_id = r.id), 0)
  ) AS last_studied_at
  FROM repertoires r`;

const CHAPTER_SUMMARY_COLUMNS = `c.id, c.repertoire_id, c.title, c.sort_order, c.kind, c.enabled,
  c.root_fen, c.node_count, c.revision, c.created_at, c.updated_at`;

/** Escapes LIKE wildcards so a search for `50%` matches the text literally. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const repertoireRepository = {
  /** Summaries matching `filters`, most recently updated first. */
  list(filters: RepertoireListFilters, now: number): RepertoireSummary[] {
    const where: string[] = [
      filters.archived ? "r.archived_at IS NOT NULL" : "r.archived_at IS NULL"
    ];
    const params: SQLInputValue[] = [now];
    if (filters.color && filters.color !== "all") {
      where.push("r.color = ?");
      params.push(filters.color);
    }
    const query = filters.query?.trim();
    if (query) {
      where.push("(r.name LIKE ? ESCAPE '\\' OR r.tags_json LIKE ? ESCAPE '\\')");
      params.push(likePattern(query), likePattern(query));
    }
    return all<RepertoireSummaryRow>(
      `${SUMMARY_SELECT} WHERE ${where.join(" AND ")} ORDER BY r.updated_at DESC, r.id`,
      ...params
    ).map(toSummary);
  },

  summary(id: string, now: number): RepertoireSummary | null {
    const row = get<RepertoireSummaryRow>(`${SUMMARY_SELECT} WHERE r.id = ?`, now, id);
    return row ? toSummary(row) : null;
  },

  /** Every repertoire id, archived ones included, oldest first (backups). */
  ids(): string[] {
    return all<{ id: string }>("SELECT id FROM repertoires ORDER BY created_at, id").map(
      (row) => row.id
    );
  },

  get(id: string): RepertoireRecord | null {
    const row = get<RepertoireRow>("SELECT * FROM repertoires WHERE id = ?", id);
    return row ? toRecord(row) : null;
  },

  insert(record: RepertoireRecord): void {
    run(
      `INSERT INTO repertoires (id, name, color, description, tags_json, revision, archived_at,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.name,
      record.color,
      record.description,
      JSON.stringify(record.tags),
      record.revision,
      record.archivedAt,
      record.createdAt,
      record.updatedAt
    );
  },

  update(record: RepertoireRecord): void {
    run(
      `UPDATE repertoires SET name = ?, description = ?, tags_json = ?, revision = ?, archived_at = ?,
        updated_at = ? WHERE id = ?`,
      record.name,
      record.description,
      JSON.stringify(record.tags),
      record.revision,
      record.archivedAt,
      record.updatedAt,
      record.id
    );
  },

  remove(id: string): void {
    run("DELETE FROM repertoires WHERE id = ?", id);
  },

  /** Due decisions across active (non-archived) repertoires, and how many repertoires have any. */
  dueTotals(now: number): { dueCount: number; repertoireCount: number } {
    const row = get<{ due: number | null; repertoires: number }>(
      `SELECT SUM(n) AS due, COUNT(*) AS repertoires FROM (
        SELECT COUNT(*) AS n FROM repertoire_progress p JOIN repertoires r ON r.id = p.repertoire_id
        WHERE r.archived_at IS NULL AND ${DUE_PROGRESS} GROUP BY p.repertoire_id)`,
      now
    );
    return { dueCount: row?.due ?? 0, repertoireCount: row?.repertoires ?? 0 };
  },

  /** The most recently saved study place of an active repertoire whose chapter still exists. */
  lastStudyPlace(): { repertoireId: string; chapterId: string; nodeId: string | null } | null {
    const row = get<{
      repertoire_id: string;
      last_chapter_id: string;
      last_node_id: string | null;
    }>(
      `SELECT w.repertoire_id, w.last_chapter_id, w.last_node_id FROM repertoire_workspace_state w
        JOIN repertoires r ON r.id = w.repertoire_id
        JOIN repertoire_chapters c ON c.id = w.last_chapter_id AND c.repertoire_id = w.repertoire_id
        WHERE r.archived_at IS NULL ORDER BY w.updated_at DESC LIMIT 1`
    );
    return row
      ? {
          repertoireId: row.repertoire_id,
          chapterId: row.last_chapter_id,
          nodeId: row.last_node_id
        }
      : null;
  }
};

export const chapterRepository = {
  /** Chapter summaries in order, each with its due count (bound: now). No trees are loaded. */
  summaries(repertoireId: string, now: number): RepertoireChapterSummary[] {
    return all<ChapterSummaryRow>(
      `SELECT ${CHAPTER_SUMMARY_COLUMNS}, (
        SELECT COUNT(DISTINCT i.position_key) FROM repertoire_position_index i
        JOIN repertoire_progress p ON p.repertoire_id = i.repertoire_id AND p.position_key = i.position_key
        WHERE i.chapter_id = c.id AND i.is_decision = 1 AND ${DUE_PROGRESS}
        AND NOT EXISTS (SELECT 1 FROM repertoires r WHERE r.id = c.repertoire_id
          AND r.archived_at IS NOT NULL)) AS due_count
        FROM repertoire_chapters c WHERE c.repertoire_id = ? ORDER BY c.sort_order, c.created_at, c.id`,
      now,
      repertoireId
    ).map(toChapterSummary);
  },

  /** Every chapter of a repertoire, in order (throws if one is damaged). */
  list(repertoireId: string): RepertoireChapter[] {
    return all<ChapterRow>(
      "SELECT * FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, created_at, id",
      repertoireId
    ).map(toChapter);
  },

  /**
   * Every chapter of a repertoire, in order, for a backup: a damaged chapter comes back with an
   * empty tree and its raw stored JSON under `damaged` instead of throwing.
   */
  listForBackup(repertoireId: string): RepertoireBackupChapter[] {
    return all<ChapterRow>(
      "SELECT * FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, created_at, id",
      repertoireId
    ).map((row): RepertoireBackupChapter => {
      try {
        return toChapter(row);
      } catch (error) {
        if (!(error instanceof RepertoireCorruptChapterError)) throw error;
        return {
          ...toChapterSummary(row),
          dueCount: 0,
          headers: {},
          tree: [],
          nodeMeta: {},
          damaged: {
            treeJson: row.tree_json,
            nodeMetaJson: row.node_metadata_json,
            headersJson: row.headers_json,
            reason: error.reason
          }
        };
      }
    });
  },

  get(id: string): RepertoireChapter | null {
    const row = get<ChapterRow>("SELECT * FROM repertoire_chapters WHERE id = ?", id);
    return row ? toChapter(row) : null;
  },

  /** The repertoire a chapter id belongs to and its revision (without reading its tree). */
  ownerOf(id: string): { repertoireId: string; revision: number } | null {
    const row = get<{ repertoire_id: string; revision: number }>(
      "SELECT repertoire_id, revision FROM repertoire_chapters WHERE id = ?",
      id
    );
    return row ? { repertoireId: row.repertoire_id, revision: row.revision } : null;
  },

  maxSortOrder(repertoireId: string): number {
    const row = get<{ value: number | null }>(
      "SELECT MAX(sort_order) AS value FROM repertoire_chapters WHERE repertoire_id = ?",
      repertoireId
    );
    return row?.value ?? -1;
  },

  upsert(repertoireId: string, chapter: RepertoireChapter, now: number): void {
    run(
      `INSERT INTO repertoire_chapters (id, repertoire_id, title, sort_order, kind, enabled, root_fen,
        headers_json, tree_json, node_metadata_json, node_count, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, sort_order = excluded.sort_order,
        kind = excluded.kind, enabled = excluded.enabled, root_fen = excluded.root_fen,
        headers_json = excluded.headers_json, tree_json = excluded.tree_json,
        node_metadata_json = excluded.node_metadata_json, node_count = excluded.node_count,
        revision = excluded.revision, updated_at = excluded.updated_at`,
      chapter.id,
      repertoireId,
      chapter.title,
      chapter.sortOrder,
      chapter.kind,
      chapter.enabled ? 1 : 0,
      chapter.rootFen,
      JSON.stringify(chapter.headers),
      JSON.stringify(chapter.tree),
      JSON.stringify(chapter.nodeMeta),
      Math.max(chapter.tree.length - 1, 0),
      chapter.revision,
      now,
      now
    );
  },

  remove(id: string): void {
    run("DELETE FROM repertoire_chapters WHERE id = ?", id);
  }
};

export const decisionRepository = {
  list(repertoireId: string): StoredDecision[] {
    return all<DecisionRow>(
      "SELECT * FROM repertoire_decisions WHERE repertoire_id = ? ORDER BY position_key",
      repertoireId
    ).map(toDecision);
  },

  get(repertoireId: string, positionKey: string): StoredDecision | null {
    const row = get<DecisionRow>(
      "SELECT * FROM repertoire_decisions WHERE repertoire_id = ? AND position_key = ?",
      repertoireId,
      positionKey
    );
    return row ? toDecision(row) : null;
  },

  upsert(decision: StoredDecision, now: number): void {
    run(
      `INSERT INTO repertoire_decisions (repertoire_id, position_key, accepted_ucis_json, preferred_uci,
        prompt, hint, wrong_move_feedback_json, paused, acceptance_fingerprint, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repertoire_id, position_key) DO UPDATE SET
        accepted_ucis_json = excluded.accepted_ucis_json, preferred_uci = excluded.preferred_uci,
        prompt = excluded.prompt, hint = excluded.hint,
        wrong_move_feedback_json = excluded.wrong_move_feedback_json, paused = excluded.paused,
        acceptance_fingerprint = excluded.acceptance_fingerprint, updated_at = excluded.updated_at`,
      decision.repertoireId,
      decision.positionKey,
      JSON.stringify(decision.acceptedUcis),
      decision.preferredUci,
      decision.prompt,
      decision.hint,
      JSON.stringify(decision.wrongMoveFeedback),
      decision.paused ? 1 : 0,
      decision.acceptanceFingerprint,
      now
    );
  },

  /** True when the position has an active supporting occurrence in the current index. */
  isSupported(repertoireId: string, positionKey: string): boolean {
    return (
      get<{ found: number }>(
        `SELECT 1 AS found FROM repertoire_position_index WHERE repertoire_id = ? AND position_key = ?
          AND is_decision = 1 LIMIT 1`,
        repertoireId,
        positionKey
      ) !== null
    );
  }
};

export const progressRepository = {
  list(repertoireId: string): RepertoireProgress[] {
    return all<ProgressRow>(
      "SELECT * FROM repertoire_progress WHERE repertoire_id = ?",
      repertoireId
    ).map(toProgress);
  },

  get(repertoireId: string, positionKey: string): RepertoireProgress | null {
    const row = get<ProgressRow>(
      "SELECT * FROM repertoire_progress WHERE repertoire_id = ? AND position_key = ?",
      repertoireId,
      positionKey
    );
    return row ? toProgress(row) : null;
  },

  upsert(progress: RepertoireProgress): void {
    run(
      `INSERT INTO repertoire_progress (repertoire_id, position_key, stage, due_at, last_attempt_at, lapses,
        unaided_successes, acceptance_fingerprint, scheduler_version, suspended)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repertoire_id, position_key) DO UPDATE SET stage = excluded.stage,
        due_at = excluded.due_at, last_attempt_at = excluded.last_attempt_at, lapses = excluded.lapses,
        unaided_successes = excluded.unaided_successes,
        acceptance_fingerprint = excluded.acceptance_fingerprint,
        scheduler_version = excluded.scheduler_version, suspended = excluded.suspended`,
      progress.repertoireId,
      progress.positionKey,
      progress.stage,
      progress.dueAt,
      progress.lastAttemptAt,
      progress.lapses,
      progress.unaidedSuccesses,
      progress.acceptanceFingerprint,
      progress.schedulerVersion,
      progress.suspended ? 1 : 0
    );
  }
};

export const positionIndexRepository = {
  /** Replaces a repertoire's derived index rows. */
  replace(repertoireId: string, rows: readonly PositionIndexRow[], revision: number): void {
    run("DELETE FROM repertoire_position_index WHERE repertoire_id = ?", repertoireId);
    const insert = repertoireDb().prepare(
      `INSERT INTO repertoire_position_index (repertoire_id, chapter_id, node_id, position_key, scope_state,
        is_decision, ply, revision, key_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insert.run(
        repertoireId,
        row.chapterId,
        row.nodeId,
        row.positionKey,
        row.scopeState,
        row.isDecision ? 1 : 0,
        row.ply,
        revision,
        REPERTOIRE_POSITION_KEY_VERSION
      );
    }
  },

  list(repertoireId: string): PositionIndexRow[] {
    return all<{
      chapter_id: string;
      node_id: string;
      position_key: string;
      scope_state: string;
      is_decision: number;
      ply: number;
    }>(
      `SELECT chapter_id, node_id, position_key, scope_state, is_decision, ply
        FROM repertoire_position_index WHERE repertoire_id = ? ORDER BY chapter_id, ply, node_id`,
      repertoireId
    ).map((row) => ({
      chapterId: row.chapter_id,
      nodeId: row.node_id,
      positionKey: row.position_key,
      scopeState: row.scope_state,
      isDecision: row.is_decision === 1,
      ply: row.ply
    }));
  },

  /** The chapters with an active occurrence of a position, in chapter order. */
  activeChapterIds(repertoireId: string, positionKey: string): string[] {
    return all<{ chapter_id: string }>(
      `SELECT i.chapter_id FROM repertoire_position_index i
        JOIN repertoire_chapters c ON c.id = i.chapter_id
        WHERE i.repertoire_id = ? AND i.position_key = ? AND i.scope_state = 'active'
        GROUP BY i.chapter_id ORDER BY MIN(c.sort_order), MIN(c.created_at), i.chapter_id`,
      repertoireId,
      positionKey
    ).map((row) => row.chapter_id);
  },

  /**
   * Every occurrence of a position in a repertoire, whatever its scope state, with its chapter's
   * title; ordered by chapter order, then ply, then node id.
   */
  occurrences(
    repertoireId: string,
    positionKey: string
  ): { chapterId: string; chapterTitle: string; nodeId: string; ply: number }[] {
    return all<{ chapter_id: string; title: string; node_id: string; ply: number }>(
      `SELECT i.chapter_id, c.title, i.node_id, i.ply FROM repertoire_position_index i
        JOIN repertoire_chapters c ON c.id = i.chapter_id
        WHERE i.repertoire_id = ? AND i.position_key = ?
        ORDER BY c.sort_order, c.created_at, c.id, i.ply, i.node_id`,
      repertoireId,
      positionKey
    ).map((row) => ({
      chapterId: row.chapter_id,
      chapterTitle: row.title,
      nodeId: row.node_id,
      ply: row.ply
    }));
  }
};

export const sessionRepository = {
  /** How many practice sessions a repertoire has, optionally only active ones. */
  count(repertoireId: string, status?: "active"): number {
    const row = get<{ value: number }>(
      status
        ? "SELECT COUNT(*) AS value FROM repertoire_practice_sessions WHERE repertoire_id = ? AND status = ?"
        : "SELECT COUNT(*) AS value FROM repertoire_practice_sessions WHERE repertoire_id = ?",
      ...(status ? [repertoireId, status] : [repertoireId])
    );
    return row?.value ?? 0;
  },

  /** A repertoire's session rows exactly as stored (the retained backup's forensic history). */
  rawRows(repertoireId: string): Record<string, unknown>[] {
    return all<Record<string, unknown>>(
      "SELECT * FROM repertoire_practice_sessions WHERE repertoire_id = ? ORDER BY created_at, id",
      repertoireId
    ).map((row) => ({ ...row }));
  },

  get(id: string): PracticeSessionRecord | null {
    const row = get<SessionRow>("SELECT * FROM repertoire_practice_sessions WHERE id = ?", id);
    return row ? toSession(row) : null;
  },

  /** The most recently updated active session of a repertoire that isn't archived. */
  lastActive(): { id: string; repertoireId: string; mode: PracticeMode } | null {
    const row = get<{ id: string; repertoire_id: string; mode: string }>(
      `SELECT s.id, s.repertoire_id, s.mode FROM repertoire_practice_sessions s
        JOIN repertoires r ON r.id = s.repertoire_id
        WHERE s.status = 'active' AND r.archived_at IS NULL
        ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1`
    );
    return row
      ? { id: row.id, repertoireId: row.repertoire_id, mode: sessionMode(row.mode) }
      : null;
  },

  /** Inserts or replaces a session's mutable state. */
  save(session: PracticeSessionRecord): void {
    run(
      `INSERT INTO repertoire_practice_sessions (id, repertoire_id, mode, scope_json, snapshot_revision,
        queue_json, card_state_json, cursor, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET snapshot_revision = excluded.snapshot_revision,
        queue_json = excluded.queue_json, card_state_json = excluded.card_state_json,
        cursor = excluded.cursor, status = excluded.status, updated_at = excluded.updated_at`,
      session.id,
      session.repertoireId,
      session.mode,
      JSON.stringify(session.scope),
      session.snapshotRevision,
      JSON.stringify(session.cards),
      JSON.stringify(
        session.rehearsal
          ? { ...session.policies, [REHEARSAL_KEY]: session.rehearsal }
          : session.policies
      ),
      session.cursor,
      session.status,
      session.createdAt,
      session.updatedAt
    );
  }
};

export const attemptRepository = {
  /** Every attempt row of a repertoire's sessions exactly as stored (forensic history). */
  rawRowsForRepertoire(repertoireId: string): Record<string, unknown>[] {
    return all<Record<string, unknown>>(
      `SELECT a.* FROM repertoire_attempts a
        JOIN repertoire_practice_sessions s ON s.id = a.session_id
        WHERE s.repertoire_id = ? ORDER BY a.session_id, a.sequence, a.at`,
      repertoireId
    ).map((row) => ({ ...row }));
  },

  get(attemptId: string): AttemptRecord | null {
    const row = get<AttemptRow>(
      "SELECT * FROM repertoire_attempts WHERE attempt_id = ?",
      attemptId
    );
    return row ? toAttempt(row) : null;
  },

  /** A session's actions in order (one card's when `queueItemId` is given). */
  list(sessionId: string, queueItemId?: string): AttemptRecord[] {
    const rows =
      queueItemId === undefined
        ? all<AttemptRow>(
            "SELECT * FROM repertoire_attempts WHERE session_id = ? ORDER BY sequence, at",
            sessionId
          )
        : all<AttemptRow>(
            `SELECT * FROM repertoire_attempts WHERE session_id = ? AND queue_item_id = ?
              ORDER BY sequence`,
            sessionId,
            queueItemId
          );
    return rows.map(toAttempt);
  },

  /** The latest action time in a session (scheduling never goes back before it). */
  lastAt(sessionId: string): number | null {
    return (
      get<{ value: number | null }>(
        "SELECT MAX(at) AS value FROM repertoire_attempts WHERE session_id = ?",
        sessionId
      )?.value ?? null
    );
  },

  insert(attempt: AttemptRecord): void {
    run(
      `INSERT INTO repertoire_attempts (attempt_id, session_id, queue_item_id, sequence, kind, uci, legal,
        correct, is_final_grade, outcome, position_key, fingerprint, result_json, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attempt.attemptId,
      attempt.sessionId,
      attempt.queueItemId,
      attempt.sequence,
      attempt.kind,
      attempt.uci,
      attempt.legal ? 1 : 0,
      attempt.correct ? 1 : 0,
      attempt.isFinalGrade ? 1 : 0,
      attempt.outcome,
      attempt.positionKey,
      attempt.fingerprint,
      attempt.resultJson,
      attempt.at
    );
  },

  setResult(attemptId: string, resultJson: string): void {
    run(
      "UPDATE repertoire_attempts SET result_json = ? WHERE attempt_id = ?",
      resultJson,
      attemptId
    );
  }
};

export const workspaceRepository = {
  get(repertoireId: string): RepertoireWorkspaceState | null {
    const row = get<WorkspaceRow>(
      "SELECT * FROM repertoire_workspace_state WHERE repertoire_id = ?",
      repertoireId
    );
    return row ? toWorkspace(row) : null;
  },

  /**
   * Stores the workspace. `studied` false (a practice-setup write) keeps the stored study time
   * (0 for a new row), which orders "Continue studying" and the last-studied date.
   */
  save(
    repertoireId: string,
    workspace: RepertoireWorkspaceState,
    now: number,
    studied = true
  ): void {
    run(
      `INSERT INTO repertoire_workspace_state (repertoire_id, last_chapter_id, last_node_id, orientation,
        practice_draft_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(repertoire_id) DO UPDATE SET last_chapter_id = excluded.last_chapter_id,
        last_node_id = excluded.last_node_id, orientation = excluded.orientation,
        practice_draft_json = excluded.practice_draft_json,
        updated_at = CASE WHEN ? THEN excluded.updated_at ELSE repertoire_workspace_state.updated_at END`,
      repertoireId,
      workspace.lastChapterId,
      workspace.lastNodeId,
      workspace.orientation,
      workspace.practiceDraft ? JSON.stringify(workspace.practiceDraft) : null,
      studied ? now : 0,
      studied ? 1 : 0
    );
  }
};

type GameLinkRow = {
  id: string;
  repertoire_id: string;
  chapter_id: string | null;
  game_id: string | null;
  unsaved: number;
  game_node_id: string | null;
  kind: string;
  headers_json: string;
  captured_path: string;
  created_at: number;
};

function toGameLink(row: GameLinkRow): RepertoireGameLink {
  return {
    id: row.id,
    repertoireId: row.repertoire_id,
    chapterId: row.chapter_id,
    gameId: row.game_id,
    unsaved: row.unsaved === 1,
    gameNodeId: row.game_node_id,
    kind: row.kind === "model" || row.kind === "played" ? row.kind : "source",
    headers: stringRecord(row.headers_json),
    capturedPath: row.captured_path,
    createdAt: row.created_at
  };
}

/** Provenance links (design §6.2, §6.5); a deleted game or chapter leaves a null reference. */
export const gameLinkRepository = {
  insert(link: RepertoireGameLink): void {
    run(
      `INSERT INTO repertoire_game_links (id, repertoire_id, chapter_id, game_id, unsaved, game_node_id,
        kind, headers_json, captured_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      link.id,
      link.repertoireId,
      link.chapterId,
      link.gameId,
      link.unsaved ? 1 : 0,
      link.gameNodeId,
      link.kind,
      JSON.stringify(link.headers),
      link.capturedPath,
      link.createdAt
    );
  },

  get(id: string): RepertoireGameLink | null {
    const row = get<GameLinkRow>("SELECT * FROM repertoire_game_links WHERE id = ?", id);
    return row ? toGameLink(row) : null;
  },

  /** A repertoire's links (optionally one chapter's), oldest first. */
  list(repertoireId: string, chapterId?: string): RepertoireGameLink[] {
    const rows =
      chapterId === undefined
        ? all<GameLinkRow>(
            "SELECT * FROM repertoire_game_links WHERE repertoire_id = ? ORDER BY created_at, id",
            repertoireId
          )
        : all<GameLinkRow>(
            `SELECT * FROM repertoire_game_links WHERE repertoire_id = ? AND chapter_id = ?
              ORDER BY created_at, id`,
            repertoireId,
            chapterId
          );
    return rows.map(toGameLink);
  },

  /** The oldest link of this kind between the repertoire and the game, if any. */
  find(
    repertoireId: string,
    gameId: string,
    kind: RepertoireGameLink["kind"]
  ): RepertoireGameLink | null {
    const row = get<GameLinkRow>(
      `SELECT * FROM repertoire_game_links WHERE repertoire_id = ? AND game_id = ? AND kind = ?
        ORDER BY created_at, id LIMIT 1`,
      repertoireId,
      gameId,
      kind
    );
    return row ? toGameLink(row) : null;
  },

  /** Re-points a link at another chapter/node/path; headers and creation time stay. */
  updateTarget(
    id: string,
    target: Pick<RepertoireGameLink, "chapterId" | "gameNodeId" | "capturedPath">
  ): void {
    run(
      `UPDATE repertoire_game_links SET chapter_id = ?, game_node_id = ?, captured_path = ?
        WHERE id = ?`,
      target.chapterId,
      target.gameNodeId,
      target.capturedPath,
      id
    );
  },

  /** Replaces a link's copied headers (a played game that has since finished). */
  updateHeaders(id: string, headers: RepertoireGameLink["headers"]): void {
    run(
      "UPDATE repertoire_game_links SET headers_json = ? WHERE id = ?",
      JSON.stringify(headers),
      id
    );
  },

  remove(id: string): void {
    run("DELETE FROM repertoire_game_links WHERE id = ?", id);
  }
};

/** Whether the library has a game with this id (provenance links reference it). */
export function libraryGameExists(gameId: string): boolean {
  return get<{ id: string }>("SELECT id FROM games WHERE id = ?", gameId) !== null;
}
