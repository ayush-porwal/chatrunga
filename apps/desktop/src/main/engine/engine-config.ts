import { BUNDLED_STOCKFISH_ID } from "@chaturanga/shared/engine/bundled";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { engineRepository } from "../db/repositories";
import { listBundledEngines } from "./bundled-engines";

export function engineConfigForId(id: string): EngineConfig | null {
  if (id === BUNDLED_STOCKFISH_ID) {
    return listBundledEngines()[0] ?? null;
  }
  return engineRepository.get(id);
}
