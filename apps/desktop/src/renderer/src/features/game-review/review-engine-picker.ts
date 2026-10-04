import type { EngineConfig } from "@chaturanga/shared/types/engine";

export function pickDefaultEngine(engines: readonly EngineConfig[]): EngineConfig | null {
  if (!engines.length) return null;
  return (
    engines.find((engine) => engine.isDefault && !engine.isHumanPrediction) ??
    engines.find((engine) => !engine.isHumanPrediction && !engine.weightsPath) ??
    engines.find((engine) => !engine.isHumanPrediction) ??
    null
  );
}

/**
 * Maia engines with a known rating bucket. Main re-filters (availability,
 * one engine per rating, the `reviewMaiaLevels` setting), so this is a hint.
 */
export function pickMaiaEngines(engines: readonly EngineConfig[]): EngineConfig[] {
  return engines.filter((engine) => engine.isAvailable && Boolean(engine.maiaRating));
}
