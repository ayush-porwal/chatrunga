import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptStoredEngineImages,
  ENGINE_IMAGE_MAX_BYTES,
  engineImagesDir,
  engineImageStore,
  storedEngineImage
} from "./engine-images";

type Row = { id: string; imagePath: string | null };

describe("engine pictures", () => {
  let root: string;
  let dir: string;
  let store: ReturnType<typeof engineImageStore>;

  function picture(name: string, contents: string | Buffer = "png bytes"): string {
    mkdirSync(join(root, "pictures"), { recursive: true });
    const path = join(root, "pictures", name);
    writeFileSync(path, contents);
    return path;
  }

  const copies = () => readdirSync(dir).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chaturanga-engine-images-"));
    dir = engineImagesDir(root);
    store = engineImageStore(dir, vi.fn());
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("copies", () => {
    it("copies a picture into the folder, named for the engine and its contents", async () => {
      const source = picture("Logo.PNG");
      const copy = await store.adopt("engine-1", source);
      expect(basename(copy)).toMatch(/^engine-1-[0-9a-f]{16}\.png$/);
      expect(readFileSync(copy, "utf8")).toBe("png bytes");
      // The same picture again is the same file; the folder's own copy is kept as it is.
      await expect(store.adopt("engine-1", picture("again.png"))).resolves.toBe(copy);
      await expect(store.adopt("engine-1", copy)).resolves.toBe(copy);
      expect(copies()).toStrictEqual([basename(copy)]);
      expect(readFileSync(source, "utf8")).toBe("png bytes");
    });

    it("refuses files that aren't pictures, are too large, or aren't there", async () => {
      await expect(store.adopt("e", picture("notes.txt"))).rejects.toThrow(/PNG, JPG/);
      await expect(
        store.adopt("e", picture("huge.png", Buffer.alloc(ENGINE_IMAGE_MAX_BYTES + 1)))
      ).rejects.toThrow(/larger than 5 MB/);
      await expect(store.adopt("e", join(root, "gone.png"))).rejects.toThrow(/wasn't found/);
      mkdirSync(join(root, "folder.png"));
      await expect(store.adopt("e", join(root, "folder.png"))).rejects.toThrow(/wasn't found/);
      await expect(store.adopt("../e", picture("a.png"))).rejects.toThrow(/engine id/);
    });

    it("deletes an engine's other copies, and only that engine's", async () => {
      const first = await store.adopt("engine-1", picture("a.png", "a"));
      const second = await store.adopt("engine-1", picture("b.png", "b"));
      const other = await store.adopt("engine-1-x", picture("c.png", "c"));
      writeFileSync(join(dir, "engine-1-notes.png"), "not a copy");
      await store.prune("engine-1", second);
      expect(copies()).toStrictEqual(
        [basename(second), basename(other), "engine-1-notes.png"].sort()
      );
      expect(copies()).not.toContain(basename(first));
      // Removing the engine deletes the rest of its copies.
      await store.prune("engine-1", null);
      expect(copies()).toStrictEqual([basename(other), "engine-1-notes.png"].sort());
    });

    it("saves the same picture twice at once onto one file", async () => {
      const [first, second] = await Promise.all([
        store.adopt("e", picture("a.png", "same")),
        store.adopt("e", picture("b.png", "same"))
      ]);
      expect(first).toBe(second);
      expect(readFileSync(first, "utf8")).toBe("same");
      expect(copies()).toStrictEqual([basename(first)]);
    });

    it("queues each engine's picture work, and runs other engines' alongside", async () => {
      const order: string[] = [];
      let release = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = store.exclusive("e", async () => {
        await blocked;
        order.push("first");
        throw new Error("first failed");
      });
      const second = store.exclusive("e", async () => {
        order.push("second");
        return "second";
      });
      await store.exclusive("other", async () => {
        order.push("other");
      });
      release();
      await expect(first).rejects.toThrow(/first failed/);
      await expect(second).resolves.toBe("second");
      expect(order).toStrictEqual(["other", "first", "second"]);
    });

    it("prunes nothing, quietly, before the folder exists", async () => {
      const warn = vi.fn();
      await engineImageStore(join(root, "missing"), warn).prune("e", null);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("storedEngineImage", () => {
    it("copies a new picture, keeps the one already stored, and clears on null", async () => {
      const copy = await storedEngineImage(store, "e", picture("a.png"), null);
      expect(copy).toMatch(/engine-images/);
      await expect(storedEngineImage(store, "e", undefined, null)).resolves.toBeUndefined();
      await expect(storedEngineImage(store, "e", null, "/old.png")).resolves.toBeNull();
      // The stored value asked for again is kept, even when its file has gone.
      const gone = join(root, "moved.png");
      const storedAsUrl = pathToFileURL(gone).href;
      await expect(storedEngineImage(store, "e", gone, storedAsUrl)).resolves.toBe(storedAsUrl);
      await expect(storedEngineImage(store, "e", gone, null)).rejects.toThrow(/wasn't found/);
    });
  });

  describe("adoptStoredEngineImages", () => {
    /** `beforeReplace` runs first: a change the user makes while a picture is being copied. */
    function table(rows: Row[], beforeReplace: () => void = vi.fn()) {
      return {
        list: () => rows,
        replaceImagePath: (id: string, from: string, to: string | null) => {
          beforeReplace();
          const row = rows.find((entry) => entry.id === id);
          if (row?.imagePath !== from) return false;
          row.imagePath = to;
          return true;
        }
      };
    }

    it("copies local pictures, writes out data: ones, clears web ones, keeps missing files", async () => {
      const local = picture("local.png");
      const rows: Row[] = [
        { id: "local", imagePath: local },
        { id: "url", imagePath: pathToFileURL(picture("url.svg", "<svg/>")).href },
        { id: "data", imagePath: "data:image/png;base64,aGVsbG8=" },
        { id: "svg", imagePath: "data:image/svg+xml,%3Csvg%2F%3E" },
        { id: "jpg", imagePath: "data:image/jpg;base64,aGVsbG8=" },
        { id: "ico", imagePath: "data:image/x-icon;base64,aGVsbG8=" },
        { id: "web", imagePath: "https://example.com/logo.png" },
        { id: "missing", imagePath: join(root, "unmounted.png") },
        { id: "none", imagePath: null }
      ];
      const warn = vi.fn();
      await expect(adoptStoredEngineImages(store, table(rows), warn)).resolves.toBe(7);
      const stored = Object.fromEntries(rows.map((row) => [row.id, row.imagePath]));
      expect(stored.local).toMatch(/engine-images\/local-[0-9a-f]{16}\.png$/);
      expect(stored.url).toMatch(/engine-images\/url-[0-9a-f]{16}\.svg$/);
      expect(readFileSync(String(stored.data), "utf8")).toBe("hello");
      expect(readFileSync(String(stored.svg), "utf8")).toBe("<svg/>");
      expect(stored.jpg).toMatch(/\.jpg$/);
      expect(stored.ico).toMatch(/\.ico$/);
      expect(stored.web).toBeNull();
      expect(stored.missing).toBe(join(root, "unmounted.png"));
      expect(stored.none).toBeNull();
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        "keeping engine missing's picture where it is",
        expect.any(Error)
      );
      // The original stays where it was; a second run has nothing to do.
      expect(readFileSync(local, "utf8")).toBe("png bytes");
      await expect(adoptStoredEngineImages(store, table(rows), vi.fn())).resolves.toBe(0);
    });

    it("keeps data: pictures it can't copy, as it keeps missing files", async () => {
      const oversized = `data:image/png;base64,${Buffer.alloc(ENGINE_IMAGE_MAX_BYTES + 1).toString("base64")}`;
      const kept = [
        { id: "tiff", imagePath: "data:image/tiff;base64,aGVsbG8=" },
        { id: "huge", imagePath: oversized },
        { id: "damaged", imagePath: "data:image/png;base64,***" },
        { id: "badly-encoded", imagePath: "data:image/svg+xml,%E0%A4%A" },
        { id: "empty", imagePath: "data:image/png;base64," }
      ];
      const rows: Row[] = kept.map((row) => ({ ...row }));
      const warn = vi.fn();
      await expect(adoptStoredEngineImages(store, table(rows), warn)).resolves.toBe(0);
      expect(rows).toStrictEqual(kept);
      expect(warn).toHaveBeenCalledTimes(kept.length);
    });

    it("waits for an edit of the engine under way, and adopts what it stored", async () => {
      const row: Row = { id: "e", imagePath: picture("old.png", "old") };
      let release = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      // An edit has copied its picture but not stored it yet.
      const edit = store.exclusive("e", async () => {
        const copy = await store.adopt("e", picture("new.png", "new"));
        await blocked;
        row.imagePath = copy;
        await store.prune("e", copy);
        return copy;
      });
      const migration = adoptStoredEngineImages(store, table([row]), vi.fn());
      release();
      const copy = await edit;
      await expect(migration).resolves.toBe(0);
      expect(row.imagePath).toBe(copy);
      expect(copies()).toStrictEqual([basename(copy)]);
    });

    it("leaves a picture the user changed meanwhile, and drops the copy made for it", async () => {
      const row: Row = { id: "e", imagePath: picture("old.png") };
      const engines = table([row], () => {
        row.imagePath = null;
      });
      await expect(adoptStoredEngineImages(store, engines, vi.fn())).resolves.toBe(0);
      expect(row.imagePath).toBeNull();
      expect(copies()).toStrictEqual([]);
    });
  });
});
