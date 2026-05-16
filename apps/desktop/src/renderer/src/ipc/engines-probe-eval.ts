import type { EngineScore, ProbeEvalInput } from "@chaturanga/shared/types/engine";

/**
 * Calls `engines:probeEval` via preload. Prefer `enginesProbeEval` on `window.chaturanga`
 * because nested `engines.probeEval` can be missing when an outdated preload bundle is still loaded.
 */
export async function invokeEnginesProbeEval(input: ProbeEvalInput): Promise<EngineScore | null> {
  const api = window.chaturanga;
  if (!api) throw new Error("Engine evaluation requires the desktop app.");
  const root = api.enginesProbeEval;
  if (typeof root === "function") {
    return root(input);
  }
  const nested = api.engines.probeEval;
  if (typeof nested === "function") {
    return nested(input);
  }
  throw new Error(
    "Draw evaluation is unavailable: this window is using an old preload script. Fully quit Chaturanga (Cmd+Q / Alt+F4), then run `pnpm dev` again so `out/preload/index.js` rebuilds."
  );
}
