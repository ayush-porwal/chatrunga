/**
 * A book's page images, one folder per book (`<userData>/books/<bookId>`), each page stored
 * through the picture store as `p0001-<hash>.webp`. The bytes come from the renderer (it renders
 * the PDF), so they must really be a WebP, PNG or JPEG. The folders are served to the renderer
 * through the image protocol (image-access.ts) and deleted with their book.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pictureStore } from "../picture-store";
import { rasterType, type RasterType } from "../picture-bytes";

const SAFE_BOOK_ID = /^[\w-]{1,64}$/;
const EXTENSIONS: Partial<Record<RasterType, string>> = {
  "image/webp": ".webp",
  "image/png": ".png",
  "image/jpeg": ".jpg"
};

export type BookPageFiles = ReturnType<typeof bookPageFiles>;

/** Page files under `root` (`<userData>/books`). `warn` hears about clean-ups that failed. */
export function bookPageFiles(root: string, warn: (message: string, error: unknown) => void) {
  function folderOf(bookId: string): string {
    if (!SAFE_BOOK_ID.test(bookId)) throw new Error("Invalid book id.");
    return join(root, bookId);
  }

  return {
    folderOf,

    /** Stores page `pageIndex` (0-based) of the book; resolves with the file's path. */
    async save(bookId: string, pageIndex: number, bytes: Uint8Array): Promise<string> {
      const contents = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const type = rasterType(contents);
      const extension = type && EXTENSIONS[type];
      if (!extension) throw new Error("A book page must be a WebP, PNG or JPEG image.");
      const store = pictureStore(folderOf(bookId), { noun: "page image", warn });
      const owner = `p${String(pageIndex + 1).padStart(4, "0")}`;
      return store.exclusive(owner, async () => {
        const path = await store.write(owner, contents, extension);
        await store.prune(owner, path);
        return path;
      });
    },

    /** A stored page's bytes and type (for the vision model); null when the file is gone. */
    async read(bookId: string, path: string): Promise<{ bytes: Buffer; type: RasterType } | null> {
      if (dirname(path) !== folderOf(bookId)) return null;
      const bytes = await readFile(path).catch(() => null);
      const type = bytes && rasterType(bytes);
      return bytes && type ? { bytes, type } : null;
    },

    /** Deletes the book's folder. */
    async remove(bookId: string): Promise<void> {
      await rm(folderOf(bookId), { recursive: true, force: true });
    },

    /** Deletes the folders of books that no longer exist (their repertoire was deleted). */
    async sweep(bookIds: ReadonlySet<string>): Promise<number> {
      const names = await readdir(root).catch((): string[] => []);
      let removed = 0;
      for (const name of names) {
        if (bookIds.has(name) || !SAFE_BOOK_ID.test(name)) continue;
        try {
          await rm(join(root, name), { recursive: true, force: true });
          removed += 1;
        } catch (error) {
          warn(`deleting book pages ${name} failed`, error);
        }
      }
      return removed;
    }
  };
}
