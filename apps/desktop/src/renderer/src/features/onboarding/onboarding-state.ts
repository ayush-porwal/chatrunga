import { isManagedEngine, MANAGED_ENGINE_SUFFIX } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { SetupRow } from "@/lib/engine-assets";
import { pickDefaultEngine } from "../game-review/review-engine-picker";

/**
 * localStorage flag of the earlier welcome dialog ("I'll use my own engines"). A user who set it
 * has seen a welcome already; it is carried over into `onboardingCompletedAt` once.
 */
export const LEGACY_WELCOME_DISMISSED_KEY = "chaturanga.welcome.dismissed";

/**
 * Whether the welcome opens by itself: saved settings have loaded (until then they are
 * defaults, which would flash it for everyone), it was never finished or skipped, and the
 * earlier welcome wasn't dismissed. Installs that predate the welcome have `completedAt: 0`.
 */
export function shouldShowOnboarding(input: {
  settingsLoaded: boolean;
  completedAt: number | null;
  legacyDismissed: boolean;
}): boolean {
  return input.settingsLoaded && input.completedAt === null && !input.legacyDismissed;
}

export const ONBOARDING_STEPS = ["welcome", "engines", "level", "coach", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingStepLabels: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  engines: "Engines",
  level: "Your level",
  coach: "AI coach",
  done: "All set"
};

export function stepOffset(step: OnboardingStep, offset: 1 | -1): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step) + offset;
  return ONBOARDING_STEPS[Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, index))];
}

/** A usable evaluation engine (what Game review runs), as the review runner would pick it. */
export function evaluationEngine(
  engines: readonly EngineConfig[] | undefined
): EngineConfig | null {
  const engine = pickDefaultEngine(engines ?? []);
  return engine?.isAvailable && !engine.isHumanPrediction ? engine : null;
}

/**
 * Where the engine setup stands, for the Engines step, Play and Game review:
 * - `checking`: status not loaded yet
 * - `ready`: an evaluation engine is usable (nothing else is being downloaded)
 * - `downloading`: first-run downloads are running
 * - `failed`: a first-run download failed and none is running
 * - `missing`: no evaluation engine and nothing downloading
 */
export type EngineSetupPhase = "checking" | "ready" | "downloading" | "failed" | "missing";

export function engineSetupPhase(input: {
  statusLoaded: boolean;
  engineReady: boolean;
  running: boolean;
  rows: readonly SetupRow[];
}): EngineSetupPhase {
  if (input.running) return "downloading";
  if (input.rows.some((row) => row.status === "error")) return "failed";
  if (input.engineReady) return "ready";
  if (!input.statusLoaded) return "checking";
  return "missing";
}

/** Rating presets on the "Your level" step. */
export const LEVEL_PRESETS = [
  { rating: 800, label: "Beginner" },
  { rating: 1200, label: "Casual" },
  { rating: 1500, label: "Club" },
  { rating: 1800, label: "Strong" },
  { rating: 2100, label: "Expert" }
] as const;

/** The preset a rating falls into (nearest), so a rating set elsewhere still highlights one. */
export function nearestLevelPreset(rating: number): (typeof LEVEL_PRESETS)[number] {
  return LEVEL_PRESETS.reduce((best, preset) =>
    Math.abs(preset.rating - rating) < Math.abs(best.rating - rating) ? preset : best
  );
}

/** The summary's level line: "1500 · Club · White" (the preset named only when it is exact). */
export function levelSummary(rating: number, side: "white" | "black"): string {
  const preset = nearestLevelPreset(rating);
  const sideLabel = side === "black" ? "Black" : "White";
  return preset.rating === rating
    ? `${rating} · ${preset.label} · ${sideLabel}`
    : `${rating} · ${sideLabel}`;
}

/* ------------------------------------------------------------------ engines */

/** How the setup list names each row, and what the engine is for. */
export const ENGINE_ROW_NAMES: Record<SetupRow["key"], { name: string; purpose: string }> = {
  stockfish: { name: "Stockfish", purpose: "Best moves" },
  maia: { name: "Maia", purpose: "Human moves" },
  lc0: { name: "Lc0", purpose: "Neural network" }
};

/**
 * A failed download's reason in a few words, from the main process's error message (network
 * errors, GitHub's rate limit, a full disk, a damaged file); anything else is just "Didn't download".
 */
const FAILURE_REASONS: readonly (readonly [RegExp, string])[] = [
  [
    /fetch failed|unreachable|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|timed? ?out|network/i,
    "No connection"
  ],
  [/rate limit/i, "Busy, try later"],
  [/ENOSPC/i, "Disk is full"],
  [/sha256 mismatch|download incomplete|byte range/i, "Download damaged"],
  [/EACCES|EPERM|EBUSY/i, "Couldn’t install"],
  [/install it yourself/i, "No download here"]
];

export function downloadFailureReason(message: string | undefined): string {
  return FAILURE_REASONS.find(([pattern]) => pattern.test(message ?? ""))?.[1] ?? "Didn’t download";
}

/** Whole-number percentage of everything the setup downloads (0 before sizes are known). */
export function downloadPercent(rows: readonly SetupRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.bytesTotal, 0);
  const received = rows.reduce((sum, row) => sum + row.bytesReceived, 0);
  return total ? Math.min(100, Math.round((received / total) * 100)) : 0;
}

/**
 * An engine that already runs Game review, as the setup list shows it: the app's own Stockfish or
 * Lc0 by name and purpose, an engine the user added by name and path.
 */
export function readyEngineRow(engine: Pick<EngineConfig, "name" | "executablePath">): {
  name: string;
  detail: string;
} {
  const managed = ` ${MANAGED_ENGINE_SUFFIX}`;
  if (!engine.name.endsWith(managed)) return { name: engine.name, detail: engine.executablePath };
  const name = engine.name.slice(0, -managed.length);
  const row = Object.values(ENGINE_ROW_NAMES).find((entry) => entry.name === name);
  return { name, detail: (row ?? ENGINE_ROW_NAMES.stockfish).purpose };
}

/**
 * The evaluation engine to list above the setup rows: one that already works (the user's own,
 * or an installed Stockfish or Lc0) when the list has no Stockfish row, nor a row of its own.
 */
export function listedReadyEngine<T extends EngineConfig>(
  rows: readonly SetupRow[],
  engine: T | null
): T | null {
  if (!engine) return null;
  // Only the app's own engine has a row of its own; the user's "Lc0" is theirs to list.
  const name = isManagedEngine(engine) ? readyEngineRow(engine).name : null;
  const listed = rows.some(
    (row) => row.key === "stockfish" || ENGINE_ROW_NAMES[row.key].name === name
  );
  return listed ? null : engine;
}

/**
 * What the Engines step shows: placeholders while checking, a band when the check failed and
 * nothing works yet, a note when there is nothing to download here, or the list.
 */
export type EnginesView = "checking" | "check-failed" | "none" | "list";

export function enginesView(input: {
  statusLoaded: boolean;
  statusFailed: boolean;
  rows: readonly SetupRow[];
  engine: EngineConfig | null;
}): EnginesView {
  if (!input.statusLoaded) return "checking";
  if (input.rows.length || input.engine) return "list";
  return input.statusFailed ? "check-failed" : "none";
}

/**
 * A progress ring's value circle for `percent` (clamped to 0–100): one dash as long as the whole
 * circumference, offset by the part still to go.
 */
export function progressRingDash(
  percent: number,
  radius: number
): { circumference: number; offset: number } {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return { circumference, offset: circumference * (1 - clamped / 100) };
}

/** "Stockfish", "Stockfish and Maia", "A, B and C". */
function joinNames(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

/** The summary's Engines line, and the one thing it offers. */
export type EngineSummary =
  | { tone: "busy"; text: string; percent: number }
  | { tone: "done"; text: string }
  | { tone: "failed"; text: string; retry: SetupRow }
  | { tone: "failed"; text: string; recheck: true }
  | { tone: "skipped"; text: string; download: boolean };

export function engineSummary(input: {
  phase: EngineSetupPhase;
  rows: readonly SetupRow[];
  engine: EngineConfig | null;
  statusFailed: boolean;
  offer: boolean;
}): EngineSummary {
  const { phase, rows } = input;
  if (phase === "downloading") {
    return { tone: "busy", text: "Downloading", percent: downloadPercent(rows) };
  }
  const failed = rows.find((row) => row.status === "error");
  if (failed) {
    return {
      tone: "failed",
      text: `${ENGINE_ROW_NAMES[failed.key].name} didn’t download`,
      retry: failed
    };
  }
  if (phase === "ready") {
    const listed = listedReadyEngine(rows, input.engine);
    const names = [
      ...(listed ? [readyEngineRow(listed).name] : []),
      ...rows.filter((row) => row.status === "ready").map((row) => ENGINE_ROW_NAMES[row.key].name)
    ];
    return { tone: "done", text: joinNames(names) };
  }
  if (phase === "checking") return { tone: "skipped", text: "Checking…", download: false };
  if (input.statusFailed) return { tone: "failed", text: "Couldn’t check", recheck: true };
  return { tone: "skipped", text: "Skipped", download: input.offer };
}
