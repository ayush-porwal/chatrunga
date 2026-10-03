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
  normalizeOnboardingSettings,
  normalizePracticeSettings,
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
  it("defaults to background downloads on", () => {
    expect(normalizeUpdateSettings(defaultSettings).updatesAutoDownload).toBe(true);
  });

  it("keeps a saved boolean, replaces anything else, and drops the old beta opt-in", () => {
    expect(normalizeUpdateSettings({ ...defaultSettings, updatesAutoDownload: false }).updatesAutoDownload).toBe(false);
    for (const bad of ["true", 1, null, undefined, {}]) {
      const stored = { ...defaultSettings, updatesAutoDownload: bad, updatesIncludeBeta: true } as unknown as AppSettings;
      const normalized = normalizeUpdateSettings(stored);
      expect(normalized.updatesAutoDownload).toBe(true);
      expect(normalized).not.toHaveProperty("updatesIncludeBeta");
    }
  });

  it("is idempotent and leaves other settings alone", () => {
    const once = normalizeUpdateSettings({ ...defaultSettings, soundVolume: 0.3 });
    expect(normalizeUpdateSettings(once)).toEqual(once);
    expect(once.soundVolume).toBe(0.3);
  });
});

describe("normalizeAppearanceSettings", () => {
  it("drops the translucent-window setting older builds stored (it's always on now)", () => {
    const stored = { ...defaultSettings, glassEffect: false } as unknown as AppSettings;
    expect(normalizeAppearanceSettings(stored)).not.toHaveProperty("glassEffect");
    expect(normalizeAppearanceSettings(defaultSettings)).toBe(defaultSettings);
  });
});

describe("normalizePracticeSettings", () => {
  it("keeps practice's pace by default: a correct answer moves on after 0.6 s", () => {
    expect(normalizePracticeSettings(defaultSettings).practiceAutoAdvanceMs).toBe(600);
  });

  it("keeps an offered delay (0 waits for Next) and replaces anything else", () => {
    for (const delay of [0, 600, 1500, 3000]) {
      const stored = { ...defaultSettings, practiceAutoAdvanceMs: delay } as AppSettings;
      expect(normalizePracticeSettings(stored).practiceAutoAdvanceMs).toBe(delay);
    }
    for (const bad of [1000, -1, "600", null, undefined]) {
      const stored = { ...defaultSettings, practiceAutoAdvanceMs: bad } as unknown as AppSettings;
      expect(normalizePracticeSettings(stored).practiceAutoAdvanceMs).toBe(600);
    }
  });
});

describe("normalizeOnboardingSettings", () => {
  it("defaults to a welcome that has not been completed and no tips seen", () => {
    const normalized = normalizeOnboardingSettings(defaultSettings);
    expect(normalized.onboardingCompletedAt).toBeNull();
    expect(normalized.onboardingHintsSeen).toEqual([]);
  });

  it("keeps a completion time, including 0 for installs that predate the welcome", () => {
    expect(normalizeOnboardingSettings({ ...defaultSettings, onboardingCompletedAt: 1_700_000_000_123 }).onboardingCompletedAt).toBe(1_700_000_000_123);
    expect(normalizeOnboardingSettings({ ...defaultSettings, onboardingCompletedAt: 0 }).onboardingCompletedAt).toBe(0);
  });

  it("reads anything that is not a finite, non-negative number as not completed", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1700000000000", true, {}, undefined]) {
      const stored = { ...defaultSettings, onboardingCompletedAt: bad } as unknown as AppSettings;
      expect(normalizeOnboardingSettings(stored).onboardingCompletedAt).toBeNull();
    }
  });

  it("keeps known tip ids once each and drops the rest", () => {
    const stored = {
      ...defaultSettings,
      onboardingHintsSeen: ["maia-curve", "unknown", "maia-curve", 3, "commentary-links"]
    } as unknown as AppSettings;
    expect(normalizeOnboardingSettings(stored).onboardingHintsSeen).toEqual(["commentary-links", "maia-curve"]);
    const notAList = { ...defaultSettings, onboardingHintsSeen: "maia-curve" } as unknown as AppSettings;
    expect(normalizeOnboardingSettings(notAList).onboardingHintsSeen).toEqual([]);
  });

  it("is idempotent", () => {
    const once = normalizeOnboardingSettings({ ...defaultSettings, onboardingCompletedAt: 5.7, onboardingHintsSeen: ["maia-curve"] });
    expect(normalizeOnboardingSettings(once)).toEqual(once);
  });
});
