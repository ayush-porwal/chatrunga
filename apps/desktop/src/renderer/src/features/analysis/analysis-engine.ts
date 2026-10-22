import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { pickDefaultEngine } from "../game-review/review-engine-picker";
import { isMaiaEngine } from "../play/engine-game";

/** How far live analysis searches, for the panel header: `depth 24`, `10 s per move`; null when it runs until stopped. */
export function analysisLimitLabel(
  settings: Pick<AppSettings, "analysisLimit" | "analysisDepth" | "analysisTimeSec">
): string | null {
  if (settings.analysisLimit === "depth") return `depth ${settings.analysisDepth}`;
  if (settings.analysisLimit === "time") return `${settings.analysisTimeSec} s per move`;
  return null;
}

/** The engine new analysis falls back to: the default one, else the first. */
export function defaultEngineFor(engines: readonly EngineConfig[] | undefined): string | null {
  return engines?.find((engine) => engine.isDefault)?.id ?? engines?.[0]?.id ?? null;
}

/**
 * An engine that analyses: not Maia (Maia 3 has no search; a Maia network only predicts human
 * moves). Whether it can run now is `isAvailable`.
 */
export function isAnalysisEngine(
  engine: Pick<EngineConfig, "runtime" | "isHumanPrediction">
): boolean {
  return !isMaiaEngine(engine) && !engine.isHumanPrediction;
}

/** An engine live analysis can run now: one that analyses, and available. */
export function canAnalyse(
  engine: Pick<EngineConfig, "isAvailable" | "runtime" | "isHumanPrediction">
): boolean {
  return engine.isAvailable && isAnalysisEngine(engine);
}

/**
 * The engine live analysis runs: the one the user chose while it's still installed and can analyse,
 * else the default among those. Null when none can (analysis says so).
 */
export function analysisEngineFor(
  engines: readonly EngineConfig[] | undefined,
  chosen: string | null
): string | null {
  const usable = engines?.filter(canAnalyse) ?? [];
  return usable.find((engine) => engine.id === chosen)?.id ?? defaultEngineFor(usable);
}

/**
 * The engine the Moves tab's engine row and Study's engine header name: an engine game's opponent
 * (`activeEngineId`) while the board is one, else the analysis engine as chosen now
 * ({@link analysisEngineFor}) whether analysis runs, is paused, off or has nothing to search, so
 * a change in Analysis settings shows at once rather than when the next search starts.
 */
export function rowEngine({
  engines,
  settings,
  activeEngineId,
  engineGame
}: {
  engines: readonly EngineConfig[] | undefined;
  settings: Pick<AppSettings, "analysisEngineId">;
  /** The engine the last search ran on: an engine game's opponent. */
  activeEngineId: string | null;
  /** The board is an engine game (played or decided): its opponent's search is the one shown. */
  engineGame: boolean;
}): EngineConfig | null {
  const engineId = engineGame
    ? activeEngineId
    : analysisEngineFor(engines, settings.analysisEngineId);
  return engines?.find((engine) => engine.id === engineId) ?? null;
}

/**
 * The engine that reviews a game and explains a puzzle (Review settings' evaluation engine): the
 * chosen one while it can run, else the default engine. Never one that only predicts human moves;
 * null when no engine can review.
 */
export function reviewEngineFor(
  engines: readonly EngineConfig[] | undefined,
  defaultEngineId: string | null
): EngineConfig | null {
  const usable = engines?.filter((engine) => engine.isAvailable && !engine.isHumanPrediction) ?? [];
  return usable.find((engine) => engine.id === defaultEngineId) ?? pickDefaultEngine(usable);
}
