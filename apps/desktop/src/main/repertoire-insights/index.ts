/**
 * Repertoire Insights for the rest of main: the comparer and its report (runtime.ts) load after
 * startup, out of the main bundle; this starts them, hands them to the IPC handlers, forwards game
 * changes and stops them on quit.
 */
import type { GameSource } from "@chaturanga/shared/types/chess";
import { logger } from "../logger";

type InsightsRuntime = typeof import("./runtime");

let runtime: Promise<InsightsRuntime> | null = null;

/** The comparer's module, loaded and started once (the first call is app start). */
export function repertoireInsights(): Promise<InsightsRuntime> {
  runtime ??= import("./runtime").then((module) => {
    module.startRepertoireInsights();
    return module;
  });
  return runtime;
}

/** App start: loads the comparer, which makes its first pass. */
export function startRepertoireInsights(): void {
  repertoireInsights().catch((error: unknown) =>
    logger.error("repertoire-insights", "loading failed:", error)
  );
}

/**
 * Games were saved, synced or removed: compared again once the changes settle. Nothing before the
 * comparer starts (its first pass reads every game). `source`: a saved game's.
 */
export function insightsGamesChanged(source?: GameSource): void {
  // A failed load was logged by startRepertoireInsights.
  void runtime?.then(
    (module) => module.insightsGamesChanged(source),
    () => undefined
  );
}

/** Quitting: the pass stops after the chunk being written (nothing when it never started). */
export async function stopRepertoireInsights(): Promise<void> {
  const module = await runtime?.catch(() => null);
  await module?.stopRepertoireInsights();
}
