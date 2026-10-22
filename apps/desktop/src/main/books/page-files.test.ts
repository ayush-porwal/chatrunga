import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pngBytes } from "../__fixtures__/picture-bytes";
import { bookPageFiles } from "./page-files";

const root = mkdtempSync(join(tmpdir(), "chaturanga-book-pages-"));
const files = bookPageFiles(root, () => undefined);

describe("book page files", () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("keeps one file per page, replacing an earlier image of it", async () => {
    const first = await files.save("b1", 0, pngBytes("first"));
    const second = await files.save("b1", 0, pngBytes("second"));
    expect(second).toMatch(/b1\/p0001-[0-9a-f]{16}\.png$/);
    expect(readdirSync(join(root, "b1"))).toStrictEqual([second.split("/").at(-1)]);
    expect(first).not.toBe(second);
    await expect(files.read("b1", second)).resolves.toMatchObject({ type: "image/png" });
    await expect(files.readable("b1", second)).resolves.toBe(true);
    await expect(files.readable("b1", first)).resolves.toBe(false);
    await expect(files.readable("b2", second)).resolves.toBe(false);
  });

  it("refuses bytes that aren't an image, odd book ids and files of another folder", async () => {
    await expect(files.save("b1", 1, Buffer.from("GIF89a"))).rejects.toThrow("WebP, PNG or JPEG");
    await expect(files.save("../b1", 1, pngBytes())).rejects.toThrow("Invalid book id");
    await expect(files.read("b1", join(root, "b2", "p0001.png"))).resolves.toBeNull();
    await expect(files.read("b1", join(root, "b1", "missing.png"))).resolves.toBeNull();
  });
});
