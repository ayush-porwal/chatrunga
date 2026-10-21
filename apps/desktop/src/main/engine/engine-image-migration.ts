/**
 * Engine pictures saved before the app copied them into its data (see engine-images.ts). Loaded on
 * app open only (index.ts), so the main bundle doesn't carry it.
 */
import { isAbsolute } from "node:path";
import { canonicalImagePath } from "../image-access";
import type { EngineImageStore } from "./engine-images";

type StoredEngineImages = {
  list: () => ReadonlyArray<{ id: string; imagePath: string | null }>;
  /** Sets the picture if it is still `from` (the user may have changed it meanwhile). */
  replaceImagePath: (id: string, from: string, to: string | null) => boolean;
};

/**
 * Brings pictures saved before copies were made into the folder (run once per start; cheap when
 * there's nothing left to do). A local file is copied; a `data:` picture is written out; a web
 * address is cleared — the packaged app's CSP never let one load, the renderer ignores them, and
 * keeping one would make the engine's edit form refuse to save. A picture that can't be copied (a
 * file gone or on a drive not mounted now, a `data:` picture that is too large, damaged or of a type
 * the app doesn't serve) is left as it is and tried again next start. Each engine's step queues
 * behind any edit of it under way. Returns how many engines changed.
 */
export async function adoptStoredEngineImages(
  store: EngineImageStore,
  engines: StoredEngineImages,
  warn: (message: string, error: unknown) => void
): Promise<number> {
  const storedImage = (id: string) =>
    engines.list().find((engine) => engine.id === id)?.imagePath ?? null;
  let changed = 0;
  for (const { id } of engines.list()) {
    const replaced = await store.exclusive(id, async () => {
      // Read again in the queue: an edit that ran first may have changed it.
      const imagePath = storedImage(id);
      const stored = imagePath?.trim();
      if (!imagePath || !stored) return false;
      let next: string | null;
      try {
        next = await migratedImage(store, id, stored);
      } catch (error) {
        warn(`keeping engine ${id}'s picture where it is`, error);
        return false;
      }
      if (next === stored) return false;
      const done = engines.replaceImagePath(id, imagePath, next);
      await store.prune(id, storedImage(id));
      return done;
    });
    if (replaced) changed++;
  }
  return changed;
}

async function migratedImage(
  store: EngineImageStore,
  engineId: string,
  stored: string
): Promise<string | null> {
  if (/^data:/i.test(stored)) {
    const picture = decodeImageDataUrl(stored);
    return store.write(engineId, picture.contents, picture.extension);
  }
  const path = canonicalImagePath(stored);
  if (!isAbsolute(path)) return null;
  return store.adopt(engineId, path);
}

/** Image MIME subtypes, as the extensions the image protocol serves (see `hasImageExtension`). */
const DATA_URL_EXTENSIONS: Partial<Record<string, string>> = {
  png: ".png",
  apng: ".png",
  jpeg: ".jpg",
  jpg: ".jpg",
  pjpeg: ".jpg",
  gif: ".gif",
  webp: ".webp",
  "svg+xml": ".svg",
  bmp: ".bmp",
  "x-bmp": ".bmp",
  "x-ms-bmp": ".bmp",
  "x-icon": ".ico",
  "vnd.microsoft.icon": ".ico",
  avif: ".avif"
};

/** A `data:image/...` picture (older builds stored them): its bytes and file extension. */
function decodeImageDataUrl(url: string): { contents: Buffer; extension: string } {
  const match = /^data:image\/([\w.+-]+)([^,]*),(.*)$/is.exec(url.trim());
  if (!match) throw new Error("The engine picture isn't an image data URL.");
  const extension = DATA_URL_EXTENSIONS[match[1].toLowerCase()];
  if (!extension) throw new Error(`Pictures of type image/${match[1]} aren't supported.`);
  const base64 = /;base64$/i.test(match[2]);
  if (base64 && !/^[A-Za-z0-9+/=\s]*$/.test(match[3]))
    throw new Error("The engine picture's data is damaged.");
  try {
    return {
      contents: base64
        ? Buffer.from(match[3], "base64")
        : Buffer.from(decodeURIComponent(match[3]), "utf8"),
      extension
    };
  } catch (error) {
    throw new Error("The engine picture's data is damaged.", { cause: error });
  }
}
