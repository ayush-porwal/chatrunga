import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { pickDefaultEngine } from "../game-review/review-engine-picker";

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
 * The engine live analysis runs: the one the user chose while it's still installed and usable,
 * else the default among the usable engines. Null when none is usable (analysis says so).
 */
export function analysisEngineFor(
  engines: readonly EngineConfig[] | undefined,
  chosen: string | null
): string | null {
  const usable = engines?.filter((engine) => engine.isAvailable) ?? [];
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
 * chosen one, else the automatic pick. Null when that one can't run or only predicts human moves.
 */
export function reviewEngineFor(
  engines: readonly EngineConfig[] | undefined,
  defaultEngineId: string | null
): EngineConfig | null {
  const engine = defaultEngineId
    ? engines?.find((item) => item.id === defaultEngineId)
    : pickDefaultEngine(engines ?? []);
  return engine?.isAvailable && !engine.isHumanPrediction ? engine : null;
}
