import type {
  PracticeSessionSnapshot,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";

/**
 * Where the practice page's last start stands. Only the newest start (`request`) may settle it,
 * so a late answer to an earlier start never replaces a newer one. `auto` marks a start the page
 * made on its own (a rehearsal or targeted queue from a preset), shown as a spinner; a start from
 * the setup form keeps the form on screen with its button busy.
 */
export type PracticeStart =
  | { status: "idle" }
  | { status: "starting"; request: number; auto: boolean; input: StartPracticeInput }
  /** The start found nothing to practise for `input`. */
  | { status: "empty"; input: StartPracticeInput }
  | { status: "failed"; input: StartPracticeInput; message: string };

export const IDLE_START: PracticeStart = { status: "idle" };

/** How a start ended, as the main process answered it. */
export type StartOutcome =
  | { kind: "answered"; snapshot: PracticeSessionSnapshot }
  | { kind: "failed"; message: string };

/** A new start (the newest one from now on). */
export function beginStart(
  request: number,
  input: StartPracticeInput,
  auto: boolean
): PracticeStart {
  return { status: "starting", request, auto, input };
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

/** The page shows its spinner instead of the setup: only while starting on its own. */
export function startShowsSpinner(state: PracticeStart): boolean {
  return state.status === "starting" && state.auto;
}

/** A targeted queue ("Refresh this decision", "Retry missed") that came back empty. */
export function isEmptyTargetedStart(state: PracticeStart): boolean {
  return state.status === "empty" && Boolean(state.input.positionKeys?.length);
}
