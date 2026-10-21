import type { EngineConfig } from "../types/engine";

/**
 * Name suffix of engine rows the desktop app creates for managed downloads (Stockfish / Maia
 * from their latest GitHub releases). The engines table has no separate flag: the registry sync
 * finds its own rows by this suffix and never touches user-added UCI engines.
 */
export const MANAGED_ENGINE_SUFFIX = "(managed)";

/**
 * Maia 1's managed rows, one per rating ("Maia 1500 (managed)", Lc0 on a Maia network), which
 * Maia 3 replaced; the rating is the first group.
 */
export const MAIA1_MANAGED_NAME = /^Maia (1100|1300|1500|1700|1900) \(managed\)$/;

/** True for an engine row the app manages from a download, false for a user-added UCI engine. */
export function isManagedEngine(engine: Pick<EngineConfig, "name">): boolean {
  return engine.name.includes(MANAGED_ENGINE_SUFFIX);
}

/**
 * An engine's name as the UI shows it: the "(managed)" suffix is an internal marker, never shown
 * ("Stockfish (managed)" → "Stockfish"). Also cleans player names saved by older builds.
 */
export function engineDisplayName(name: string): string {
  return name.replace(/\s*\(managed\)\s*/g, " ").trim();
}
