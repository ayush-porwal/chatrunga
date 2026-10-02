import {
  TELEMETRY_SESSION_IDLE_MS,
  type TelemetryActivityKind,
  type TelemetryRendererEvent
} from "@chaturanga/shared/types/telemetry";

/**
 * The renderer's side of usage analytics (docs/telemetry.md): it reports a few interactions and
 * main decides what, if anything, is recorded. Nothing here reads page content; the only DOM
 * signals are "a key or pointer was pressed" and "the window is visible and focused".
 */

/**
 * Reports an interaction; never throws, never waits. Resolves whether it was recorded (false while
 * collection is off, or outside the desktop app).
 */
export function trackUsage(event: TelemetryRendererEvent): Promise<boolean> {
  const bridge = window.chaturanga?.telemetry;
  if (!bridge) return Promise.resolve(false);
  return bridge.track(event).catch(() => false);
}

/** The window is on screen and has focus. */
export function isForeground(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Input this recent makes a board change the user's own doing (not a restore or engine reply). */
export const USER_INPUT_WINDOW_MS = 4_000;

let lastUserInputAt = Number.NEGATIVE_INFINITY;
let inputListening = false;

/** Starts noting when the user last pressed a key or pointer (times only, never what or where). */
export function listenForUserInput(): void {
  if (inputListening || typeof window === "undefined") return;
  inputListening = true;
  const note = () => {
    lastUserInputAt = performance.now();
  };
  window.addEventListener("pointerdown", note, { capture: true, passive: true });
  window.addEventListener("keydown", note, { capture: true, passive: true });
}

export function hadRecentUserInput(now = performance.now()): boolean {
  return now - lastUserInputAt <= USER_INPUT_WINDOW_MS;
}

/** At most one activity report per kind in this interval (main counts a day once anyway). */
const ACTIVITY_REPORT_INTERVAL_MS = 10 * 60 * 1000;
const lastActivityReport = new Map<TelemetryActivityKind, number>();

/** Meaningful use: only right after user input, with the window in front. */
export function reportActivity(kind: TelemetryActivityKind, now = performance.now()): boolean {
  if (!isForeground() || !hadRecentUserInput(now)) return false;
  const last = lastActivityReport.get(kind);
  if (last !== undefined && now - last < ACTIVITY_REPORT_INTERVAL_MS) return false;
  lastActivityReport.set(kind, now);
  // Not recorded (collection off): the throttle isn't spent, so the first report after opting in
  // goes through.
  void trackUsage({ type: "activity", kind }).then((recorded) => {
    if (!recorded && lastActivityReport.get(kind) === now) lastActivityReport.delete(kind);
  });
  return true;
}

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const browserTimers: Timers = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number)
};

/**
 * Fires `onQualified(key)` once a key has stayed eligible (e.g. an explanation in view, window in
 * front) for `qualifyMs` without interruption. Changing the key or losing eligibility before then
 * cancels it, so a result that arrives after the user moved on is never counted as viewed. A key
 * that qualified doesn't again until something else was the candidate (coming back later is a new
 * view; main keeps the event to once per session).
 */
export class ViewQualifier {
  private pendingKey: string | null = null;
  private timer: unknown = null;
  /** The key that qualified last, while it is still the candidate. */
  private qualified: string | null = null;

  constructor(
    private readonly qualifyMs: number,
    private readonly onQualified: (key: string) => void,
    private readonly timers: Timers = browserTimers
  ) {}

  /** The current candidate: `key` null or `eligible` false means nothing is being viewed now. */
  update(key: string | null, eligible: boolean): void {
    if (key !== this.qualified || !eligible) this.qualified = null;
    const candidate = key && eligible && key !== this.qualified ? key : null;
    if (candidate === this.pendingKey) return;
    this.cancel();
    if (!candidate) return;
    this.pendingKey = candidate;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.pendingKey = null;
      this.qualified = candidate;
      this.onQualified(candidate);
    }, this.qualifyMs);
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.pendingKey = null;
  }
}

/**
 * Counts the distinct moves selected per review (by the user); `onStudied(reviewKey)` fires when
 * the count reaches `threshold`. Like a session, a count ends after `idleMs` without a selection:
 * coming back later needs `threshold` new selections and fires again (main keeps the event to
 * once per session).
 */
export class StudyCounter {
  private readonly reviews = new Map<
    string,
    { moves: Set<string>; lastAt: number; studied: boolean }
  >();

  constructor(
    private readonly threshold: number,
    private readonly onStudied: (reviewKey: string) => void,
    private readonly idleMs = TELEMETRY_SESSION_IDLE_MS
  ) {}

  select(reviewKey: string, moveKey: string, now = performance.now()): void {
    let review = this.reviews.get(reviewKey);
    if (!review || now - review.lastAt >= this.idleMs) {
      review = { moves: new Set(), lastAt: now, studied: false };
      this.reviews.set(reviewKey, review);
    }
    review.lastAt = now;
    if (review.studied) return;
    review.moves.add(moveKey);
    if (review.moves.size < this.threshold) return;
    review.studied = true;
    review.moves.clear();
    this.onStudied(reviewKey);
  }
}

/** A library id main accepts (it only ever stores a hash of it); anything else is left out. */
export function analyticsGameId(id: string | null | undefined): string | null {
  return id && id.length <= 200 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** A review operation id main accepts (a UUID); reviews saved before ids were kept have none. */
export function analyticsReviewId(id: string | null | undefined): string | null {
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}
