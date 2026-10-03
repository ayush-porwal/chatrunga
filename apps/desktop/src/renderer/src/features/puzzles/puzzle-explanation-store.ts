import { create } from "zustand";
import type { ExplainPuzzleInput, ExplainPuzzleResult } from "@chaturanga/shared/ipc/chaturanga-api";
import type { PuzzleOutcomeKind } from "@chaturanga/shared/schemas/puzzle-insight";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type {
  AnalysePositionsInput,
  AnalysePositionsResult,
  EngineConfig,
  PuzzleExplanation
} from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { usePuzzleStore, type PuzzleWrongMove } from "../../stores/puzzle-store";
import { buildPuzzleExplanationPayload, explainSearchPlan } from "./puzzle-explanation";

/**
 * The puzzle explanations of this session, by {@link explanationKey}: a finished one stays (opening
 * the puzzle card again, or switching panel tabs, never asks again), a running one carries on
 * while the card is hidden, and moving to another puzzle cancels what is still running for the
 * previous one.
 */

export type ExplainPhase = "analysing" | "writing" | "ready" | "error";

export type ExplainEntry = {
  phase: ExplainPhase;
  puzzleId: string;
  /** The running request's id (its engine search and provider call), null once it ended. */
  requestId: string | null;
  explanation: PuzzleExplanation | null;
  error: string | null;
  /** The error is fixed in the explanation settings (no usable evaluation engine). */
  needsSettings: boolean;
  /** Stops the running request (engine search and provider call). */
  cancel: (() => void) | null;
};

export const usePuzzleExplanationStore = create<{ entries: Record<string, ExplainEntry> }>(() => ({ entries: {} }));

/** What a request talks to: the desktop bridge, or a test double. */
export type ExplainDeps = {
  analysePositions: (input: AnalysePositionsInput) => Promise<AnalysePositionsResult>;
  explainPuzzle: (input: ExplainPuzzleInput) => Promise<ExplainPuzzleResult>;
  cancel: (requestId: string) => void;
  newId: () => string;
};

export type ExplainRequest = {
  key: string;
  puzzle: PuzzleSample;
  kind: PuzzleOutcomeKind;
  wrong: PuzzleWrongMove | null;
  /** The Game review evaluation engine (null: none usable). */
  engine: EngineConfig | null;
  settings: Pick<AppSettings, "reviewSearchTimeMs" | "reviewMultiPv" | "reviewPlayerRating" | "reviewCommentaryDetail">;
};

export const NO_ENGINE_ERROR = "Choose an evaluation engine in the explanation settings first.";
const THIN_FACTS_ERROR = "The engine didn't return enough about this puzzle to explain it. Try again, or give it more search time.";
const NO_ANSWER_ERROR = "OpenRouter didn't return an explanation for this puzzle.";
const REQUEST_ERROR = "The explanation couldn't be requested. Try again in a moment.";

function setEntry(key: string, entry: ExplainEntry | null): void {
  usePuzzleExplanationStore.setState((state) => {
    const entries = { ...state.entries };
    if (entry) entries[key] = entry;
    else delete entries[key];
    return { entries };
  });
}

function patchEntry(key: string, requestId: string, patch: Partial<ExplainEntry>): boolean {
  const current = usePuzzleExplanationStore.getState().entries[key];
  if (current?.requestId !== requestId) return false;
  setEntry(key, { ...current, ...patch });
  return true;
}

function desktopDeps(): ExplainDeps | null {
  const api = window.chaturanga;
  if (!api?.engines.analysePositions || !api.commentary.explainPuzzle) return null;
  return {
    analysePositions: (input) => api.engines.analysePositions(input),
    explainPuzzle: (input) => api.commentary.explainPuzzle(input),
    cancel: (requestId) => {
      void api.engines.cancelReview(requestId).catch(() => undefined);
      void api.commentary.cancelPuzzleExplanation(requestId).catch(() => undefined);
    },
    newId: () => crypto.randomUUID()
  };
}

/**
 * Explains a finished puzzle: the engine searches it with the Game review settings ("analysing"),
 * then the coach writes the explanation ("writing"). A request already running for the same key
 * is left to finish; a finished one is replaced (Regenerate).
 */
export async function requestPuzzleExplanation(request: ExplainRequest, deps: ExplainDeps | null = desktopDeps()): Promise<void> {
  const { key, puzzle } = request;
  const current = usePuzzleExplanationStore.getState().entries[key];
  if (current?.phase === "analysing" || current?.phase === "writing") return;
  const base = { puzzleId: puzzle.id, explanation: null, error: null, needsSettings: false, cancel: null };
  if (!deps) {
    setEntry(key, { ...base, phase: "error", requestId: null, error: "Explanations need the desktop app." });
    return;
  }
  if (!request.engine) {
    setEntry(key, { ...base, phase: "error", requestId: null, error: NO_ENGINE_ERROR, needsSettings: true });
    return;
  }
  watchActivePuzzle();
  const requestId = deps.newId();
  setEntry(key, { ...base, phase: "analysing", requestId, cancel: () => deps.cancel(requestId) });
  const fail = (error: string) => patchEntry(key, requestId, { phase: "error", requestId: null, error, cancel: null });

  const plan = explainSearchPlan(puzzle, request.wrong, request.settings.reviewMultiPv);
  let analysis: AnalysePositionsResult;
  try {
    analysis = await deps.analysePositions({
      requestId,
      engineId: request.engine.id,
      moveTimeMs: request.settings.reviewSearchTimeMs,
      positions: plan.positions
    });
  } catch (error) {
    fail(`The engine couldn't analyse this puzzle: ${ipcErrorMessage(error) || "it stopped unexpectedly"}.`);
    return;
  }
  const at = (index: number | null) => (index === null ? null : analysis.lines[index] ?? []);
  const payload = buildPuzzleExplanationPayload({
    puzzle,
    kind: request.kind,
    wrong: request.wrong,
    analysis: {
      engineName: analysis.engineName,
      start: at(plan.start) ?? [],
      beforeMistake: at(plan.beforeMistake),
      afterMistake: at(plan.afterMistake)
    },
    settings: request.settings
  });
  if (!payload) {
    fail(THIN_FACTS_ERROR);
    return;
  }
  if (!patchEntry(key, requestId, { phase: "writing" })) return;

  try {
    const answer = await deps.explainPuzzle({ requestId, payload });
    if (answer.cancelled) return;
    if (!answer.explanation) {
      fail(answer.error ?? NO_ANSWER_ERROR);
      return;
    }
    patchEntry(key, requestId, { phase: "ready", requestId: null, explanation: answer.explanation, cancel: null });
  } catch {
    fail(REQUEST_ERROR);
  }
}

/**
 * Cancels and forgets every running explanation that isn't for `puzzleId` (finished ones stay for
 * the session). A late answer of a cancelled request finds no entry and is dropped.
 */
export function cancelPuzzleExplanations(puzzleId: string | null): void {
  for (const [key, entry] of Object.entries(usePuzzleExplanationStore.getState().entries)) {
    if (entry.puzzleId === puzzleId || !entry.requestId) continue;
    entry.cancel?.();
    setEntry(key, null);
  }
}

let watching = false;

/** Moving to another puzzle (or leaving puzzles) cancels the previous puzzle's running request. */
function watchActivePuzzle(): void {
  if (watching) return;
  watching = true;
  usePuzzleStore.subscribe((state, previous) => {
    const id = state.activePuzzle?.id ?? null;
    if (id !== (previous.activePuzzle?.id ?? null)) cancelPuzzleExplanations(id);
  });
}

/** What the puzzle card shows for the explanation. */
export type ExplainView =
  | { kind: "idle"; disabled: boolean }
  | { kind: "off" }
  | { kind: "no-key" }
  | { kind: "analysing" }
  | { kind: "writing" }
  | { kind: "ready"; explanation: PuzzleExplanation }
  | { kind: "error"; message: string; needsSettings: boolean };

/**
 * Like review commentary: a running request shows its progress and a finished explanation stays
 * on screen even if commentary is later switched off or the key removed; otherwise switched-off
 * commentary and a missing key say so before anything can be asked.
 */
export function explainView(input: {
  entry: ExplainEntry | undefined;
  configReady: boolean;
  commentaryEnabled: boolean;
  hasApiKey: boolean;
}): ExplainView {
  const { entry } = input;
  if (entry?.phase === "analysing" || entry?.phase === "writing") return { kind: entry.phase };
  if (entry?.phase === "ready" && entry.explanation) return { kind: "ready", explanation: entry.explanation };
  if (!input.configReady) return { kind: "idle", disabled: true };
  if (!input.commentaryEnabled) return { kind: "off" };
  if (!input.hasApiKey) return { kind: "no-key" };
  if (entry?.phase === "error") return { kind: "error", message: entry.error ?? NO_ANSWER_ERROR, needsSettings: entry.needsSettings };
  return { kind: "idle", disabled: false };
}
