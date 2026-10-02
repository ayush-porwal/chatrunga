import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";

/** How far live analysis searches, for the panel header: `depth 24`, `10 s per move`; null when it runs until stopped. */
export function analysisLimitLabel(settings: Pick<AppSettings, "analysisLimit" | "analysisDepth" | "analysisTimeSec">): string | null {
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
export function analysisEngineFor(engines: readonly EngineConfig[] | undefined, chosen: string | null): string | null {
  const usable = engines?.filter((engine) => engine.isAvailable) ?? [];
  return usable.find((engine) => engine.id === chosen)?.id ?? defaultEngineFor(usable);
}
