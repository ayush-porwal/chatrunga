import type { DatabaseSync } from "node:sqlite";
import { allRows, getRow } from "../db/rows";
import { isRecord } from "@chaturanga/shared/types/guards";

/** One recorded event, as it is kept until PostHog has accepted it. */
export type OutboxEvent = {
  /** Sent as PostHog's `uuid`: the same on every retry, so a resend can be deduplicated. */
  uuid: string;
  event: string;
  /** When it happened (epoch ms): sent as the event's `timestamp`, however late it is delivered. */
  occurredAt: number;
  properties: Record<string, unknown>;
  attempts: number;
};

/** At most this many events wait; past it the oldest are dropped. */
export const OUTBOX_MAX_EVENTS = 5_000;
/** Events older than this are dropped unsent (a long-offline installation). */
export const OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A batch that keeps failing is given up after this many attempts. */
export const OUTBOX_MAX_ATTEMPTS = 12;

type Row = {
  uuid: string;
  event: string;
  occurred_at: number;
  payload_json: string;
  attempts: number;
};

/**
 * The durable queue (SQLite table `telemetry_outbox`): events survive restarts and stay there until
 * delivery is acknowledged. `database` is read on every call so a closed database is never reopened
 * here (the service stops calling it before shutdown closes it).
 */
export class TelemetryOutbox {
  constructor(private readonly database: () => DatabaseSync) {}

  add(event: OutboxEvent): void {
    this.database()
      .prepare(
        "INSERT OR IGNORE INTO telemetry_outbox (uuid, event, occurred_at, payload_json, attempts) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        event.uuid,
        event.event,
        event.occurredAt,
        JSON.stringify(event.properties),
        event.attempts
      );
  }

  /** Up to `limit` events due for (another) attempt, oldest first. */
  due(now: number, limit: number): OutboxEvent[] {
    const rows = allRows<Row>(
      this.database().prepare(
        "SELECT uuid, event, occurred_at, payload_json, attempts FROM telemetry_outbox WHERE next_attempt_at <= ? ORDER BY occurred_at, rowid LIMIT ?"
      ),
      now,
      limit
    );
    return rows.map((row) => {
      const properties: unknown = JSON.parse(row.payload_json);
      return {
        uuid: row.uuid,
        event: row.event,
        occurredAt: row.occurred_at,
        properties: isRecord(properties) ? properties : {},
        attempts: row.attempts
      };
    });
  }

  /** Delivered (or given up): gone for good. */
  remove(uuids: readonly string[]): void {
    if (!uuids.length) return;
    const remove = this.database().prepare("DELETE FROM telemetry_outbox WHERE uuid = ?");
    this.inTransaction(() => {
      for (const uuid of uuids) remove.run(uuid);
    });
  }

  /** Not delivered this time: one more attempt counted, the next one not before `nextAttemptAt`. */
  defer(uuids: readonly string[], nextAttemptAt: number): void {
    if (!uuids.length) return;
    const defer = this.database().prepare(
      "UPDATE telemetry_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE uuid = ?"
    );
    this.inTransaction(() => {
      for (const uuid of uuids) defer.run(nextAttemptAt, uuid);
    });
  }

  /** Applies the age and size limits; returns how many events were dropped. */
  prune(now: number): number {
    const database = this.database();
    const expired = database
      .prepare("DELETE FROM telemetry_outbox WHERE occurred_at < ?")
      .run(now - OUTBOX_MAX_AGE_MS);
    const excess = this.count() - OUTBOX_MAX_EVENTS;
    let overflow = 0;
    if (excess > 0) {
      overflow = Number(
        database
          .prepare(
            "DELETE FROM telemetry_outbox WHERE uuid IN (SELECT uuid FROM telemetry_outbox ORDER BY occurred_at, rowid LIMIT ?)"
          )
          .run(excess).changes
      );
    }
    return Number(expired.changes) + overflow;
  }

  count(): number {
    return getRow<{ n: number }>(this.database().prepare("SELECT COUNT(*) AS n FROM telemetry_outbox"))?.n ?? 0;
  }

  /** Collection was turned off: nothing recorded so far is sent. */
  purge(): void {
    this.database().exec("DELETE FROM telemetry_outbox");
  }

  /** Runs a batch of writes in one transaction, taking the write lock up front (IMMEDIATE). */
  private inTransaction(work: () => void): void {
    const database = this.database();
    database.exec("BEGIN IMMEDIATE");
    try {
      work();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

/** The installation's telemetry state (`telemetry_state`): id, milestones reached, last active day. */
export class TelemetryState {
  constructor(private readonly database: () => DatabaseSync) {}

  get(key: string): string | null {
    const row = getRow<{ value: string }>(
      this.database().prepare("SELECT value FROM telemetry_state WHERE key = ?"),
      key
    );
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.database()
      .prepare(
        "INSERT INTO telemetry_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }
}
