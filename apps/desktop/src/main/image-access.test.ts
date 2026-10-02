import { describe, expect, it } from "vitest";
import { allowChosenFile, canonicalImagePath, isServableImage } from "./image-access";

describe("isServableImage", () => {
  it("serves engine pictures and files picked this session, nothing else", () => {
    const registered = () => ["/engines/stockfish.png", null];
    expect(isServableImage("/engines/stockfish.png", registered)).toBe(true);
    expect(isServableImage("/Users/me/Pictures/private.png", registered)).toBe(false);
    allowChosenFile("/Users/me/Pictures/maia.png");
    expect(isServableImage("/Users/me/Pictures/maia.png", registered)).toBe(true);
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
