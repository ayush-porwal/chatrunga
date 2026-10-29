/**
 * The health check's storage (migration 18): the latest flags per repertoire and position, and the
 * queue (a row per repertoire: queued or running, else its last check, done or failed). Stored
 * JSON is checked as it is read back: a damaged flag is left out. A flag whose position is no
 * longer in the repertoire isn't shown (§6.3: flags go with their position).
 */
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { buildChapterLookup, type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { formatPath } from "@chaturanga/shared/chess/repertoire-pgn";
import { isOneOf, isRecord } from "@chaturanga/shared/types/guards";
import {
  REPERTOIRE_HEALTH_FLAG_KINDS,
  type RepertoireHealthFlag,
  type RepertoireHealthFlagKind,
  type RepertoireHealthState,
  type RepertoireHealthSummary
} from "@chaturanga/shared/types/repertoire-health";
import { getDb } from "../db";
import { settingsRepository, transaction } from "../db/repositories";
import { queriesOn } from "../db/rows";
import { chapterRepository, positionIndexRepository } from "../repertoire/repository";
import { sanAt } from "./explorer";
import type { FoundFlag } from "./health-check";

const { all, get, run } = queriesOn(getDb);

const PAUSED_KEY = "main.repertoireHealth.paused";

/** A position still in the repertoire (any occurrence). */
const POSITION_EXISTS = `EXISTS (SELECT 1 FROM repertoire_position_index i
  WHERE i.repertoire_id = f.repertoire_id AND i.position_key = f.position_key)`;

type FlagRow = {
  repertoire_id: string;
  position_key: string;
  kind: string;
  uci: string;
  data_json: string;
  revision: number;
  checked_at: number;
};

type StoredData = Pick<FoundFlag, "fen" | "bestUci" | "loss" | "probability" | "rating">;

const numberOrNull = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : undefined;

function dataIn(text: string): StoredData | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.fen !== "string") return null;
  const bestUci = value.bestUci;
  const loss = numberOrNull(value.loss);
  const probability = numberOrNull(value.probability);
  const rating = numberOrNull(value.rating);
  if (bestUci !== null && typeof bestUci !== "string") return null;
  if (loss === undefined || probability === undefined || rating === undefined) return null;
  return { fen: value.fen, bestUci, loss, probability, rating };
}

/** Where Study opens a position: its first occurrence, and the line to it. */
type Place = { chapterId: string; nodeId: string; line: string };

/** Places of positions in one repertoire, each chapter's tree read once. */
function placer(repertoireId: string): (key: string) => Place | null {
  const lookups = new Map<string, ChapterLookup | null>();
  const lookupOf = (chapterId: string) => {
    if (!lookups.has(chapterId)) {
      const chapter = chapterRepository.get(chapterId);
      lookups.set(chapterId, chapter ? buildChapterLookup(chapter) : null);
    }
    return lookups.get(chapterId) ?? null;
  };
  return (key) => {
    const first = positionIndexRepository.occurrences(repertoireId, key).at(0);
    const lookup = first ? lookupOf(first.chapterId) : null;
    if (!first || !lookup) return null;
    const ids = lookup.parentPath.get(first.nodeId) ?? [];
    const moves = ids.slice(1).map((id) => lookup.nodesById.get(id)!);
    return { chapterId: first.chapterId, nodeId: first.nodeId, line: formatPath(moves) };
  };
}

function toFlag(row: FlagRow, place: (key: string) => Place | null): RepertoireHealthFlag | null {
  const data = dataIn(row.data_json);
  if (!data || !isOneOf(REPERTOIRE_HEALTH_FLAG_KINDS, row.kind)) return null;
  const where = place(row.position_key);
  if (!where) return null;
  const bestFrom =
    row.kind === "common-mistake" ? (fenAfterUci(data.fen, row.uci) ?? data.fen) : data.fen;
  return {
    repertoireId: row.repertoire_id,
    positionKey: row.position_key,
    kind: row.kind,
    uci: row.uci,
    san: sanAt(data.fen, row.uci),
    bestSan: data.bestUci ? sanAt(bestFrom, data.bestUci) : null,
    ...data,
    ...where,
    revision: row.revision,
    checkedAt: row.checked_at
  };
}

const emptyCounts = (): Record<RepertoireHealthFlagKind, number> => ({
  "engine-disagrees": 0,
  "no-answer": 0,
  "common-mistake": 0
});

export const healthRepository = {
  /**
   * Replaces a repertoire's flags of `kinds` with `flags`, found against `revision`. Nothing is
   * written when the repertoire is gone.
   */
  replaceFlags({
    repertoireId,
    kinds,
    flags,
    revision,
    now
  }: {
    repertoireId: string;
    kinds: readonly RepertoireHealthFlagKind[];
    flags: readonly FoundFlag[];
    revision: number;
    now: number;
  }): void {
    transaction(() => {
      if (!get<{ found: number }>("SELECT 1 AS found FROM repertoires WHERE id = ?", repertoireId))
        return;
      run(
        `DELETE FROM repertoire_health_flags WHERE repertoire_id = ?
          AND kind IN (${kinds.map(() => "?").join(", ")})`,
        repertoireId,
        ...kinds
      );
      for (const flag of flags) {
        const data: StoredData = {
          fen: flag.fen,
          bestUci: flag.bestUci,
          loss: flag.loss,
          probability: flag.probability,
          rating: flag.rating
        };
        run(
          `INSERT OR REPLACE INTO repertoire_health_flags
            (repertoire_id, position_key, kind, uci, data_json, revision, checked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          repertoireId,
          flag.positionKey,
          flag.kind,
          flag.uci,
          JSON.stringify(data),
          revision,
          now
        );
      }
    });
  },

  /** A repertoire's flags at positions it still has, in the order of their lines. */
  flags(repertoireId: string): RepertoireHealthFlag[] {
    const place = placer(repertoireId);
    return all<FlagRow>(
      `SELECT * FROM repertoire_health_flags f WHERE f.repertoire_id = ? AND ${POSITION_EXISTS}
        ORDER BY f.kind, f.position_key, f.uci`,
      repertoireId
    )
      .map((row) => toFlag(row, place))
      .filter((flag) => flag !== null)
      .sort((a, b) => a.line.localeCompare(b.line) || a.kind.localeCompare(b.kind));
  },

  /** Insights' card: every repertoire not archived, with its flag counts and last check. */
  summaries(): RepertoireHealthSummary[] {
    const counts = new Map<string, Record<RepertoireHealthFlagKind, number>>();
    for (const row of all<{ repertoire_id: string; kind: string; count: number }>(
      `SELECT f.repertoire_id, f.kind, COUNT(*) AS count FROM repertoire_health_flags f
        WHERE ${POSITION_EXISTS} GROUP BY f.repertoire_id, f.kind`
    )) {
      if (!isOneOf(REPERTOIRE_HEALTH_FLAG_KINDS, row.kind)) continue;
      const tally = counts.get(row.repertoire_id) ?? emptyCounts();
      tally[row.kind] = row.count;
      counts.set(row.repertoire_id, tally);
    }
    return all<{
      id: string;
      name: string;
      status: string | null;
      checked_at: number | null;
      checked_revision: number | null;
      error: string | null;
    }>(
      `SELECT r.id, r.name, q.status, q.checked_at, q.checked_revision, q.error
        FROM repertoires r LEFT JOIN repertoire_health_queue q ON q.repertoire_id = r.id
        WHERE r.archived_at IS NULL ORDER BY r.name COLLATE NOCASE, r.id`
    ).map((row) => ({
      repertoireId: row.id,
      name: row.name,
      counts: counts.get(row.id) ?? emptyCounts(),
      state: isOneOf<RepertoireHealthState>(["queued", "running", "done", "failed"], row.status)
        ? row.status
        : null,
      checkedAt: row.checked_at,
      checkedRevision: row.checked_revision,
      error: row.error
    }));
  },

  /* ---------------------------------------------------------------- the queue */

  paused(): boolean {
    return settingsRepository.getMain(PAUSED_KEY) === true;
  },

  setPaused(paused: boolean): void {
    settingsRepository.setMain(PAUSED_KEY, paused);
  },

  /** Queues repertoires (one already queued or running keeps its place); unknown ids are skipped. */
  enqueue(repertoireIds: readonly string[], now: number): void {
    transaction(() => {
      let order =
        get<{ last: number | null }>("SELECT MAX(queue_order) AS last FROM repertoire_health_queue")
          ?.last ?? 0;
      for (const id of repertoireIds) {
        if (!get<{ found: number }>("SELECT 1 AS found FROM repertoires WHERE id = ?", id))
          continue;
        order += 1;
        run(
          `INSERT INTO repertoire_health_queue (repertoire_id, status, queue_order, enqueued_at)
          VALUES (?, 'queued', ?, ?)
          ON CONFLICT(repertoire_id) DO UPDATE SET
            status = 'queued', queue_order = excluded.queue_order, enqueued_at = excluded.enqueued_at
          WHERE repertoire_health_queue.status NOT IN ('queued', 'running')`,
          id,
          order,
          now
        );
      }
    });
  },

  /** The next queued repertoire, now running; null when none waits. */
  takeNext(): string | null {
    return transaction(() => {
      const next = get<{ repertoire_id: string }>(
        "SELECT repertoire_id FROM repertoire_health_queue WHERE status = 'queued' ORDER BY queue_order LIMIT 1"
      );
      if (!next) return null;
      run(
        "UPDATE repertoire_health_queue SET status = 'running' WHERE repertoire_id = ?",
        next.repertoire_id
      );
      return next.repertoire_id;
    });
  },

  /** The running repertoire waits again, first in line. */
  requeueRunning(): void {
    run(
      `UPDATE repertoire_health_queue SET status = 'queued',
        queue_order = (SELECT COALESCE(MIN(queue_order), 0) - 1 FROM repertoire_health_queue)
      WHERE status = 'running'`
    );
  },

  /** A check finished: through `revision` (done), or with `error` (failed). */
  finish(repertoireId: string, revision: number | null, error: string | null, now: number): void {
    if (error === null) {
      run(
        `UPDATE repertoire_health_queue SET status = 'done', checked_revision = ?, checked_at = ?,
          error = NULL WHERE repertoire_id = ?`,
        revision,
        now,
        repertoireId
      );
      return;
    }
    run(
      "UPDATE repertoire_health_queue SET status = 'failed', error = ? WHERE repertoire_id = ?",
      error,
      repertoireId
    );
  },

  /**
   * Empties the queue: a repertoire never checked leaves it; one checked before goes back to its
   * last result.
   */
  cancelQueue(): void {
    transaction(() => {
      run(
        "DELETE FROM repertoire_health_queue WHERE status IN ('queued', 'running') AND checked_at IS NULL AND error IS NULL"
      );
      run(
        `UPDATE repertoire_health_queue
          SET status = CASE WHEN error IS NULL THEN 'done' ELSE 'failed' END
        WHERE status IN ('queued', 'running')`
      );
    });
  },

  /** Repertoires waiting, in order. */
  queued(): string[] {
    return all<{ repertoire_id: string }>(
      "SELECT repertoire_id FROM repertoire_health_queue WHERE status = 'queued' ORDER BY queue_order"
    ).map((row) => row.repertoire_id);
  },

  /** Whether the repertoire was checked before (an edit then checks it again). */
  checkedBefore(repertoireId: string): boolean {
    return (
      get<{ checked: number }>(
        "SELECT 1 AS checked FROM repertoire_health_queue WHERE repertoire_id = ? AND (checked_at IS NOT NULL OR error IS NOT NULL)",
        repertoireId
      ) !== null
    );
  }
};
