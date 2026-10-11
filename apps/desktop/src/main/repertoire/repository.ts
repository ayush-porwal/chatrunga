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
  type RepertoireBackupChapter,
  type RepertoireChapter,
  type RepertoireChapterSummary,
  type RepertoireColor,
  type RepertoireDecision,
  type RepertoireListFilters,
  type RepertoireNodeMeta,
  type RepertoireProgress,
  type RepertoireSummary
} from "@chaturanga/shared/types/repertoire";
import { repertoireDb } from "./connection";
import { queriesOn, rollbackIfOpen, sqliteErrcode } from "../db/rows";
import { asColor, asKind, parseJson, stringArray, stringRecord } from "./columns";
import { parseStoredJson } from "../stored-json";

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

/** A repertoire's own columns (no aggregates). */
export type RepertoireRecord = Omit<
  RepertoireSummary,
  "chapterCount" | "decisionCount" | "dueCount" | "lastStudiedAt"
>;

/** A decision as stored, with the fingerprint of its effective set at the last reindex. */
export type StoredDecision = RepertoireDecision & { acceptanceFingerprint: string };

export type PositionIndexRow = {
  chapterId: string;
  nodeId: string;
  positionKey: string;
  scopeState: string;
  isDecision: boolean;
  ply: number;
};

const { all, get, run } = queriesOn(repertoireDb);

/** How a transaction locks: reads never take the write lock; writes take it up front. */
export type TransactionMode = "read" | "write";

/** The message a busy database gives the user (the write lock stayed held past the timeout). */
const REPERTOIRE_BUSY_MESSAGE = "The repertoire database is busy; try again.";

/** True for SQLite's BUSY error (any extended code), as node:sqlite reports it. */
function isBusyError(error: unknown): boolean {
  const code = sqliteErrcode(error);
  return code !== undefined && (code & 0xff) === 5;
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
    rollbackIfOpen(db);
    throw actionableBusyError(error);
  }
}

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

/** The fields every stored move-tree node has; the rest were validated when it was saved. */
function isStoredNode(value: unknown): value is MoveNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "fenAfter" in value &&
    typeof value.fenAfter === "string" &&
    "children" in value &&
    Array.isArray(value.children)
  );
}

/**
 * The chapter's tree, metadata and headers, checked structurally on load. Anything unreadable
 * throws RepertoireCorruptChapterError — never an empty tree in its place.
 */
function toChapter(row: ChapterRow): RepertoireChapter {
  const corrupt = (reason: string) => new RepertoireCorruptChapterError(row.id, reason);
  let tree: unknown;
  let nodeMeta: Record<string, RepertoireNodeMeta> | null;
  let headers: unknown;
  try {
    tree = JSON.parse(row.tree_json);
    // Written by the chapter save after validation (chapter-validation.ts); checked below for shape.
    nodeMeta = parseStoredJson<Record<string, RepertoireNodeMeta> | null>(row.node_metadata_json);
    headers = JSON.parse(row.headers_json);
  } catch {
    throw corrupt("its stored JSON is unreadable");
  }
  if (!Array.isArray(tree) || !tree.length) throw corrupt("the move tree is missing");
  if (!tree.every(isStoredNode)) throw corrupt("a move-tree node is malformed");
  if (!tree.some((node) => node.id === REPERTOIRE_ROOT_NODE_ID && node.parentId === null)) {
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
    tree,
    nodeMeta
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

/** Decisions that count: not paused, with at least one active supported occurrence. */
const COUNTED_DECISION = `d.paused = 0 AND EXISTS (SELECT 1 FROM repertoire_position_index i
  WHERE i.repertoire_id = d.repertoire_id AND i.position_key = d.position_key AND i.is_decision = 1)`;

/** Due progress rows (bound parameter: now) of counted decisions. */
const DUE_PROGRESS = `p.suspended = 0 AND p.due_at IS NOT NULL AND p.due_at <= ? AND EXISTS (
  SELECT 1 FROM repertoire_decisions d WHERE d.repertoire_id = p.repertoire_id
  AND d.position_key = p.position_key AND ${COUNTED_DECISION})`;

/** When repertoire `r` was last studied: its workspace or chapter edits, whichever is later. */
const LAST_STUDIED_AT = `MAX(
    COALESCE((SELECT w.updated_at FROM repertoire_workspace_state w WHERE w.repertoire_id = r.id), 0),
    COALESCE((SELECT MAX(c.updated_at) FROM repertoire_chapters c WHERE c.repertoire_id = r.id), 0)
  )`;

const SUMMARY_SELECT = `SELECT r.*,
  (SELECT COUNT(*) FROM repertoire_chapters c WHERE c.repertoire_id = r.id) AS chapter_count,
  (SELECT COUNT(*) FROM repertoire_decisions d WHERE d.repertoire_id = r.id AND ${COUNTED_DECISION})
    AS decision_count,
  (SELECT COUNT(*) FROM repertoire_progress p WHERE p.repertoire_id = r.id AND ${DUE_PROGRESS})
    AS due_count,
  ${LAST_STUDIED_AT} AS last_studied_at
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

  /**
   * Active repertoires with due decisions (bound: now), the most due first; ties go to the most
   * recently studied, then by name. At most `limit` of them.
   */
  dueRanking(
    now: number,
    limit: number
  ): { id: string; name: string; color: RepertoireColor; dueCount: number }[] {
    return all<{ id: string; name: string; color: string; due_count: number }>(
      `SELECT r.id, r.name, r.color, COUNT(*) AS due_count, ${LAST_STUDIED_AT} AS last_studied_at
        FROM repertoire_progress p JOIN repertoires r ON r.id = p.repertoire_id
        WHERE r.archived_at IS NULL AND ${DUE_PROGRESS}
        GROUP BY r.id ORDER BY due_count DESC, last_studied_at DESC, r.name, r.id LIMIT ?`,
      now,
      limit
    ).map((row) => ({
      id: row.id,
      name: row.name,
      color: asColor(row.color),
      dueCount: row.due_count
    }));
  },

  /**
   * A repertoire's due decision due earliest (bound: now; then the shallowest), and the node to
   * show it at: its shallowest occurrence, in an enabled chapter when one has it.
   */
  nextDue(
    repertoireId: string,
    now: number
  ): { positionKey: string; chapterId: string; nodeId: string; rootFen: string } | null {
    const due = get<{ position_key: string }>(
      `SELECT p.position_key FROM repertoire_progress p
        JOIN repertoire_position_index i ON i.repertoire_id = p.repertoire_id
          AND i.position_key = p.position_key AND i.is_decision = 1
        WHERE p.repertoire_id = ? AND ${DUE_PROGRESS}
        GROUP BY p.position_key ORDER BY p.due_at, MIN(i.ply), p.position_key LIMIT 1`,
      repertoireId,
      now
    );
    if (!due) return null;
    const occurrence = get<{ chapter_id: string; node_id: string; root_fen: string }>(
      `SELECT i.chapter_id, i.node_id, c.root_fen FROM repertoire_position_index i
        JOIN repertoire_chapters c ON c.id = i.chapter_id
        WHERE i.repertoire_id = ? AND i.position_key = ?
        ORDER BY c.enabled DESC, i.is_decision DESC, i.ply, c.sort_order, c.created_at, c.id,
          i.node_id LIMIT 1`,
      repertoireId,
      due.position_key
    );
    return occurrence
      ? {
          positionKey: due.position_key,
          chapterId: occurrence.chapter_id,
          nodeId: occurrence.node_id,
          rootFen: occurrence.root_fen
        }
      : null;
  },

  /** The most recently saved study place of an active repertoire whose chapter still exists. */
  lastStudyPlace(): {
    repertoireId: string;
    repertoireName: string;
    color: RepertoireColor;
    chapterId: string;
    chapterTitle: string;
    rootFen: string;
    nodeId: string | null;
  } | null {
    const row = get<{
      repertoire_id: string;
      name: string;
      color: string;
      last_chapter_id: string;
      title: string;
      root_fen: string;
      last_node_id: string | null;
    }>(
      `SELECT w.repertoire_id, r.name, r.color, w.last_chapter_id, c.title, c.root_fen,
        w.last_node_id FROM repertoire_workspace_state w
        JOIN repertoires r ON r.id = w.repertoire_id
        JOIN repertoire_chapters c ON c.id = w.last_chapter_id AND c.repertoire_id = w.repertoire_id
        WHERE r.archived_at IS NULL ORDER BY w.updated_at DESC LIMIT 1`
    );
    return row
      ? {
          repertoireId: row.repertoire_id,
          repertoireName: row.name,
          color: asColor(row.color),
          chapterId: row.last_chapter_id,
          chapterTitle: row.title,
          rootFen: row.root_fen,
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

  /** One chapter's due count (bound: now), as `summaries` counts it, without the other chapters. */
  dueCount(chapterId: string, now: number): number {
    const row = get<{ value: number }>(
      `SELECT COUNT(DISTINCT i.position_key) AS value FROM repertoire_position_index i
        JOIN repertoire_progress p ON p.repertoire_id = i.repertoire_id AND p.position_key = i.position_key
        WHERE i.chapter_id = ? AND i.is_decision = 1 AND ${DUE_PROGRESS}
        AND NOT EXISTS (SELECT 1 FROM repertoires r WHERE r.id = i.repertoire_id
          AND r.archived_at IS NOT NULL)`,
      chapterId,
      now
    );
    return row?.value ?? 0;
  },

  /** Every chapter of a repertoire, in order (throws if one is damaged). */
  /** A repertoire's chapters in order (compareChaptersAsListed, for rows created together). */
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

  /**
   * One node of a chapter's tree, picked out in SQLite: only that node crosses into JavaScript
   * (SQLite's json_each still parses the stored tree). Null when the chapter or node is gone or
   * the stored tree is unreadable.
   */
  node(
    chapterId: string,
    nodeId: string
  ): Pick<MoveNode, "san" | "uci" | "fenBefore" | "fenAfter"> | null {
    const row = get<{ node: string }>(
      `SELECT e.value AS node FROM repertoire_chapters c,
        json_each(CASE WHEN json_valid(c.tree_json) THEN c.tree_json ELSE '[]' END) e
        WHERE c.id = ? AND json_extract(e.value, '$.id') = ? LIMIT 1`,
      chapterId,
      nodeId
    );
    const node = parseJson<unknown>(row?.node ?? null, null);
    if (typeof node !== "object" || node === null) return null;
    const field = (key: string): unknown => Reflect.get(node, key);
    const [san, uci, fenBefore, fenAfter] = ["san", "uci", "fenBefore", "fenAfter"].map(field);
    if (typeof fenBefore !== "string" || typeof fenAfter !== "string") return null;
    return {
      san: typeof san === "string" ? san : null,
      uci: typeof uci === "string" ? uci : null,
      fenBefore,
      fenAfter
    };
  },

  /** The repertoire a chapter id belongs to and its revision (without reading its tree). */
  ownerOf(id: string): { repertoireId: string; revision: number } | null {
    const row = get<{ repertoire_id: string; revision: number }>(
      "SELECT repertoire_id, revision FROM repertoire_chapters WHERE id = ?",
      id
    );
    return row ? { repertoireId: row.repertoire_id, revision: row.revision } : null;
  },

  /** A repertoire's chapter ids in chapter order (without reading their trees). */
  orderedIds(repertoireId: string): string[] {
    return all<{ id: string }>(
      "SELECT id FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, created_at, id",
      repertoireId
    ).map((row) => row.id);
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

  /** Sets a chapter's kind and practice switch with its new revision, leaving its tree as stored. */
  updateSettings(
    id: string,
    settings: Pick<RepertoireChapter, "kind" | "enabled" | "revision">,
    now: number
  ): void {
    run(
      "UPDATE repertoire_chapters SET kind = ?, enabled = ?, revision = ?, updated_at = ? WHERE id = ?",
      settings.kind,
      settings.enabled ? 1 : 0,
      settings.revision,
      now,
      id
    );
  },

  remove(id: string): void {
    run("DELETE FROM repertoire_chapters WHERE id = ?", id);
  }
};

/**
 * The order chapterRepository.list returns chapters inserted at the same time in (equal
 * created_at): by sort order, then id (SQLite compares the ASCII ids byte by byte). Lets a writer
 * plan from chapters before inserting them (a backup restore plans its reindex before BEGIN).
 */
export function compareChaptersAsListed(
  a: Pick<RepertoireChapter, "sortOrder" | "id">,
  b: Pick<RepertoireChapter, "sortOrder" | "id">
): number {
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const decisionRepository = {
  list(repertoireId: string): StoredDecision[] {
    return all<DecisionRow>(
      "SELECT * FROM repertoire_decisions WHERE repertoire_id = ? ORDER BY position_key",
      repertoireId
    ).map(toDecision);
  },

  /** The position keys of the repertoire's paused decisions. */
  pausedKeys(repertoireId: string): Set<string> {
    return new Set(
      all<{ position_key: string }>(
        "SELECT position_key FROM repertoire_decisions WHERE repertoire_id = ? AND paused = 1",
        repertoireId
      ).map((row) => row.position_key)
    );
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

/** Most bound parameters one `IN (…)` list of a query uses. */
const IN_CHUNK = 500;

function insertIndexRows(
  repertoireId: string,
  rows: readonly PositionIndexRow[],
  revision: number
): void {
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
}

export const positionIndexRepository = {
  /**
   * Replaces a repertoire's derived index rows. Each row keeps the repertoire revision it was
   * written at: an incremental update rewrites only the changed chapter's rows (see core.ts).
   */
  replace(repertoireId: string, rows: readonly PositionIndexRow[], revision: number): void {
    run("DELETE FROM repertoire_position_index WHERE repertoire_id = ?", repertoireId);
    insertIndexRows(repertoireId, rows, revision);
  },

  /** Replaces one chapter's derived index rows (none: the chapter was removed). */
  replaceChapter(
    repertoireId: string,
    chapterId: string,
    rows: readonly PositionIndexRow[],
    revision: number
  ): void {
    run("DELETE FROM repertoire_position_index WHERE chapter_id = ?", chapterId);
    insertIndexRows(repertoireId, rows, revision);
  },

  /** A chapter's stored position keys by node id (rows of the current key version only). */
  chapterKeys(chapterId: string): Map<string, string> {
    return new Map(
      all<{ node_id: string; position_key: string }>(
        `SELECT node_id, position_key FROM repertoire_position_index
          WHERE chapter_id = ? AND key_version = ?`,
        chapterId,
        REPERTOIRE_POSITION_KEY_VERSION
      ).map((row) => [row.node_id, row.position_key])
    );
  },

  /**
   * The decision occurrences (`is_decision`) of the given position keys, outside one chapter when
   * `exceptChapterId` is given.
   */
  decisionOccurrences(
    repertoireId: string,
    positionKeys: readonly string[],
    exceptChapterId: string | null = null
  ): { chapterId: string; nodeId: string; positionKey: string }[] {
    const found: { chapterId: string; nodeId: string; positionKey: string }[] = [];
    const except = exceptChapterId === null ? [] : [exceptChapterId];
    for (let start = 0; start < positionKeys.length; start += IN_CHUNK) {
      const keys = positionKeys.slice(start, start + IN_CHUNK);
      for (const row of all<{ chapter_id: string; node_id: string; position_key: string }>(
        `SELECT chapter_id, node_id, position_key FROM repertoire_position_index
          WHERE repertoire_id = ? AND is_decision = 1${except.length ? " AND chapter_id != ?" : ""}
          AND position_key IN (${keys.map(() => "?").join(", ")})`,
        repertoireId,
        ...except,
        ...keys
      )) {
        found.push({
          chapterId: row.chapter_id,
          nodeId: row.node_id,
          positionKey: row.position_key
        });
      }
    }
    return found;
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
