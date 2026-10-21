import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pngBytes } from "./__fixtures__/picture-bytes";
import { PICTURE_MAX_BYTES, pictureStore } from "./picture-store";

describe("pictureStore", () => {
  let root: string;
  let dir: string;
  let store: ReturnType<typeof pictureStore>;

  /** A picture file: a PNG's bytes (`contents` after its signature), or `contents` as given. */
  function picture(name: string, contents: string | Buffer = "png bytes"): string {
    mkdirSync(join(root, "pictures"), { recursive: true });
    const path = join(root, "pictures", name);
    writeFileSync(path, typeof contents === "string" ? pngBytes(contents) : contents);
    return path;
  }

  const copies = () => readdirSync(dir).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chaturanga-engine-images-"));
    dir = join(root, "pictures-copied");
    store = pictureStore(dir, { noun: "engine picture", warn: vi.fn() });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("copies", () => {
    it("copies a picture into the folder, named for the engine and its contents", async () => {
      const source = picture("Logo.PNG");
      const copy = await store.adopt("engine-1", source);
      expect(basename(copy)).toMatch(/^engine-1-[0-9a-f]{16}\.png$/);
      expect(readFileSync(copy)).toStrictEqual(pngBytes("png bytes"));
      // The same picture again is the same file; the folder's own copy is kept as it is.
      await expect(store.adopt("engine-1", picture("again.png"))).resolves.toBe(copy);
      await expect(store.adopt("engine-1", copy)).resolves.toBe(copy);
      expect(copies()).toStrictEqual([basename(copy)]);
      expect(readFileSync(source)).toStrictEqual(pngBytes("png bytes"));
    });

    it("refuses files that aren't pictures, are too large, or aren't there", async () => {
      await expect(store.adopt("e", picture("notes.txt"))).rejects.toThrow(/PNG, JPG/);
      await expect(
        store.adopt("e", picture("huge.png", Buffer.alloc(PICTURE_MAX_BYTES + 1)))
      ).rejects.toThrow(/larger than 5 MB/);
      await expect(store.adopt("e", join(root, "gone.png"))).rejects.toThrow(/wasn't found/);
      mkdirSync(join(root, "folder.png"));
      await expect(store.adopt("e", join(root, "folder.png"))).rejects.toThrow(/wasn't found/);
      await expect(store.adopt("../e", picture("a.png"))).rejects.toThrow(/picture owner/);
    });

    it("refuses a file whose bytes aren't the picture its name says, but keeps SVGs as before", async () => {
      await expect(
        store.adopt("e", picture("notes.png", Buffer.from("just text")))
      ).rejects.toThrow("The engine picture notes.png isn't really a PNG, JPG, WebP or GIF file.");
      await expect(store.adopt("e", picture("empty.jpg", Buffer.alloc(0)))).rejects.toThrow(
        /isn't really a PNG/
      );
      // A real picture under another raster name is still one (a browser shows it).
      await expect(store.adopt("e", picture("photo.jpg", "a png really"))).resolves.toMatch(
        /\.jpg$/
      );
      // SVG (and the rarer types) go by their extension, as engine pictures always have.
      await expect(store.adopt("e", picture("logo.svg", Buffer.from("<svg/>")))).resolves.toMatch(
        /\.svg$/
      );
      await expect(store.adopt("e", picture("logo.ico", Buffer.from("ico")))).resolves.toMatch(
        /\.ico$/
      );
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
      expect(readFileSync(first)).toStrictEqual(pngBytes("same"));
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
      await pictureStore(join(root, "missing"), { noun: "picture", warn }).prune("e", null);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("downloaded pictures", () => {
    it("stores a picture's bytes for its owner, apart from other owners' in the folder", async () => {
      const avatar = await store.write("chesscom", Buffer.from("avatar"), ".PNG");
      expect(basename(avatar)).toMatch(/^chesscom-[0-9a-f]{16}\.png$/);
      expect(readFileSync(avatar, "utf8")).toBe("avatar");
      const upload = await store.adopt("upload", picture("me.webp", "me"));
      // Replacing one owner's picture leaves the others' alone.
      const next = await store.write("chesscom", Buffer.from("new avatar"), ".png");
      await store.prune("chesscom", next);
      expect(copies()).toStrictEqual([basename(next), basename(upload)].sort());
      await store.prune("upload", null);
      expect(copies()).toStrictEqual([basename(next)]);
    });

    it("refuses empty, oversized and non-image bytes, and names it in the error", async () => {
      const profile = pictureStore(dir, { noun: "picture", warn: vi.fn() });
      await expect(profile.write("upload", Buffer.alloc(0), ".png")).rejects.toThrow(
        "The picture is empty."
      );
      await expect(
        profile.write("upload", Buffer.alloc(PICTURE_MAX_BYTES + 1), ".png")
      ).rejects.toThrow("The picture is larger than 5 MB.");
      await expect(profile.write("upload", Buffer.from("x"), ".exe")).rejects.toThrow(/type/);
      await expect(profile.write("upload", Buffer.from("x"), "")).rejects.toThrow(/type/);
      await expect(profile.write("a/b", Buffer.from("x"), ".png")).rejects.toThrow(/owner/);
      expect(() => readdirSync(dir)).toThrow(/ENOENT/);
    });
  });
});
