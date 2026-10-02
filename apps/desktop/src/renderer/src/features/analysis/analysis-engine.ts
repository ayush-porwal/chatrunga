import type { EngineConfig } from "@chaturanga/shared/types/engine";

/** The engine new analysis falls back to: the default one, else the first. */
export function defaultEngineFor(engines: readonly EngineConfig[] | undefined): string | null {
  return engines?.find((engine) => engine.isDefault)?.id ?? engines?.[0]?.id ?? null;
}

/**
 * The engine live analysis runs: the one the user chose for analysis while it's still installed
 * and usable, else the default engine.
 */
export function analysisEngineFor(engines: readonly EngineConfig[] | undefined, chosen: string | null): string | null {
  const usable = chosen ? engines?.find((engine) => engine.id === chosen && engine.isAvailable) : undefined;
  return usable?.id ?? defaultEngineFor(engines);
}
