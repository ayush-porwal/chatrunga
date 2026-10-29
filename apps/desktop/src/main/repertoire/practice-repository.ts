/** Practice sessions and their attempts (design §8.3): rows and their mapping to records. */
import type {
  PracticeCard,
  PracticeMode,
  PracticeScope,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { queriesOn } from "../db/rows";
import { asColor, parseJson } from "./columns";
import { repertoireDb } from "./connection";

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
  kind: AttemptKind;
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

const { all, get, run } = queriesOn(repertoireDb);

function sessionMode(mode: string): PracticeMode {
  return mode === "learn-new" ||
    mode === "rehearse-lines" ||
    mode === "practice-early" ||
    mode === "weak"
    ? mode
    : "review-due";
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
    policies: policies,
    ...(rehearsal ? { rehearsal: rehearsal } : {}),
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
    kind: row.kind,
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

/** A set's name as the Practice tab shows it: "Everything" for both colours, else "All White". */
function setLabel(repertoireIds: readonly string[]): string {
  const colors = new Set(
    all<{ color: string }>(
      `SELECT DISTINCT color FROM repertoires WHERE id IN (${repertoireIds.map(() => "?").join(", ")})`,
      ...repertoireIds
    ).map((row) => asColor(row.color))
  );
  if (colors.size !== 1) return "Everything";
  return colors.has("black") ? "All Black" : "All White";
}

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

  /**
   * The most recently updated active session of a repertoire that isn't archived; a set's names
   * the set ("Everything", "All White").
   */
  lastActive(): {
    id: string;
    repertoireId: string;
    mode: PracticeMode;
    repertoireName: string;
    color: RepertoireColor;
    setLabel: string | null;
  } | null {
    const row = get<{
      id: string;
      repertoire_id: string;
      mode: string;
      scope_json: string;
      name: string;
      color: string;
    }>(
      `SELECT s.id, s.repertoire_id, s.mode, s.scope_json, r.name, r.color
        FROM repertoire_practice_sessions s JOIN repertoires r ON r.id = s.repertoire_id
        WHERE s.status = 'active' AND r.archived_at IS NULL
        ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1`
    );
    if (!row) return null;
    const { repertoireIds } = parseJson<PracticeScope>(row.scope_json, {
      repertoireId: row.repertoire_id
    });
    return {
      id: row.id,
      repertoireId: row.repertoire_id,
      mode: sessionMode(row.mode),
      repertoireName: row.name,
      color: asColor(row.color),
      setLabel: repertoireIds && repertoireIds.length > 1 ? setLabel(repertoireIds) : null
    };
  },

  /**
   * Before a repertoire is deleted or archived: the set sessions it holds move to another of the
   * set's repertoires (an active one; when deleting, else any still there), so they, and every
   * repertoire's answers in them, don't go with it.
   */
  moveSetSessions(repertoireId: string, deleting: boolean): void {
    const rows = all<{ id: string; scope_json: string }>(
      `SELECT id, scope_json FROM repertoire_practice_sessions
        WHERE repertoire_id = ? AND scope_json LIKE '%"repertoireIds"%'`,
      repertoireId
    );
    for (const row of rows) {
      const scope = parseJson<PracticeScope>(row.scope_json, { repertoireId });
      const others = (scope.repertoireIds ?? []).filter((id) => id !== repertoireId);
      const states = new Map(
        others.map((id) => [
          id,
          get<{ archived_at: number | null }>(
            "SELECT archived_at FROM repertoires WHERE id = ?",
            id
          )
        ])
      );
      const next =
        others.find((id) => states.get(id) && states.get(id)?.archived_at === null) ??
        (deleting ? others.find((id) => states.get(id)) : undefined);
      if (!next) continue;
      run(
        "UPDATE repertoire_practice_sessions SET repertoire_id = ?, scope_json = ? WHERE id = ?",
        next,
        JSON.stringify({ ...scope, repertoireId: next }),
        row.id
      );
    }
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
