import { ipcMain } from "electron";
import { engineRepository, retryOnceIfBusy } from "../db/repositories";
import { noteEngineReadiness } from "../telemetry/engine-readiness";
import { broadcast } from "./broadcast";
import { parseEngineInput, parseEnginePatch } from "./validate";
import { asId } from "./fields";

/**
 * Adding, editing and removing engines. These writes (like the settings and game ones) get one
 * more try when another connection holds the write lock past the busy timeout: a repertoire import
 * or backup restore. Each change is announced, so views already showing the engines (Play) read
 * them again.
 */
export function registerEngineCrudIpc(): void {
  ipcMain.handle("engines:create", async (_event, input: unknown) => {
    const parsed = parseEngineInput(input);
    const engine = await retryOnceIfBusy(() => engineRepository.create(parsed));
    noteEngineReadiness(false);
    broadcast("engines:changed", undefined);
    return engine;
  });
  ipcMain.handle("engines:update", async (_event, id: unknown, patch: unknown) => {
    const engineId = asId(id, "engine id");
    const parsed = parseEnginePatch(patch);
    const engine = await retryOnceIfBusy(() => engineRepository.update(engineId, parsed));
    noteEngineReadiness(false);
    broadcast("engines:changed", undefined);
    return engine;
  });
  ipcMain.handle("engines:remove", async (_event, id: unknown) => {
    const engineId = asId(id, "engine id");
    await retryOnceIfBusy(() => engineRepository.remove(engineId));
    broadcast("engines:changed", undefined);
  });
}
