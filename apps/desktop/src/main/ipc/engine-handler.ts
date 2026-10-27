import { app, ipcMain } from "electron";
import { nanoid } from "nanoid";
import { engineRepository, retryOnceIfBusy } from "../db/repositories";
import {
  engineImagesDir,
  engineImageStore,
  storedEngineImage,
  type EngineImageStore
} from "../engine/engine-images";
import { errorMessage, logger } from "../logger";
import { noteEngineReadiness } from "../telemetry/engine-readiness";
import { broadcast } from "./broadcast";
import { parseEngineInput, parseEnginePatch } from "./validate";
import { asId } from "./fields";
import type { EngineConfig, UpdateEngineInput } from "@chaturanga/shared/types/engine";

/** Where engine pictures are copied (see engine-images.ts). */
export function engineImages(): EngineImageStore {
  return engineImageStore(engineImagesDir(app.getPath("userData")), (message, error) =>
    logger.warn("engine-images", `${message}:`, errorMessage(error))
  );
}

/**
 * Adding, editing and removing engines. These writes (like the settings and game ones) get one
 * more try when another connection holds the write lock past the busy timeout: a repertoire import
 * or backup restore. Each change is announced, so views already showing the engines (Play) read
 * them again, and `onChanged` is told (main's own listeners: the puzzle generation queue).
 *
 * A new picture is copied into the app's data before the write (a picture that can't be copied
 * fails the change); copies the engine no longer uses are deleted after it.
 */
export function registerEngineCrudIpc(onChanged: () => void): void {
  ipcMain.handle("engines:create", async (_event, input: unknown) => {
    const parsed = parseEngineInput(input);
    const id = nanoid();
    const images = engineImages();
    const imagePath = await storedEngineImage(images, id, parsed.imagePath, null);
    let engine;
    try {
      engine = await retryOnceIfBusy(() => engineRepository.create({ ...parsed, imagePath }, id));
    } catch (error) {
      await images.prune(id, null);
      throw error;
    }
    noteEngineReadiness(false);
    broadcast("engines:changed", undefined);
    onChanged();
    return engine;
  });
  ipcMain.handle("engines:update", async (_event, id: unknown, patch: unknown) => {
    const engineId = asId(id, "engine id");
    const parsed = parseEnginePatch(patch);
    const engine =
      parsed.imagePath === undefined
        ? await retryOnceIfBusy(() => engineRepository.update(engineId, parsed))
        : await updateWithPicture(engineImages(), engineId, parsed);
    noteEngineReadiness(false);
    broadcast("engines:changed", undefined);
    onChanged();
    return engine;
  });
  ipcMain.handle("engines:remove", async (_event, id: unknown) => {
    const engineId = asId(id, "engine id");
    const images = engineImages();
    await images.exclusive(engineId, async () => {
      await retryOnceIfBusy(() => engineRepository.remove(engineId));
      await images.prune(engineId, null);
    });
    broadcast("engines:changed", undefined);
    onChanged();
  });
}

/**
 * An edit that sets the picture: copies it, writes the engine, then deletes the copies it no
 * longer uses. Queued behind other picture work for the engine (see `exclusive`).
 */
function updateWithPicture(
  images: EngineImageStore,
  engineId: string,
  patch: UpdateEngineInput
): Promise<EngineConfig> {
  return images.exclusive(engineId, async () => {
    const current = engineRepository.get(engineId)?.imagePath ?? null;
    const imagePath = await storedEngineImage(images, engineId, patch.imagePath, current);
    let engine: EngineConfig;
    try {
      engine = await retryOnceIfBusy(() =>
        engineRepository.update(engineId, { ...patch, imagePath })
      );
    } catch (error) {
      await images.prune(engineId, current);
      throw error;
    }
    await images.prune(engineId, engine.imagePath);
    return engine;
  });
}
