import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import type { TelemetryConfig } from "../config";
import { TelemetryService, type TelemetryDeps } from "../service";

/** Test-only: an in-memory database with the telemetry tables (migration 5's statements). */
export function telemetryDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE telemetry_outbox (
    uuid TEXT PRIMARY KEY, event TEXT NOT NULL, occurred_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0)`);
  db.exec("CREATE TABLE telemetry_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

export const AVAILABLE: TelemetryConfig = {
  available: true,
  reason: null,
  project: { token: "phc_test", host: "https://eu.i.posthog.com" }
};

export type CapturedBatch = {
  url: string;
  body: {
    api_key: string;
    batch: {
      uuid: string;
      event: string;
      distinct_id: string;
      timestamp: string;
      properties: Record<string, unknown>;
    }[];
  };
};

/** A fake capture endpoint answering `status` (or throwing, for `"offline"`) and recording batches. */
export function fakeEndpoint(initial: number | "offline" = 200) {
  const batches: CapturedBatch[] = [];
  let status: number | "offline" = initial;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    if (status === "offline") throw new TypeError("fetch failed");
    batches.push({
      url,
      body: JSON.parse(typeof init.body === "string" ? init.body : "") as CapturedBatch["body"]
    });
    return new Response("{}", { status });
  });
  return {
    fetchImpl,
    batches,
    events: () => batches.flatMap((batch) => batch.body.batch),
    setStatus: (next: number | "offline") => {
      status = next;
    }
  };
}

export function makeService(
  overrides: Partial<TelemetryDeps> & { db: DatabaseSync; consent?: () => boolean }
) {
  const { db, ...rest } = overrides;
  return new TelemetryService({
    config: AVAILABLE,
    database: () => db,
    consent: () => true,
    fetchImpl: fakeEndpoint().fetchImpl,
    appVersion: "1.2.3",
    platform: "darwin",
    arch: "arm64",
    ...rest
  });
}

export function outboxRows(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT uuid, event, occurred_at, attempts, next_attempt_at FROM telemetry_outbox ORDER BY occurred_at"
    )
    .all() as {
    uuid: string;
    event: string;
    occurred_at: number;
    attempts: number;
    next_attempt_at: number;
  }[];
}
