import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalImagePath } from "./image-access";

describe("isServableImage", () => {
  // The folders and files allowed are the module's own state: each test starts from a fresh copy.
  let allowChosenFile: typeof import("./image-access").allowChosenFile;
  let allowImageFolder: typeof import("./image-access").allowImageFolder;
  let isServableImage: typeof import("./image-access").isServableImage;
  beforeEach(async () => {
    vi.resetModules();
    ({ allowChosenFile, allowImageFolder, isServableImage } = await import("./image-access"));
  });

  it("serves engine pictures and files picked this session, nothing else", () => {
    const registered = () => ["/engines/stockfish.png", null];
    expect(isServableImage("/engines/stockfish.png", registered)).toBe(true);
    expect(isServableImage("/Users/me/Pictures/private.png", registered)).toBe(false);
    allowChosenFile("/Users/me/Pictures/maia.png");
    expect(isServableImage("/Users/me/Pictures/maia.png", registered)).toBe(true);
  });

  it("serves the app's own picture folders, but nothing beside or below them", () => {
    allowImageFolder("/data/engine-images");
    const none = () => [];
    expect(isServableImage("/data/engine-images/sf-0123456789abcdef.png", none)).toBe(true);
    expect(isServableImage("/data/engine-images/sub/x.png", none)).toBe(false);
    expect(isServableImage("/data/engine-images/../secret.png", none)).toBe(false);
    expect(isServableImage("/data/engine-images-x/x.png", none)).toBe(false);
    expect(isServableImage("/data/x.png", none)).toBe(false);
    // Your picture's folder is served beside the engines' (each registered on its own).
    expect(isServableImage("/data/profile-pictures/upload-0123456789abcdef.png", none)).toBe(false);
    allowImageFolder("/data/profile-pictures");
    expect(isServableImage("/data/profile-pictures/upload-0123456789abcdef.png", none)).toBe(true);
    expect(isServableImage("/data/engine-images/sf-0123456789abcdef.png", none)).toBe(true);
    expect(isServableImage("/data/profile-picture.json", none)).toBe(false);
    const windows = true;
    allowImageFolder("C:\\Users\\me\\AppData\\chaturanga\\engine-images");
    expect(
      isServableImage("/C:/Users/me/AppData/chaturanga/engine-images/sf-1.png", none, windows)
    ).toBe(true);
    expect(
      isServableImage("C:/Users/me/AppData/chaturanga/engine-images/../x.png", none, windows)
    ).toBe(false);
  });

  it("matches pictures stored as file URLs", () => {
    expect(isServableImage("/tmp/logo.png", () => ["file:///tmp/logo.png"])).toBe(true);
    expect(isServableImage("/tmp/other.png", () => ["file:///tmp/logo.png"])).toBe(false);
  });

  it("matches pictures stored as chaturanga-image URLs", () => {
    const stored = () => ["chaturanga-image://local/%2Ftmp%2Flogo.png"];
    expect(isServableImage("/tmp/logo.png", stored)).toBe(true);
    expect(isServableImage("/tmp/other.png", stored)).toBe(false);
    const windows = true;
    expect(
      isServableImage(
        "C:/engines/logo.png",
        () => ["chaturanga-image://local/C%3A%2Fengines%2Flogo.png"],
        windows
      )
    ).toBe(true);
  });

  it("matches Windows pictures however they are spelled", () => {
    const windows = true;
    const asUrl = () => ["file:///C:/engines/logo.png"];
    // `localImageSrc` asks for a stored `file:///C:/...` URL by its pathname.
    expect(isServableImage("/C:/engines/logo.png", asUrl, windows)).toBe(true);
    expect(isServableImage("C:\\engines\\logo.png", asUrl, windows)).toBe(true);
    expect(isServableImage("/C:/engines/logo.png", () => ["C:\\engines\\logo.png"], windows)).toBe(
      true
    );
    expect(isServableImage("/C:/engines/other.png", asUrl, windows)).toBe(false);
    allowChosenFile("D:\\Pictures\\maia.png");
    expect(isServableImage("/D:/Pictures/maia.png", () => [], windows)).toBe(true);
  });
});

describe("canonicalImagePath", () => {
  it("spells Windows paths and file URLs one way", () => {
    expect(canonicalImagePath("file:///C:/engines/My%20Logo.png", true)).toBe(
      "C:\\engines\\My Logo.png"
    );
    expect(canonicalImagePath("/C:/engines/logo.png", true)).toBe("C:\\engines\\logo.png");
    expect(canonicalImagePath(" C:/engines/logo.png ", true)).toBe("C:\\engines\\logo.png");
    expect(canonicalImagePath("file://nas/share/logo.png", true)).toBe("\\\\nas\\share\\logo.png");
  });

  it("leaves POSIX paths as they are", () => {
    expect(canonicalImagePath("file:///tmp/My%20Logo.png", false)).toBe("/tmp/My Logo.png");
    expect(canonicalImagePath("/C:/engines/logo.png", false)).toBe("/C:/engines/logo.png");
    expect(canonicalImagePath("file:///tmp/%2F.png", false)).toBe("file:///tmp/%2F.png");
  });
});
