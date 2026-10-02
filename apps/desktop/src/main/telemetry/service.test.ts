import { afterEach, describe, expect, it, vi } from "vitest";
import { OUTBOX_MAX_AGE_MS, OUTBOX_MAX_ATTEMPTS, OUTBOX_MAX_EVENTS } from "./outbox";
import {
  AVAILABLE,
  fakeEndpoint,
  makeService,
  outboxRows,
  telemetryDatabase
} from "./__fixtures__/telemetry-fixtures";

const T0 = Date.UTC(2026, 9, 2, 9, 30);

afterEach(() => vi.useRealTimers());

describe("TelemetryService delivery", () => {
  it("keeps events offline across a restart and resends them with the same uuid and time", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint("offline");
    let now = T0;
    const first = makeService({
      db,
      fetchImpl: endpoint.fetchImpl,
      now: () => now,
      random: () => 0.5
    });
    first.start();
    first.record("review_started", { review_id: "r1" });
    await first.drain();
    const [queued] = outboxRows(db);
    expect(queued).toMatchObject({ event: "review_started", occurred_at: T0, attempts: 1 });
    expect(queued.next_attempt_at).toBeGreaterThan(T0);
    await first.shutdown(50);

    // Next launch, online and later: the same event goes, stamped with when it happened.
    endpoint.setStatus(200);
    now = T0 + 3 * 60 * 60 * 1000;
    const second = makeService({ db, fetchImpl: endpoint.fetchImpl, now: () => now });
    second.start();
    await second.drain();
    expect(endpoint.events()).toEqual([
      expect.objectContaining({
        uuid: queued.uuid,
        event: "review_started",
        timestamp: new Date(T0).toISOString()
      })
    ]);
    expect(outboxRows(db)).toEqual([]);
  });

  it("sends a stable pseudonymous identity and no person profile or location", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint();
    const service = makeService({ db, fetchImpl: endpoint.fetchImpl });
    service.start();
    service.record("review_opened", { review_id: "r1", game_ref: undefined, distinct_id: "someone-else" });
    await service.drain();
    service.record("review_studied");
    await service.drain();
    const [a, b] = endpoint.events();
    expect(a.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.distinct_id).toBe(a.distinct_id);
    expect(a.properties).toMatchObject({
      $process_person_profile: false,
      $geoip_disable: true,
      app_version: "1.2.3",
      release_channel: "stable",
      platform: "darwin",
      schema_version: 1
    });
    // The distinct id is also inside properties, and a recorded property can't replace it.
    expect(a.properties.distinct_id).toBe(a.distinct_id);
    // Unknown values are left out, never sent as null or 0.
    expect(a.properties).not.toHaveProperty("game_ref");
    expect(endpoint.batches[0].url).toBe("https://eu.i.posthog.com/batch/");
    expect(endpoint.batches[0].body.api_key).toBe("phc_test");
  });

  it("drains one batch at a time: concurrent drains share one request", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint();
    const service = makeService({ db, fetchImpl: endpoint.fetchImpl });
    service.start();
    service.record("review_started");
    service.record("review_completed");
    await Promise.all([service.drain(), service.drain(), service.drain()]);
    expect(endpoint.fetchImpl).toHaveBeenCalledTimes(1);
    expect(endpoint.events().map((event) => event.event)).toEqual([
      "review_started",
      "review_completed"
    ]);
  });

  it("retries 5xx/429 with backoff, drops rejected batches, and gives up after the attempt limit", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint(503);
    let now = T0;
    const service = makeService({
      db,
      fetchImpl: endpoint.fetchImpl,
      now: () => now,
      random: () => 0
    });
    service.start();
    service.record("review_started");
    await service.drain();
    expect(outboxRows(db)[0]).toMatchObject({ attempts: 1, next_attempt_at: T0 + 15_000 });
    // Not due yet: nothing is sent.
    await service.drain();
    expect(endpoint.fetchImpl).toHaveBeenCalledTimes(1);

    // 400: the batch can't succeed, so it is dropped rather than retried forever.
    now += 60_000;
    endpoint.setStatus(400);
    await service.drain();
    expect(outboxRows(db)).toEqual([]);

    // A batch failing every time is given up after OUTBOX_MAX_ATTEMPTS.
    endpoint.setStatus(429);
    service.record("review_failed");
    for (let attempt = 0; attempt < OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      now += 2 * 60 * 60 * 1000;
      await service.drain();
    }
    expect(outboxRows(db)).toEqual([]);
  });

  it("applies the queue's size and age limits", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint("offline");
    let now = T0;
    const service = makeService({ db, fetchImpl: endpoint.fetchImpl, now: () => now });
    service.start();
    service.record("review_started");
    now += OUTBOX_MAX_AGE_MS + 1;
    service.record("review_completed");
    await service.drain();
    expect(outboxRows(db).map((row) => row.event)).toEqual(["review_completed"]);

    const insert = db.prepare(
      "INSERT INTO telemetry_outbox (uuid, event, occurred_at, payload_json) VALUES (?, 'x', ?, '{}')"
    );
    for (let index = 0; index < OUTBOX_MAX_EVENTS + 5; index += 1)
      insert.run(`bulk-${index}`, now - 1_000 + index);
    await service.drain();
    expect(db.prepare("SELECT COUNT(*) AS n FROM telemetry_outbox").get()).toEqual({
      n: OUTBOX_MAX_EVENTS
    });
  });
});

describe("TelemetryService collection controls", () => {
  it("records nothing until the user opts in", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint();
    const service = makeService({ db, fetchImpl: endpoint.fetchImpl, consent: () => false });
    service.start();
    service.record("review_started");
    service.markActive("study");
    service.milestone("engine_ready");
    await service.drain();
    expect(outboxRows(db)).toEqual([]);
    expect(endpoint.fetchImpl).not.toHaveBeenCalled();
    expect(service.gameRef("game-1")).toBeNull();
  });

  it("turning it off stops collection and deletes events not sent yet", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint("offline");
    let consent = true;
    const service = makeService({ db, fetchImpl: endpoint.fetchImpl, consent: () => consent });
    service.start();
    service.record("review_started");
    service.record("review_completed");
    expect(outboxRows(db)).toHaveLength(2);

    consent = false;
    service.refreshConsent();
    expect(outboxRows(db)).toEqual([]);
    service.record("review_started");
    expect(outboxRows(db)).toEqual([]);
    expect(service.status()).toMatchObject({ available: true, enabled: false, pending: 0 });

    // Turned on again later: collection resumes, nothing old comes back.
    consent = true;
    service.refreshConsent();
    service.record("review_opened");
    expect(outboxRows(db).map((row) => row.event)).toEqual(["review_opened"]);
  });

  it("a hard disable (or no project) purges what an earlier run queued and never sends", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint();
    const earlier = makeService({ db, fetchImpl: fakeEndpoint("offline").fetchImpl });
    earlier.start();
    earlier.record("review_started");
    expect(outboxRows(db)).toHaveLength(1);

    const disabled = makeService({
      db,
      fetchImpl: endpoint.fetchImpl,
      config: { available: false, reason: "disabled_by_environment", project: null }
    });
    disabled.start();
    disabled.record("review_completed");
    await disabled.drain();
    expect(outboxRows(db)).toEqual([]);
    expect(endpoint.fetchImpl).not.toHaveBeenCalled();
    expect(disabled.status()).toMatchObject({
      available: false,
      reason: "disabled_by_environment"
    });
  });
});

describe("TelemetryService opt-out deletion", () => {
  it("a failed deletion is retried, and collection doesn't resume until it succeeds", async () => {
    const db = telemetryDatabase();
    let failDeletes = true;
    const flaky = {
      prepare: (sql: string) => db.prepare(sql),
      exec: (sql: string) => {
        if (failDeletes && sql.startsWith("DELETE")) throw new Error("SQLITE_BUSY");
        return db.exec(sql);
      }
    } as unknown as typeof db;
    const endpoint = fakeEndpoint();
    let consent = true;
    const service = makeService({ db, database: () => flaky, fetchImpl: endpoint.fetchImpl, consent: () => consent, log: () => undefined });
    service.start();
    service.record("review_started");

    consent = false;
    service.refreshConsent();
    expect(outboxRows(db)).toHaveLength(1);
    // Turned on again while the deletion still fails: stays off, the old event isn't sent.
    consent = true;
    service.refreshConsent();
    expect(service.enabled).toBe(false);
    await service.drain();
    expect(endpoint.fetchImpl).not.toHaveBeenCalled();

    failDeletes = false;
    service.refreshConsent();
    expect(outboxRows(db)).toEqual([]);
    expect(service.enabled).toBe(true);
  });
});

describe("TelemetryService counting helpers", () => {
  it("counts a day as active once (UTC), and each milestone once per installation", () => {
    const db = telemetryDatabase();
    let now = Date.UTC(2026, 9, 2, 23, 59);
    const service = makeService({ db, now: () => now });
    service.start();
    service.markActive("study");
    service.markActive("play");
    service.milestone("review_completed");
    service.milestone("review_completed");
    now = Date.UTC(2026, 9, 3, 0, 1);
    service.markActive("study");
    const rows = db
      .prepare("SELECT event, payload_json FROM telemetry_outbox ORDER BY occurred_at")
      .all() as {
      event: string;
      payload_json: string;
    }[];
    expect(
      rows.map((row) => [
        row.event,
        JSON.parse(row.payload_json).utc_day ?? JSON.parse(row.payload_json).milestone
      ])
    ).toEqual([
      ["user_active", "2026-10-02"],
      ["activation_milestone", "review_completed"],
      ["user_active", "2026-10-03"]
    ]);
  });

  it("a day or milestone whose event couldn't be queued is recorded on the next try", () => {
    const db = telemetryDatabase();
    let failInserts = true;
    const flaky = {
      prepare: (sql: string) => {
        if (failInserts && sql.startsWith("INSERT OR IGNORE INTO telemetry_outbox")) throw new Error("SQLITE_FULL");
        return db.prepare(sql);
      },
      exec: (sql: string) => db.exec(sql)
    } as unknown as typeof db;
    const service = makeService({ db, database: () => flaky, now: () => T0, log: () => undefined });
    service.start();
    service.markActive("study");
    service.milestone("engine_ready");
    expect(outboxRows(db)).toEqual([]);
    failInserts = false;
    service.markActive("study");
    service.milestone("engine_ready");
    expect(outboxRows(db).map((row) => row.event)).toEqual(["user_active", "activation_milestone"]);
  });

  it("derives a stable game pseudonym that isn't the library id", () => {
    const db = telemetryDatabase();
    const service = makeService({ db });
    service.start();
    const ref = service.gameRef("game-1");
    expect(ref).toMatch(/^[0-9a-f]{32}$/);
    expect(ref).not.toContain("game-1");
    expect(service.gameRef("game-1")).toBe(ref);
    expect(service.gameRef("game-2")).not.toBe(ref);
    expect(makeService({ db: telemetryDatabase() }).gameRef("game-1")).toBeNull();
  });
});

describe("TelemetryService failure isolation and shutdown", () => {
  it("a broken database never throws into the app", async () => {
    const service = makeService({
      db: telemetryDatabase(),
      database: () => {
        throw new Error("SQLITE_BUSY");
      },
      log: () => undefined
    });
    expect(() => {
      service.start();
      service.record("review_started");
      service.markActive("study");
      service.milestone("engine_ready");
      service.gameRef("game-1");
    }).not.toThrow();
    await expect(service.drain()).resolves.toBeUndefined();
    expect(service.status().pending).toBe(0);
  });

  it("shutdown waits a bounded time for a hanging upload, then never touches the database again", async () => {
    const db = telemetryDatabase();
    let release: (() => void) | undefined;
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          release = () => resolve(new Response("{}", { status: 200 }));
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const service = makeService({ db, fetchImpl });
    service.start();
    service.record("review_started");
    void service.drain();
    const started = performance.now();
    await service.shutdown(30);
    expect(performance.now() - started).toBeLessThan(1_000);
    db.close();
    // Late callbacks and calls after shutdown are no-ops (a closed database would throw).
    release?.();
    expect(() => service.record("review_completed")).not.toThrow();
    await expect(service.drain()).resolves.toBeUndefined();
  });

  it("shutdown delivers what it can before the database closes", async () => {
    const db = telemetryDatabase();
    const endpoint = fakeEndpoint();
    const service = makeService({ db, fetchImpl: endpoint.fetchImpl, config: AVAILABLE });
    service.start();
    service.record("review_completed");
    await service.shutdown();
    expect(endpoint.events().map((event) => event.event)).toEqual(["review_completed"]);
    expect(outboxRows(db)).toEqual([]);
  });
});
