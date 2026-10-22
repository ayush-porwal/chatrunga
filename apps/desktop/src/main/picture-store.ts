import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { hasImageExtension } from "./security";

/**
 * Pictures the app keeps a copy of, one folder per kind (engine pictures in
 * `<userData>/engine-images`, your picture in `<userData>/profile-pictures`), so moving or deleting
 * an original doesn't break them. A copy is named `<owner>-<content hash><ext>`: one owner's files
 * (an engine's, or "upload" for your own photo) are told apart from another's by name alone, and
 * the same picture saved again lands on the same file. Only files named for an owner are ever
 * deleted, and only inside the folder.
 */
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
const HASH_LENGTH = 16;
/** `<owner>-<hash><ext>`: the owner is everything before the last `-`. */
const MANAGED_NAME = new RegExp(`^(.+)-[0-9a-f]{${HASH_LENGTH}}(\\.[a-z0-9]+)$`);
/** Owners are nanoids, the app's own managed ids or fixed names: safe in a file name. */
const SAFE_OWNER = /^[\w-]{1,64}$/;

export type PictureStore = ReturnType<typeof pictureStore>;

/**
 * The picture work running for each owner (keyed by folder and owner). A change copies a picture,
 * stores it and then deletes the copies it no longer uses; run side by side, one change's clean-up
 * could delete the copy the other is about to store. So they queue.
 */
const pictureWork = new Map<string, Promise<unknown>>();
/** Distinguishes the files saves write before renaming them into place. */
let partialFiles = 0;

/**
 * `noun` names the picture in errors ("The engine picture is larger than 5 MB."); `warn` hears
 * about clean-ups that failed (they never fail the change that asked for them).
 */
export function pictureStore(
  dir: string,
  { noun, warn }: { noun: string; warn: (message: string, error: unknown) => void }
) {
  /** The owner `path` is a copy for, if it is a file of this folder. */
  function ownerOf(path: string): string | null {
    if (dirname(path) !== dir) return null;
    return MANAGED_NAME.exec(basename(path))?.[1] ?? null;
  }

  function checkSize(bytes: number): void {
    if (bytes > PICTURE_MAX_BYTES) throw new Error(`The ${noun} is larger than 5 MB.`);
  }

  return {
    dir,
    ownerOf,

    /** Runs `work` once the picture work already running for this owner has finished. */
    exclusive<T>(owner: string, work: () => Promise<T>): Promise<T> {
      const key = `${dir}\0${owner}`;
      // The queued tail never rejects (see below), so `work` runs whatever came before.
      const result = (pictureWork.get(key) ?? Promise.resolve()).then(() => work());
      const tail = result.catch(() => undefined);
      pictureWork.set(key, tail);
      // Nothing left queued for this owner: forget it.
      void tail.then(() => {
        if (pictureWork.get(key) === tail) pictureWork.delete(key);
      });
      return result;
    },

    /**
     * The stored path for `source` (an absolute path) as `owner`'s picture: a copy in the folder.
     * Rejects anything that isn't an image file of at most 5 MB.
     */
    async adopt(owner: string, source: string): Promise<string> {
      if (ownerOf(source) === owner) return source;
      if (!isAbsolute(source)) throw new Error(`The ${noun} must be a file on this computer.`);
      if (!hasImageExtension(source))
        throw new Error(`The ${noun} must be a PNG, JPG, WebP, GIF or SVG file.`);
      const info = await stat(source).catch(() => null);
      if (!info?.isFile()) throw new Error(`The ${noun} ${basename(source)} wasn't found.`);
      checkSize(info.size);
      const contents = await readFile(source);
      // A PNG, JPEG, GIF or WebP must be one inside (any of them: a browser shows a mislabelled one).
      // SVG and the rarer types go by their extension, as they always have.
      if (/\.(png|jpe?g|gif|webp)$/i.test(source)) {
        const { rasterType } = await import("./picture-bytes");
        if (!rasterType(contents))
          throw new Error(
            `The ${noun} ${basename(source)} isn't really a PNG, JPG, WebP or GIF file.`
          );
      }
      // Its size is checked again by `write`: the file could have grown since `stat`.
      return this.write(owner, contents, extname(source));
    },

    /**
     * Stores `contents` (a picture of type `extension`, e.g. ".png") as `owner`'s picture: a copy
     * in the folder. Rejects an empty, oversized or non-image one.
     */
    async write(owner: string, contents: Buffer, extension: string): Promise<string> {
      if (!SAFE_OWNER.test(owner)) throw new Error("Invalid picture owner.");
      if (!hasImageExtension(extension)) throw new Error(`Unsupported ${noun} type.`);
      if (!contents.length) throw new Error(`The ${noun} is empty.`);
      checkSize(contents.length);
      const hash = createHash("sha256").update(contents).digest("hex").slice(0, HASH_LENGTH);
      const target = join(dir, `${owner}-${hash}${extension.toLowerCase()}`);
      if (await isFile(target)) return target;
      await mkdir(dir, { recursive: true });
      // Written aside and renamed into place: a copy cut short never takes the final name. Each
      // save has its own partial file (two saves of the same picture may run at once).
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
    },

    /** Deletes `owner`'s copies other than `keep` (all of them when `keep` is null). */
    async prune(owner: string, keep: string | null): Promise<void> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (!isMissing(error)) warn(`listing ${dir} failed`, error);
        return;
      }
      for (const name of names) {
        const path = join(dir, name);
        if (path === keep || ownerOf(path) !== owner) continue;
        await unlink(path).catch((error: unknown) => {
          if (!isMissing(error)) warn(`deleting ${name} failed`, error);
        });
      }
    }
  };
}

/** Whether `path` is a file (not a folder, not missing). */
export async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
