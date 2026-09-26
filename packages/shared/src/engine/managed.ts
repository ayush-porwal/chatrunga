import type { EngineConfig } from "../types/engine";

/**
 * Name suffix of engine rows the desktop app creates for managed downloads (Stockfish / Maia
 * from their latest GitHub releases). The engines table has no separate flag: the registry sync
 * finds its own rows by this suffix and never touches user-added UCI engines.
 */
export const MANAGED_ENGINE_SUFFIX = "(managed)";

/** True for an engine row the app manages from a download, false for a user-added UCI engine. */
export function isManagedEngine(engine: Pick<EngineConfig, "name">): boolean {
  return engine.name.includes(MANAGED_ENGINE_SUFFIX);
}
