import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { canonicalImagePath } from "../image-access";
import { hasImageExtension } from "../security";

/**
 * Engine pictures the user picks are copied into `<userData>/engine-images`, so moving or deleting
 * the original doesn't break them. A copy is named `<engineId>-<content hash><ext>`: one engine's
 * files are told apart from another's by name alone, and the same picture saved again lands on the
 * same file. Only files named for an engine are ever deleted, and only inside this folder.
 */
const ENGINE_IMAGES_DIR_NAME = "engine-images";
export const ENGINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const HASH_LENGTH = 16;
/** `<engineId>-<hash><ext>`: the engine id is everything before the last `-`. */
const MANAGED_NAME = new RegExp(`^(.+)-[0-9a-f]{${HASH_LENGTH}}(\\.[a-z0-9]+)$`);
/** Engine ids are nanoids (or the app's own managed ids): safe in a file name. */
const SAFE_ENGINE_ID = /^[\w-]{1,64}$/;

export function engineImagesDir(userData: string): string {
  return join(userData, ENGINE_IMAGES_DIR_NAME);
}

export type EngineImageStore = ReturnType<typeof engineImageStore>;

/**
 * The picture work running for each engine (keyed by folder and engine id). A change copies a
 * picture, writes the engine and then deletes the copies it no longer uses; run side by side, one
 * change's clean-up could delete the copy the other is about to store. So they queue.
 */
const pictureWork = new Map<string, Promise<unknown>>();
/** Distinguishes the files saves write before renaming them into place. */
let partialFiles = 0;

/** `warn` hears about clean-ups that failed (they never fail the change that asked for them). */
export function engineImageStore(dir: string, warn: (message: string, error: unknown) => void) {
  /** The engine `path` is a copy for, if it is a file of this folder. */
  function ownerOf(path: string): string | null {
    if (dirname(path) !== dir) return null;
    return MANAGED_NAME.exec(basename(path))?.[1] ?? null;
  }

  async function save(engineId: string, contents: Buffer, extension: string): Promise<string> {
    if (!SAFE_ENGINE_ID.test(engineId)) throw new Error("Invalid engine id for a picture.");
    const hash = createHash("sha256").update(contents).digest("hex").slice(0, HASH_LENGTH);
    const target = join(dir, `${engineId}-${hash}${extension.toLowerCase()}`);
    if (await isFile(target)) return target;
    await mkdir(dir, { recursive: true });
    // Written aside and renamed into place: a copy cut short never takes the final name. Each save
    // has its own partial file (two saves of the same picture may run at once).
    const partial = `${target}.${process.pid}-${++partialFiles}.partial`;
    await writeFile(partial, contents);
    try {
      await rename(partial, target);
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      // Another save of the same picture got there first (Windows won't replace it).
      if (!(await isFile(target))) throw error;
    }
    return target;
  }

  return {
    dir,

    /** Runs `work` once the picture work already running for this engine has finished. */
    exclusive<T>(engineId: string, work: () => Promise<T>): Promise<T> {
      const key = `${dir}\0${engineId}`;
      // The queued tail never rejects (see below), so `work` runs whatever came before.
      const result = (pictureWork.get(key) ?? Promise.resolve()).then(() => work());
      const tail = result.catch(() => undefined);
      pictureWork.set(key, tail);
      // Nothing left queued for this engine: forget it.
      void tail.then(() => {
        if (pictureWork.get(key) === tail) pictureWork.delete(key);
      });
      return result;
    },

    /**
     * The stored path for `source` (an absolute path) as engine `engineId`'s picture: a copy in the
     * folder. Rejects anything that isn't an image file of at most 5 MB.
     */
    async adopt(engineId: string, source: string): Promise<string> {
      if (ownerOf(source) === engineId) return source;
      if (!isAbsolute(source))
        throw new Error("The engine picture must be a file on this computer.");
      if (!hasImageExtension(source))
        throw new Error("The engine picture must be a PNG, JPG, WebP, GIF or SVG file.");
      const info = await stat(source).catch(() => null);
      if (!info?.isFile()) throw new Error(`The engine picture ${basename(source)} wasn't found.`);
      if (info.size > ENGINE_IMAGE_MAX_BYTES)
        throw new Error("The engine picture is larger than 5 MB.");
      const contents = await readFile(source);
      // Checked again: the file could have grown since `stat`.
      if (contents.length > ENGINE_IMAGE_MAX_BYTES)
        throw new Error("The engine picture is larger than 5 MB.");
      return save(engineId, contents, extname(source));
    },

    /**
     * A `data:image/...` picture (older builds stored them) as a copy. Rejects one it can't read
     * back as a picture of at most 5 MB.
     */
    async adoptDataUrl(engineId: string, url: string): Promise<string> {
      const picture = decodeImageDataUrl(url);
      if (picture.contents.length > ENGINE_IMAGE_MAX_BYTES)
        throw new Error("The engine picture is larger than 5 MB.");
      return save(engineId, picture.contents, picture.extension);
    },

    /** Deletes engine `engineId`'s copies other than `keep` (all of them when `keep` is null). */
    async prune(engineId: string, keep: string | null): Promise<void> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (!isMissing(error)) warn(`listing ${dir} failed`, error);
        return;
      }
      for (const name of names) {
        const path = join(dir, name);
        if (path === keep || ownerOf(path) !== engineId) continue;
        await unlink(path).catch((error: unknown) => {
          if (!isMissing(error)) warn(`deleting ${name} failed`, error);
        });
      }
    }
  };
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

function decodeImageDataUrl(url: string): { contents: Buffer; extension: string } {
  const match = /^data:image\/([\w.+-]+)([^,]*),(.*)$/is.exec(url.trim());
  if (!match) throw new Error("The engine picture isn't an image data URL.");
  const extension = DATA_URL_EXTENSIONS[match[1].toLowerCase()];
  if (!extension) throw new Error(`Pictures of type image/${match[1]} aren't supported.`);
  const base64 = /;base64$/i.test(match[2]);
  if (base64 && !/^[A-Za-z0-9+/=\s]*$/.test(match[3]))
    throw new Error("The engine picture's data is damaged.");
  let contents: Buffer;
  try {
    contents = base64
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
  } catch (error) {
    throw new Error("The engine picture's data is damaged.", { cause: error });
  }
  if (!contents.length) throw new Error("The engine picture is empty.");
  return { contents, extension };
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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
  if (/^data:/i.test(stored)) return store.adoptDataUrl(engineId, stored);
  const path = canonicalImagePath(stored);
  if (!isAbsolute(path)) return null;
  return store.adopt(engineId, path);
}
