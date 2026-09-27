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
 * Where the engine setup stands, for the Engines step, Home and Game review:
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

/** Rating presets on the "Your level" step (the exact number can still be typed). */
export const LEVEL_PRESETS = [
  { rating: 800, label: "Beginner" },
  { rating: 1200, label: "Casual" },
  { rating: 1500, label: "Club player" },
  { rating: 1800, label: "Strong club" },
  { rating: 2100, label: "Expert" }
] as const;

/** The preset a rating falls into (nearest), so a typed rating still highlights one. */
export function nearestLevelPreset(rating: number): (typeof LEVEL_PRESETS)[number] {
  return LEVEL_PRESETS.reduce((best, preset) =>
    Math.abs(preset.rating - rating) < Math.abs(best.rating - rating) ? preset : best
  );
}

/** Clamp for the rating field (the review settings use the same bounds). */
export function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 1500;
  return Math.round(Math.max(400, Math.min(3500, value)));
}
