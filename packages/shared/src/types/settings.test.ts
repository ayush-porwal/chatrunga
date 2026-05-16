import { describe, expect, it } from "vitest";
import {
  type AppSettings,
  defaultSettings,
  hydratePieceSettings,
  normalizeBoardSquareHex,
  normalizePiecePresentation,
  normalizePieceStyle
} from "./settings";

function legacyPieceStyleSettings(pieceStyle: string, overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...defaultSettings, ...overrides, pieceStyle } as AppSettings;
}

describe("normalizePieceStyle", () => {
  it("maps legacy staunton ids to cburnett", () => {
    expect(normalizePieceStyle("staunton")).toBe("cburnett");
    expect(normalizePieceStyle("stauntonCrisp")).toBe("cburnett");
    expect(normalizePieceStyle("stauntonSoft")).toBe("cburnett");
    expect(normalizePieceStyle("stauntonContrast")).toBe("cburnett");
  });

  it("maps legacy cburnett variant ids to cburnett", () => {
    expect(normalizePieceStyle("cburnettCrisp")).toBe("cburnett");
    expect(normalizePieceStyle("cburnett-soft")).toBe("cburnett");
  });

  it("maps kosalo typo to kosal", () => {
    expect(normalizePieceStyle("kosalo")).toBe("kosal");
  });

  it("accepts vendored Lichess set ids", () => {
    expect(normalizePieceStyle("merida")).toBe("merida");
    expect(normalizePieceStyle("chessnut")).toBe("chessnut");
  });

  it("falls back for unknown strings", () => {
    expect(normalizePieceStyle("not-a-theme")).toBe(defaultSettings.pieceStyle);
    expect(normalizePieceStyle(null)).toBe(defaultSettings.pieceStyle);
  });
});

describe("normalizePiecePresentation", () => {
  it("accepts known ids", () => {
    expect(normalizePiecePresentation("sharp")).toBe("sharp");
    expect(normalizePiecePresentation("default")).toBe("default");
  });

  it("falls back for unknown strings", () => {
    expect(normalizePiecePresentation("wide")).toBe(defaultSettings.piecePresentation);
    expect(normalizePiecePresentation(null)).toBe(defaultSettings.piecePresentation);
  });
});

describe("hydratePieceSettings", () => {
  it("derives presentation from legacy combined piece style ids", () => {
    expect(hydratePieceSettings(legacyPieceStyleSettings("cburnettCrisp")).piecePresentation).toBe("sharp");
    expect(hydratePieceSettings(legacyPieceStyleSettings("stauntonSoft")).piecePresentation).toBe("soft");
    expect(
      hydratePieceSettings(legacyPieceStyleSettings("cburnettContrast", { piecePresentation: "default" }))
        .piecePresentation
    ).toBe("contrast");
  });

  it("keeps explicit presentation when piece style is not a legacy combo id", () => {
    const h = hydratePieceSettings({
      ...defaultSettings,
      pieceStyle: "merida",
      piecePresentation: "sharp"
    });
    expect(h.pieceStyle).toBe("merida");
    expect(h.piecePresentation).toBe("sharp");
  });

  it("is idempotent for new-shape settings", () => {
    const once = hydratePieceSettings({
      ...defaultSettings,
      pieceStyle: "alpha",
      piecePresentation: "soft"
    });
    expect(hydratePieceSettings(once)).toEqual(once);
  });
});

describe("normalizeBoardSquareHex", () => {
  it("accepts 6-digit hex with optional hash", () => {
    expect(normalizeBoardSquareHex("#f0d9b5")).toBe("#f0d9b5");
    expect(normalizeBoardSquareHex("f0d9b5")).toBe("#f0d9b5");
    expect(normalizeBoardSquareHex(" F0D9B5 ")).toBe("#f0d9b5");
  });

  it("rejects invalid values", () => {
    expect(normalizeBoardSquareHex("")).toBe(null);
    expect(normalizeBoardSquareHex(null)).toBe(null);
    expect(normalizeBoardSquareHex("#fff")).toBe(null);
    expect(normalizeBoardSquareHex("#gggggg")).toBe(null);
  });
});
