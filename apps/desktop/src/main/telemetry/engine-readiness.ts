import { listAllEngines } from "../engine/engine-config";
import { getTelemetry } from ".";

/**
 * Activation step "engine ready": an available evaluation engine (not a Maia) exists. Checked at
 * startup (`existing`: it was set up before analytics saw it) and after engines change.
 */
export function noteEngineReadiness(existing: boolean): void {
  const telemetry = getTelemetry();
  if (!telemetry?.enabled) return;
  try {
    if (listAllEngines().some((engine) => engine.isAvailable && !engine.isHumanPrediction)) {
      telemetry.milestone("engine_ready", existing);
    }
  } catch {
    // Analytics only; an unreadable engine list is not this module's problem.
  }
}
