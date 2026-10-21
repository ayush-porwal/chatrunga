import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pngBytes } from "../__fixtures__/picture-bytes";
import { PICTURE_MAX_BYTES } from "../picture-store";
import { adoptStoredEngineImages } from "./engine-image-migration";
import { engineImagesDir, engineImageStore } from "./engine-images";

type Row = { id: string; imagePath: string | null };

describe("adoptStoredEngineImages", () => {
  let root: string;
  let dir: string;
  let store: ReturnType<typeof engineImageStore>;

  function picture(name: string, contents: string | Buffer = "png bytes"): string {
    mkdirSync(join(root, "pictures"), { recursive: true });
    const path = join(root, "pictures", name);
    // A raster picture holds a PNG (the store checks); an SVG is written as it is.
    writeFileSync(path, name.endsWith(".svg") ? contents : pngBytes(String(contents)));
    return path;
  }

  const copies = () => readdirSync(dir).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chaturanga-engine-images-"));
    dir = engineImagesDir(root);
    store = engineImageStore(dir, vi.fn());
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

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
    expect(readFileSync(local)).toStrictEqual(pngBytes("png bytes"));
    await expect(adoptStoredEngineImages(store, table(rows), vi.fn())).resolves.toBe(0);
  });

  it("keeps data: pictures it can't copy, as it keeps missing files", async () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(PICTURE_MAX_BYTES + 1).toString("base64")}`;
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
