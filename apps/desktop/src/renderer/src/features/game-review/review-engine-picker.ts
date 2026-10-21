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
