import type {
  PracticeSessionSnapshot,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import type { PracticePreset } from "./practice-setup";

/**
 * Where the practice page's last start stands (a spinner while starting). Only the newest start
 * (`request`) may settle it, so a late answer to an earlier start never replaces a newer one.
 */
export type PracticeStart =
  | { status: "idle" }
  | { status: "starting"; request: number; input: StartPracticeInput }
  /** The start found nothing to practise for `input`. */
  | { status: "empty"; input: StartPracticeInput }
  | { status: "failed"; input: StartPracticeInput; message: string };

export const IDLE_START: PracticeStart = { status: "idle" };

/** How a start ended, as the main process answered it. */
export type StartOutcome =
  | { kind: "answered"; snapshot: PracticeSessionSnapshot }
  | { kind: "failed"; message: string };

/** A new start (the newest one from now on). */
export function beginStart(request: number, input: StartPracticeInput): PracticeStart {
  return { status: "starting", request, input };
}

/**
 * The state after start `request` ended: unchanged when a newer start (or none) is running, idle
 * once a session with cards started, else empty or failed with the start's input.
 */
export function settleStart(
  state: PracticeStart,
  request: number,
  outcome: StartOutcome
): PracticeStart {
  if (state.status !== "starting" || state.request !== request) return state;
  if (outcome.kind === "failed") {
    return { status: "failed", input: state.input, message: outcome.message };
  }
  return outcome.snapshot.cards.length ? IDLE_START : { status: "empty", input: state.input };
}

/** What the practice page shows: the session its route names, or the navigation (preset) it starts. */
export type PracticeShowing = { sessionId: string | null; preset: PracticePreset | null };

/**
 * Whether a start's answer may still rename the page to its session: the page still shows the
 * session-less navigation that asked for it. Back / Forward reuse the page for another history
 * entry, so being mounted isn't enough.
 */
export function answerStillShown(asked: PracticeShowing, shown: PracticeShowing): boolean {
  return shown.sessionId === null && asked.sessionId === null && shown.preset === asked.preset;
}

/** A targeted queue ("Refresh this decision", "Retry missed") that came back empty. */
export function isEmptyTargetedStart(state: PracticeStart): boolean {
  return state.status === "empty" && Boolean(state.input.positionKeys?.length);
}

/**
 * Starts keyed by the navigation that asked for them (its preset object, which the history entry
 * carries back): each runs once. A page shown again for the same navigation (Back / Forward, a
 * remount) gets that start's answer (`reused`) instead of starting another session, and a start
 * still waiting for its answer is `pending`, so a repeated Practice click doesn't start another.
 */
export class NavigationStarts<K extends object, T> {
  private readonly starts = new WeakMap<K, { answer: Promise<T>; pending: boolean }>();

  run(key: K, start: () => Promise<T>): { answer: Promise<T>; reused: boolean } {
    const known = this.starts.get(key);
    if (known) return { answer: known.answer, reused: true };
    const entry = { answer: start(), pending: true };
    this.starts.set(key, entry);
    const settled = () => {
      entry.pending = false;
    };
    entry.answer.then(settled, settled);
    return { answer: entry.answer, reused: false };
  }

  pending(key: K): boolean {
    return this.starts.get(key)?.pending ?? false;
  }
}

/** Practice's auto-starts, by the navigation's preset (see NavigationStarts). */
export const practiceAutoStarts = new NavigationStarts<PracticePreset, PracticeSessionSnapshot>();
