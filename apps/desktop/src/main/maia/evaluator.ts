/**
 * Maia 3's evaluator itself, loaded by maia/index.ts on the first request: CSSLab's model in its
 * hidden host window (maia-host.ts), closed after five idle minutes, or the e2e fixture
 * (fixture-evaluator.ts) with `CHATURANGA_E2E_MAIA3=fixture`.
 */
import type { Maia3Evaluator } from "@chaturanga/shared/engine/maia3";
import { FixtureMaia3Evaluator } from "./fixture-evaluator";
import { IdleClosingEvaluator } from "./idle-closing";
import { MaiaHost, type MaiaHostFiles } from "./maia-host";
import { maia3ModelPath, usesMaia3Fixture } from "./model-path";

/** The host window is closed after this long without a request (as the UCI engine is). */
const IDLE_HOST_MS = 5 * 60_000;

export function createMaia3Evaluator(hostFiles: MaiaHostFiles | null): Maia3Evaluator {
  if (usesMaia3Fixture()) return new FixtureMaia3Evaluator();
  if (!hostFiles) throw new Error("The Maia host isn't configured.");
  return new IdleClosingEvaluator(
    new MaiaHost({ ...hostFiles, modelPath: maia3ModelPath }),
    IDLE_HOST_MS
  );
}
