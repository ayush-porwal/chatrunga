import { describe, expect, it } from "vitest";
import {
  type AppSettings,
  defaultSettings,
  hydratePieceSettings,
  normalizeAppearanceSettings,
  normalizeCommentaryProvider,
  normalizeDefaultEngineId,
  normalizeBoardSquareHex,
  normalizePiecePresentation,
  normalizePieceStyle,
  normalizeReviewEngineSettings,
  normalizeUpdateSettings,
  resolveEngineThreads
} from "./settings";

function legacyPieceStyleSettings(
  pieceStyle: string,
  overrides: Partial<AppSettings> = {}
): AppSettings {
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
    expect(hydratePieceSettings(legacyPieceStyleSettings("cburnettCrisp")).piecePresentation).toBe(
      "sharp"
    );
    expect(hydratePieceSettings(legacyPieceStyleSettings("stauntonSoft")).piecePresentation).toBe(
      "soft"
    );
    expect(
      hydratePieceSettings(
        legacyPieceStyleSettings("cburnettContrast", { piecePresentation: "default" })
      ).piecePresentation
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

describe("review engine settings", () => {
  it("has sensible defaults", () => {
    expect(defaultSettings.reviewMultiPv).toBe(3);
    expect(defaultSettings.engineHashMb).toBe(128);
    expect(defaultSettings.engineThreads).toBeNull();
    expect(defaultSettings.reviewMaiaLevels).toBeNull();
  });

  it("clamps and filters invalid persisted values", () => {
    const normalized = normalizeReviewEngineSettings({
      ...defaultSettings,
      reviewMultiPv: 9,
      engineHashMb: "abc" as unknown as number,
      engineThreads: 0,
      reviewMaiaLevels: [1900, 1234, 1100] as never
    });
    expect(normalized.reviewMultiPv).toBe(5);
    expect(normalized.engineHashMb).toBe(128);
    expect(normalized.engineThreads).toBe(1);
    expect(normalized.reviewMaiaLevels).toEqual([1100, 1900]);
  });

  it("drops a saved default engine id that points at a retired bundled engine", () => {
    expect(normalizeDefaultEngineId("bundled-stockfish")).toBeNull();
    expect(normalizeDefaultEngineId("bundled-maia")).toBeNull();
    expect(normalizeDefaultEngineId("bundled-maia-1500")).toBeNull();
    expect(normalizeDefaultEngineId("")).toBeNull();
    expect(normalizeDefaultEngineId(42)).toBeNull();
    expect(normalizeDefaultEngineId("V1StGXR8_Z5jdHi6B-myT")).toBe("V1StGXR8_Z5jdHi6B-myT");
    expect(normalizeReviewEngineSettings({ ...defaultSettings, defaultEngineId: "bundled-stockfish" }).defaultEngineId).toBeNull();
    expect(normalizeReviewEngineSettings({ ...defaultSettings, defaultEngineId: "abc123" }).defaultEngineId).toBe("abc123");
  });

  it("resolves auto threads to cpus - 1 capped at 8", () => {
    expect(resolveEngineThreads(null, 14)).toBe(8);
    expect(resolveEngineThreads(null, 4)).toBe(3);
    expect(resolveEngineThreads(null, 1)).toBe(1);
    expect(resolveEngineThreads(32, 4)).toBe(4);
  });
});

describe("normalizeCommentaryProvider", () => {
  it("keeps OpenRouter", () => {
    expect(normalizeCommentaryProvider("openrouter")).toBe("openrouter");
  });

  it("maps the retired offline and hosted providers to OpenRouter", () => {
    expect(normalizeCommentaryProvider("local")).toBe("openrouter");
    expect(normalizeCommentaryProvider("server")).toBe("openrouter");
    expect(normalizeCommentaryProvider(undefined)).toBe("openrouter");
  });

  it("reads an unmigrated legacy value as OpenRouter during normalization", () => {
    for (const legacy of ["local", "server"]) {
      const normalized = normalizeReviewEngineSettings({
        ...defaultSettings,
        reviewCommentaryProvider: legacy as never
      });
      expect(normalized.reviewCommentaryProvider).toBe("openrouter");
    }
    expect(normalizeReviewEngineSettings(defaultSettings).reviewCommentaryProvider).toBe(
      "openrouter"
    );
  });
});

describe("normalizeUpdateSettings", () => {
  it("defaults to background downloads on and beta releases off", () => {
    const normalized = normalizeUpdateSettings(defaultSettings);
    expect(normalized.updatesAutoDownload).toBe(true);
    expect(normalized.updatesIncludeBeta).toBe(false);
  });

  it("keeps saved booleans", () => {
    const normalized = normalizeUpdateSettings({ ...defaultSettings, updatesAutoDownload: false, updatesIncludeBeta: true });
    expect(normalized.updatesAutoDownload).toBe(false);
    expect(normalized.updatesIncludeBeta).toBe(true);
  });

  it("replaces anything else with the defaults", () => {
    for (const bad of ["true", 1, null, undefined, {}]) {
      const stored = { ...defaultSettings, updatesAutoDownload: bad, updatesIncludeBeta: bad } as unknown as AppSettings;
      const normalized = normalizeUpdateSettings(stored);
      expect(normalized.updatesAutoDownload).toBe(true);
      expect(normalized.updatesIncludeBeta).toBe(false);
    }
  });

  it("is idempotent and leaves other settings alone", () => {
    const once = normalizeUpdateSettings({ ...defaultSettings, soundVolume: 0.3 });
    expect(normalizeUpdateSettings(once)).toEqual(once);
    expect(once.soundVolume).toBe(0.3);
  });
});

describe("normalizeAppearanceSettings", () => {
  it("defaults the translucent window to on", () => {
    expect(defaultSettings.glassEffect).toBe(true);
    expect(normalizeAppearanceSettings(defaultSettings).glassEffect).toBe(true);
  });

  it("keeps a saved boolean and replaces anything else with the default", () => {
    expect(normalizeAppearanceSettings({ ...defaultSettings, glassEffect: false }).glassEffect).toBe(false);
    for (const bad of ["false", 0, null, undefined]) {
      const stored = { ...defaultSettings, glassEffect: bad } as unknown as AppSettings;
      expect(normalizeAppearanceSettings(stored).glassEffect).toBe(true);
    }
  });
});
