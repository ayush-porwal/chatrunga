import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pngBytes } from "../__fixtures__/picture-bytes";
import { engineImagesDir, engineImageStore, storedEngineImage } from "./engine-images";

describe("engine pictures", () => {
  let root: string;
  let store: ReturnType<typeof engineImageStore>;

  function picture(name: string, contents: string | Buffer = "png bytes"): string {
    mkdirSync(join(root, "pictures"), { recursive: true });
    const path = join(root, "pictures", name);
    writeFileSync(path, typeof contents === "string" ? pngBytes(contents) : contents);
    return path;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chaturanga-engine-images-"));
    store = engineImageStore(engineImagesDir(root), vi.fn());
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

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
});
