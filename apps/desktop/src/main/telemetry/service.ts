import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TelemetryActivityKind, TelemetryStatus } from "@chaturanga/shared/types/telemetry";
import type { TelemetryConfig } from "./config";
import { OUTBOX_MAX_ATTEMPTS, TelemetryOutbox, TelemetryState, type OutboxEvent } from "./outbox";
import { deliverBatch, type FetchLike } from "./transport";

/** Every event the app records (docs/telemetry.md defines each one). */
export type TelemetryEventName =
  | "user_active"
  | "activation_milestone"
  | "game_imported"
  | "review_started"
  | "review_completed"
  | "review_failed"
  | "review_cancelled"
  | "review_opened"
  | "review_studied"
  | "commentary_requested"
  | "commentary_provider_attempt"
  | "commentary_completed"
  | "commentary_failed"
  | "commentary_viewed"
  | "commentary_session_started";

/** Allowlisted, content-free values only; `undefined` means unknown and is left out. */
export type TelemetryProperties = Record<string, string | number | boolean | null | undefined>;

export type ActivationMilestone =
  | "engine_ready"
  | "game_imported"
  | "review_completed"
  | "review_studied"
  | "commentary_viewed";

const SCHEMA_VERSION = 1;
const BATCH_SIZE = 50;
/** Batches per drain at most; the rest wait for the next one. */
const MAX_BATCHES_PER_DRAIN = 10;
/** A recorded event is sent after this pause (more events join the batch meanwhile). */
const DRAIN_DEBOUNCE_MS = 5_000;
const DRAIN_INTERVAL_MS = 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60 * 1000;
export const SHUTDOWN_DRAIN_MS = 1_500;

export type TelemetryDeps = {
  config: TelemetryConfig;
  database: () => DatabaseSync;
  /** The user's choice (the `usageAnalyticsEnabled` setting). */
  consent: () => boolean;
  fetchImpl: FetchLike;
  appVersion: string;
  platform: string;
  arch: string;
  now?: () => number;
  random?: () => number;
  /** Failures are logged here (codes only; never payloads). */
  log?: (message: string, error?: unknown) => void;
};

/**
 * Usage analytics, owned by the main process. Recording is a local SQLite insert, never awaited on
 * the network; delivery runs in the background, one drain at a time. Every public method contains
 * its own failures: analytics can't fail a review, commentary or shutdown.
 */
export class TelemetryService {
  private readonly outbox: TelemetryOutbox;
  private readonly state: TelemetryState;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sessionId = randomUUID();
  private readonly once = new Set<string>();
  private active = false;
  private closed = false;
  private draining: Promise<void> | null = null;
  private inFlight: AbortController | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private installationId: string | null = null;
  /** The outbox was emptied since collection last stopped (so it isn't purged on every check). */
  private purged = false;

  constructor(private readonly deps: TelemetryDeps) {
    this.outbox = new TelemetryOutbox(deps.database);
    this.state = new TelemetryState(deps.database);
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  /** Reads the user's choice and starts (or stops, deleting what wasn't sent) collection. */
  start(): void {
    this.refreshConsent();
  }

  /** The `usageAnalyticsEnabled` setting may have changed. */
  refreshConsent(): void {
    if (this.closed) return;
    const next = this.deps.config.available && this.consentGiven();
    if (next === this.active && (next || this.purged)) return;
    this.active = next;
    if (next) {
      this.purged = false;
      this.interval = setInterval(() => void this.drain(), DRAIN_INTERVAL_MS);
      this.interval.unref?.();
      this.scheduleDrain();
      return;
    }
    this.stopTimers();
    this.inFlight?.abort();
    this.guard("purging unsent events", () => this.outbox.purge());
    this.purged = true;
  }

  status(): TelemetryStatus {
    return {
      available: this.deps.config.available,
      reason: this.deps.config.reason,
      enabled: this.consentGiven(),
      pending: this.closed ? 0 : (this.guard("counting events", () => this.outbox.count()) ?? 0)
    };
  }

  /** Records `event` if collection is on. Never throws, never waits for the network. */
  record(event: TelemetryEventName, properties: TelemetryProperties = {}): void {
    if (!this.active || this.closed) return;
    this.guard(`recording ${event}`, () => {
      this.distinctId();
      this.outbox.add({
        uuid: randomUUID(),
        event,
        occurredAt: this.now(),
        properties: { ...definedOnly(properties), ...this.commonProperties() },
        attempts: 0
      });
      this.scheduleDrain();
    });
  }

  /**
   * Meaningful foreground use (DAU): `user_active` at most once per UTC day. Only user actions
   * call this — never background work, retries or update checks.
   */
  markActive(kind: TelemetryActivityKind): void {
    if (!this.active || this.closed) return;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    this.guard("marking activity", () => {
      if (this.state.get("last_active_day") === day) return;
      this.state.set("last_active_day", day);
      this.record("user_active", { kind, utc_day: day });
    });
  }

  /** An activation step, recorded once per installation (`existing`: found already done at startup). */
  milestone(name: ActivationMilestone, existing = false): void {
    if (!this.active || this.closed) return;
    this.guard(`milestone ${name}`, () => {
      const key = `milestone:${name}`;
      if (this.state.get(key)) return;
      this.state.set(key, new Date(this.now()).toISOString());
      this.record("activation_milestone", { milestone: name, existing });
    });
  }

  /** True the first time `key` is seen in this app session (once-per-session events). */
  firstInSession(key: string): boolean {
    if (this.once.has(key)) return false;
    this.once.add(key);
    return true;
  }

  /**
   * A per-installation pseudonym for a library game: stable across reopenings, not the local id
   * itself, and not linkable between installations. Null when there is no game id or no state.
   */
  gameRef(gameId: string | null | undefined): string | null {
    if (!gameId || !this.active || this.closed) return null;
    return (
      this.guard("deriving a game reference", () => {
        let key = this.state.get("game_ref_key");
        if (!key) {
          key = randomBytes(32).toString("hex");
          this.state.set("game_ref_key", key);
        }
        return createHmac("sha256", key).update(gameId).digest("hex").slice(0, 32);
      }) ?? null
    );
  }

  get enabled(): boolean {
    return this.active && !this.closed;
  }

  /** Sends due events now (serialized: a call during a drain joins it). */
  drain(): Promise<void> {
    if (!this.active || this.closed) return Promise.resolve();
    this.draining ??= this.drainBatches()
      .catch((error: unknown) => this.deps.log?.("telemetry drain failed", error))
      .finally(() => {
        this.draining = null;
      });
    return this.draining;
  }

  /**
   * Before the database closes: a short, bounded last delivery. What isn't sent by then stays in
   * the outbox for the next launch, and nothing touches the database afterwards.
   */
  async shutdown(timeoutMs = SHUTDOWN_DRAIN_MS): Promise<void> {
    if (this.closed) return;
    this.stopTimers();
    if (this.active) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.drain(),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
      ]);
      clearTimeout(timer);
    }
    this.closed = true;
    this.inFlight?.abort();
  }

  private async drainBatches(): Promise<void> {
    const project = this.deps.config.project;
    if (!project) return;
    const dropped = this.guard("pruning the outbox", () => this.outbox.prune(this.now())) ?? 0;
    if (dropped) this.deps.log?.(`telemetry dropped ${dropped} expired or excess event(s)`);
    const distinctId = this.distinctId();
    if (!distinctId) return;
    for (let batch = 0; batch < MAX_BATCHES_PER_DRAIN; batch += 1) {
      if (!this.active || this.closed) return;
      const events =
        this.guard("reading the outbox", () => this.outbox.due(this.now(), BATCH_SIZE)) ?? [];
      if (!events.length) return;
      this.inFlight = new AbortController();
      const result = await deliverBatch(
        project,
        distinctId,
        events,
        this.deps.fetchImpl,
        this.inFlight.signal
      );
      this.inFlight = null;
      // Shut down (or turned off, which purged the outbox) while the batch was out.
      if (!this.active || this.closed) return;
      const uuids = events.map((event) => event.uuid);
      if (result.outcome === "accepted") {
        this.guard("removing delivered events", () => this.outbox.remove(uuids));
        continue;
      }
      if (result.outcome === "rejected") {
        this.deps.log?.(
          `telemetry batch rejected (HTTP ${result.status}); dropped ${uuids.length} event(s)`
        );
        this.guard("removing rejected events", () => this.outbox.remove(uuids));
        continue;
      }
      this.retryLater(events);
      return;
    }
  }

  /** Exponential backoff with jitter; a batch failing too often is given up. */
  private retryLater(events: readonly OutboxEvent[]): void {
    const exhausted = events
      .filter((event) => event.attempts + 1 >= OUTBOX_MAX_ATTEMPTS)
      .map((event) => event.uuid);
    const retrying = events.filter((event) => event.attempts + 1 < OUTBOX_MAX_ATTEMPTS);
    const attempts = Math.max(0, ...retrying.map((event) => event.attempts));
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS) * (0.5 + this.random());
    this.guard("deferring events", () => {
      this.outbox.remove(exhausted);
      this.outbox.defer(
        retrying.map((event) => event.uuid),
        this.now() + Math.round(delay)
      );
    });
    if (exhausted.length)
      this.deps.log?.(`telemetry gave up on ${exhausted.length} event(s) after repeated failures`);
  }

  private scheduleDrain(): void {
    if (this.debounce || this.closed) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.drain();
    }, DRAIN_DEBOUNCE_MS);
    this.debounce.unref?.();
  }

  private stopTimers(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.interval) clearInterval(this.interval);
    this.debounce = null;
    this.interval = null;
  }

  /** The installation's random id (PostHog `distinct_id`), created the first time it's needed. */
  private distinctId(): string | null {
    if (this.installationId) return this.installationId;
    this.installationId =
      this.guard("reading the installation id", () => {
        const existing = this.state.get("installation_id");
        if (existing) return existing;
        const created = randomUUID();
        this.state.set("installation_id", created);
        return created;
      }) ?? null;
    return this.installationId;
  }

  private commonProperties(): TelemetryProperties {
    return {
      schema_version: SCHEMA_VERSION,
      session_id: this.sessionId,
      app_version: this.deps.appVersion,
      release_channel:
        this.deps.config.available && this.deps.config.development
          ? "development"
          : /-/.test(this.deps.appVersion)
            ? "beta"
            : "stable",
      platform: this.deps.platform,
      arch: this.deps.arch,
      $lib: "chaturanga-desktop",
      // Pseudonymous events: no person profiles, no location lookup from the sender's IP.
      $process_person_profile: false,
      $geoip_disable: true
    };
  }

  private consentGiven(): boolean {
    return this.guard("reading the analytics setting", () => this.deps.consent()) ?? false;
  }

  /** Runs `work`; a failure is logged and swallowed (analytics never breaks the app). */
  private guard<T>(what: string, work: () => T): T | undefined {
    try {
      return work();
    } catch (error) {
      this.deps.log?.(`telemetry: ${what} failed`, error);
      return undefined;
    }
  }
}

function definedOnly(properties: TelemetryProperties): TelemetryProperties {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}
