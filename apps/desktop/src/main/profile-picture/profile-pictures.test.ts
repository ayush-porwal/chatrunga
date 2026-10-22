import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pngBytes, pngOfSize } from "../__fixtures__/picture-bytes";
import { pictureStore } from "../picture-store";
import { writePrivateJsonFile } from "../secure-json-file";
import { parseSavePictureInput, pictureSrc, ProfilePictures } from "./profile-pictures";
import type { RemotePicture } from "./remote-picture";
import type { YourPicture } from "@chaturanga/shared/ipc/chaturanga-api";

// The state file's writes, so a test can make one fail.
vi.mock("../secure-json-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../secure-json-file")>();
  return { ...actual, writePrivateJsonFile: vi.fn(actual.writePrivateJsonFile) };
});

const AVATAR = "https://images.chesscomfiles.com/uploads/v1/user/1.png";
const FLAIR = "https://lichess1.org/assets/flair/img/objects.crown.webp";
const NONE: YourPicture = { src: null, source: null, adjustable: false };
const CROP = { x: 0.5, y: 0.5, zoom: 1 };

describe("ProfilePictures", () => {
  let root: string;
  let dir: string;
  let stateFile: string;
  let accounts: { chesscom: string | null; lichess: string | null };
  let download: ReturnType<typeof vi.fn<(url: string) => Promise<RemotePicture>>>;
  let onChange: ReturnType<typeof vi.fn<() => void>>;
  let log: ReturnType<typeof vi.fn<(message: string, error: unknown) => void>>;
  let pictures: ProfilePictures;

  function photo(name: string, contents = "photo bytes"): string {
    mkdirSync(join(root, "Pictures"), { recursive: true });
    const path = join(root, "Pictures", name);
    writeFileSync(path, pngBytes(contents));
    return path;
  }

  /** Your photo from `path` as Settings saves it: opened, cut to a square (`cut`), and kept. */
  async function choose(path: string, cut = "cut") {
    const file = await pictures.open(path);
    return pictures.save({
      cropped: pngOfSize(512, 512, cut),
      original: Buffer.from(file.bytes),
      crop: CROP
    });
  }

  /** The copy a picture's src names. */
  const pathOf = (picture: YourPicture) =>
    decodeURIComponent(String(picture.src).replace("chaturanga-image://local/", ""));
  const copies = () => readdirSync(dir).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "chaturanga-profile-pictures-"));
    dir = join(root, "profile-pictures");
    stateFile = join(root, "profile-picture.json");
    accounts = { chesscom: null, lichess: null };
    download = vi.fn(async (url: string) => ({
      contents: Buffer.from(`picture at ${url}`),
      extension: url.endsWith(".webp") ? ".webp" : ".png"
    }));
    onChange = vi.fn();
    log = vi.fn();
    pictures = new ProfilePictures({
      store: pictureStore(dir, { noun: "picture", warn: log }),
      stateFile,
      accountPictures: async () => ({ ...accounts }),
      download,
      onChange,
      log
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("has no picture at first", async () => {
    await expect(pictures.picture()).resolves.toStrictEqual(NONE);
    await pictures.refresh();
    expect(download).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a chosen photo's crop and original, replaces both with the next, and forgets them on Remove", async () => {
    const original = photo("me.png", "first");
    const first = await choose(original, "first cut");
    expect(first.source).toBe("upload");
    expect(first.adjustable).toBe(true);
    expect(first.src).toBe(pictureSrc(pathOf(first)));
    expect(readFileSync(pathOf(first))).toStrictEqual(pngOfSize(512, 512, "first cut"));
    expect(basename(pathOf(first))).toMatch(/^upload-[0-9a-f]{16}\.png$/);
    expect(copies().map((name) => name.split("-")[0])).toStrictEqual(["original", "upload"]);
    expect(onChange).toHaveBeenCalledTimes(1);

    const second = await choose(photo("me-again.jpg", "second"), "second cut");
    expect(second.src).not.toBe(first.src);
    // Only the current photo and its original are kept; the picked file is left where it was.
    expect(copies()).toHaveLength(2);
    expect(copies()).toContain(basename(pathOf(second)));
    expect(readFileSync(original)).toStrictEqual(pngBytes("first"));
    await expect(pictures.picture()).resolves.toStrictEqual(second);
    await expect(pictures.original()).resolves.toMatchObject({
      bytes: pngBytes("second"),
      type: "image/png",
      crop: CROP
    });

    await expect(pictures.remove()).resolves.toStrictEqual(NONE);
    expect(copies()).toStrictEqual([]);
    await expect(pictures.original()).resolves.toBeNull();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("re-cuts your photo from the original it keeps (Adjust)", async () => {
    await choose(photo("me.png", "photo"));
    const kept = copies().find((name) => name.startsWith("original-"));
    const recut = { x: 0.4, y: 0.5, zoom: 2 };
    const adjusted = await pictures.save({
      cropped: pngOfSize(512, 512, "recut"),
      original: null,
      crop: recut
    });
    expect(readFileSync(pathOf(adjusted))).toStrictEqual(pngOfSize(512, 512, "recut"));
    expect(copies()).toContain(kept);
    await expect(pictures.original()).resolves.toMatchObject({
      bytes: pngBytes("photo"),
      crop: recut
    });
  });

  it("won't re-cut without an original, and a photo kept without one can't be adjusted", async () => {
    await expect(
      pictures.save({ cropped: pngOfSize(512, 512), original: null, crop: CROP })
    ).rejects.toThrow("Choose the picture again");
    const upload = pathOf(await choose(photo("me.png")));
    // A photo from before originals were kept: the state names no original.
    writeFileSync(stateFile, JSON.stringify({ upload: { path: upload, url: null } }));
    await expect(pictures.picture()).resolves.toMatchObject({
      source: "upload",
      adjustable: false
    });
    await expect(pictures.original()).resolves.toBeNull();
  });

  it("keeps the photo it had, and its copy, when the change can't be stored", async () => {
    const kept = await choose(photo("me.png", "first"));
    const keptCopies = copies();
    const state = readFileSync(stateFile, "utf8");
    vi.mocked(writePrivateJsonFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(choose(photo("new.png", "second"))).rejects.toThrow("disk full");
    // The new copies are gone; the old ones, which the state still names, are there.
    expect(copies()).toStrictEqual(keptCopies);
    expect(readFileSync(stateFile, "utf8")).toBe(state);
    await expect(pictures.picture()).resolves.toStrictEqual(kept);
    vi.mocked(writePrivateJsonFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(pictures.remove()).rejects.toThrow("disk full");
    await expect(pictures.picture()).resolves.toStrictEqual(kept);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the account's copy it had when a refresh can't be stored", async () => {
    accounts.chesscom = AVATAR;
    await pictures.refresh();
    const old = await pictures.picture();
    accounts.chesscom = AVATAR.replace("1.png", "2.png");
    vi.mocked(writePrivateJsonFile).mockRejectedValueOnce(new Error("disk full"));
    await pictures.refresh();
    expect(log).toHaveBeenCalledWith("refreshing your picture failed", expect.any(Error));
    expect(copies()).toStrictEqual([basename(pathOf(old))]);
    await expect(pictures.picture()).resolves.toStrictEqual(old);
  });

  it("answers a read made while a refresh runs with the refreshed picture", async () => {
    accounts.chesscom = AVATAR;
    let finish = () => {};
    const downloaded = new Promise<void>((resolve) => (finish = resolve));
    download.mockImplementationOnce(async (url) => {
      await downloaded;
      return { contents: Buffer.from(`picture at ${url}`), extension: ".png" };
    });
    const refreshing = pictures.refresh();
    const read = pictures.picture();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    finish();
    await expect(read).resolves.toMatchObject({ source: "chesscom" });
    await refreshing;
  });

  it("refuses a file that isn't a picture, and keeps the photo it had", async () => {
    const kept = await choose(photo("me.png"));
    const notes = join(root, "Pictures", "notes.txt");
    writeFileSync(notes, "just some text");
    await expect(pictures.open(notes)).rejects.toThrow(
      "The picture notes.txt isn't a PNG, JPG, WebP or GIF file."
    );
    // Renamed to look like one: its bytes say otherwise.
    const renamed = join(root, "Pictures", "renamed.png");
    writeFileSync(renamed, "just some text");
    await expect(pictures.open(renamed)).rejects.toThrow(/renamed.png isn't a PNG/);
    await expect(pictures.open(join(root, "gone.png"))).rejects.toThrow(/wasn't found/);
    const large = join(root, "Pictures", "large.png");
    writeFileSync(large, Buffer.concat([pngBytes(), Buffer.alloc(5 * 1024 * 1024)]));
    await expect(pictures.open(large)).rejects.toThrow("larger than 5 MB");
    await expect(pictures.picture()).resolves.toStrictEqual(kept);
  });

  it("prefers your photo, then the Chess.com picture, then the Lichess flair", async () => {
    accounts = { chesscom: AVATAR, lichess: FLAIR };
    await pictures.refresh();
    expect(download.mock.calls.map(([url]) => url)).toStrictEqual([AVATAR, FLAIR]);
    expect((await pictures.picture()).source).toBe("chesscom");
    const upload = await choose(photo("me.png"));
    expect(upload.source).toBe("upload");
    // Each source keeps its own copy, apart from the others.
    expect(
      copies()
        .map((name) => name.split("-")[0])
        .sort()
    ).toStrictEqual(["chesscom", "lichess", "original", "upload"]);
    await pictures.remove();
    expect((await pictures.picture()).source).toBe("chesscom");
    accounts.chesscom = null;
    await pictures.refresh();
    const lichess = await pictures.picture();
    expect(lichess.source).toBe("lichess");
    expect(readFileSync(pathOf(lichess), "utf8")).toBe(`picture at ${FLAIR}`);
  });

  it("follows the accounts: downloads on connect and on a new address, drops on disconnect", async () => {
    accounts.chesscom = AVATAR;
    await pictures.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);
    const connected = await pictures.picture();
    // Nothing new: nothing downloaded, nothing announced.
    await pictures.refresh();
    expect(download).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    // A new picture on Chess.com replaces the copy.
    accounts.chesscom = AVATAR.replace("1.png", "2.png");
    await pictures.refresh();
    expect(download).toHaveBeenCalledTimes(2);
    const changed = await pictures.picture();
    expect(changed.src).not.toBe(connected.src);
    expect(copies()).toStrictEqual([basename(pathOf(changed))]);
    // Disconnected: its copy is deleted, and the side's colour shows again.
    accounts.chesscom = null;
    await pictures.refresh();
    await expect(pictures.picture()).resolves.toStrictEqual(NONE);
    expect(copies()).toStrictEqual([]);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("keeps the address of the same picture moved to a new one, and doesn't fetch it again", async () => {
    accounts.chesscom = AVATAR;
    // Chess.com moved the same picture: the copy (named for its bytes) is the same file.
    download.mockImplementation(async () => ({ contents: Buffer.from("same"), extension: ".png" }));
    await pictures.refresh();
    const before = await pictures.picture();
    accounts.chesscom = AVATAR.replace("1.png", "moved.png");
    await pictures.refresh();
    await pictures.refresh();
    await pictures.refresh();
    expect(download).toHaveBeenCalledTimes(2);
    await expect(pictures.picture()).resolves.toStrictEqual(before);
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({
      chesscom: { url: accounts.chesscom }
    });
  });

  it("keeps the picture it has when the new one can't be downloaded, and tries again", async () => {
    accounts.chesscom = AVATAR;
    await pictures.refresh();
    const old = await pictures.picture();
    const moved = AVATAR.replace("1.png", "2.png");
    accounts.chesscom = moved;
    download.mockRejectedValueOnce(new Error("offline"));
    await pictures.refresh();
    await expect(pictures.picture()).resolves.toStrictEqual(old);
    expect(copies()).toStrictEqual([basename(pathOf(old))]);
    // Still under its old address: the next refresh tries the new one.
    await pictures.refresh();
    expect(download).toHaveBeenLastCalledWith(moved);
    const fresh = await pictures.picture();
    expect(fresh.src).not.toBe(old.src);
    expect(copies()).toStrictEqual([basename(pathOf(fresh))]);
  });

  it("falls back to the next source when a download fails, and tries again next time", async () => {
    accounts = { chesscom: AVATAR, lichess: FLAIR };
    download.mockRejectedValueOnce(new Error("offline"));
    await pictures.refresh();
    expect((await pictures.picture()).source).toBe("lichess");
    expect(log).toHaveBeenCalledWith("your chesscom picture wasn't downloaded", expect.any(Error));
    await pictures.refresh();
    expect((await pictures.picture()).source).toBe("chesscom");
  });

  it("downloads again when a copy has gone missing", async () => {
    accounts.lichess = FLAIR;
    await pictures.refresh();
    rmSync(dir, { recursive: true });
    await expect(pictures.picture()).resolves.toStrictEqual(NONE);
    await pictures.refresh();
    expect(download).toHaveBeenCalledTimes(2);
    expect((await pictures.picture()).source).toBe("lichess");
  });

  it("joins account changes that arrive while a refresh waits its turn", async () => {
    accounts.chesscom = AVATAR;
    const choosing = choose(photo("me.png"));
    const refreshes = [pictures.refresh(), pictures.refresh(), pictures.refresh()];
    await Promise.all([choosing, ...refreshes]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("never serves a file outside its folder, whatever the state file says", async () => {
    const outside = photo("secret.png");
    writeFileSync(
      stateFile,
      JSON.stringify({ upload: { path: outside, url: null }, chesscom: "nonsense" })
    );
    await expect(pictures.picture()).resolves.toStrictEqual(NONE);
    // A copy of the folder, but another source's: not taken as your photo.
    accounts.chesscom = AVATAR;
    await pictures.refresh();
    const avatar = pathOf(await pictures.picture());
    writeFileSync(stateFile, JSON.stringify({ upload: { path: avatar, url: null } }));
    await expect(pictures.picture()).resolves.toStrictEqual(NONE);
    writeFileSync(stateFile, "not json");
    await expect(pictures.picture()).resolves.toStrictEqual(NONE);
  });

  it("reports a refresh that failed, and never rejects", async () => {
    const failing = new ProfilePictures({
      store: pictureStore(dir, { noun: "picture", warn: log }),
      stateFile,
      accountPictures: () => Promise.reject(new Error("unreadable")),
      download,
      onChange,
      log
    });
    await expect(failing.refresh()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("refreshing your picture failed", expect.any(Error));
  });
});

describe("parseSavePictureInput", () => {
  const input = { cropped: pngOfSize(512, 512), original: pngBytes("photo"), crop: CROP };

  it("takes a square PNG crop, its original and the crop", () => {
    const parsed = parseSavePictureInput({ ...input, cropped: new Uint8Array(input.cropped) });
    expect(parsed.cropped).toStrictEqual(input.cropped);
    expect(parsed.original).toStrictEqual(input.original);
    expect(parsed.crop).toStrictEqual(CROP);
    expect(parseSavePictureInput({ ...input, original: null }).original).toBeNull();
  });

  it("refuses a crop that isn't a square PNG of at most 512 pixels", () => {
    for (const cropped of [pngOfSize(512, 384), pngOfSize(1024, 1024), pngBytes("no header")])
      expect(() => parseSavePictureInput({ ...input, cropped })).toThrow("square PNG");
  });

  it("refuses an original that isn't a picture, and anything malformed", () => {
    expect(() => parseSavePictureInput({ ...input, original: Buffer.from("text") })).toThrow(
      "isn't a PNG"
    );
    for (const value of [
      null,
      { ...input, cropped: "bytes" },
      { ...input, original: "bytes" },
      { ...input, crop: { x: 2, y: 0.5, zoom: 1 } },
      { ...input, crop: { x: 0.5, y: 0.5, zoom: 9 } }
    ])
      expect(() => parseSavePictureInput(value)).toThrow("Invalid picture.");
  });
});
