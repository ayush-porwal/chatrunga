import { availableParallelism } from "node:os";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { resolveEngineThreads, type AppSettings } from "@chaturanga/shared/types/settings";
import { engineRepository, settingsRepository } from "../db/repositories";

export function engineConfigForId(id: string): EngineConfig | null {
  return engineRepository.get(id);
}

/** Every spawnable engine: managed downloads and user-added UCI engines, all in the engines table. */
export function listAllEngines(): EngineConfig[] {
  return engineRepository.list();
}

/** UCI Threads / Hash for evaluation engines, from settings (null threads = auto). */
export function engineResourceOptions(
  settings: Pick<AppSettings, "engineThreads" | "engineHashMb"> = settingsRepository.getAll()
): { threads: number; hashMb: number } {
  return {
    threads: resolveEngineThreads(settings.engineThreads, availableParallelism()),
    hashMb: settings.engineHashMb
  };
}
