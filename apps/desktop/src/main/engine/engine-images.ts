import { join } from "node:path";
import { canonicalImagePath } from "../image-access";
import { pictureStore, type PictureStore } from "../picture-store";

/**
 * Engine pictures the user picks are copied into `<userData>/engine-images` (see picture-store.ts),
 * each named for its engine: `<engineId>-<content hash><ext>`.
 */
const ENGINE_IMAGES_DIR_NAME = "engine-images";

export function engineImagesDir(userData: string): string {
  return join(userData, ENGINE_IMAGES_DIR_NAME);
}

export type EngineImageStore = PictureStore;

/** `warn` hears about clean-ups that failed (they never fail the change that asked for them). */
export function engineImageStore(
  dir: string,
  warn: (message: string, error: unknown) => void
): EngineImageStore {
  return pictureStore(dir, { noun: "engine picture", warn });
}

/**
 * What an engine's picture is stored as after a change asks for `requested` (validated: an absolute
 * path, null to clear, undefined to leave it). The stored value asked for again (an edit that left
 * the picture alone) is kept as it is, even if its file has gone.
 */
export async function storedEngineImage(
  store: EngineImageStore,
  engineId: string,
  requested: string | null | undefined,
  current: string | null
): Promise<string | null | undefined> {
  if (requested === undefined || requested === null) return requested;
  if (current && canonicalImagePath(current) === requested) return current;
  return store.adopt(engineId, requested);
}
