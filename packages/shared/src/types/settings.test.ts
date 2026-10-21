import { describe, expect, it } from "vitest";
import {
  type AppSettings,
  defaultSettings,
  hydratePieceSettings,
  normalizeAppearanceSettings,
  normalizeCommentaryProvider,
  normalizeDefaultEngineId,
  normalizeBoardSquareHex,
  normalizePieceSizes,
  normalizePieceStyle,
  normalizeReviewEngineSettings,
  normalizeOnboardingSettings,
  normalizePlaySettings,
  normalizePracticeSettings,
  normalizeSoundSettings,
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

  it("accepts the packed set ids", () => {
    expect(normalizePieceStyle("merida")).toBe("merida");
    expect(normalizePieceStyle("chessnut")).toBe("chessnut");
  });

  it("falls back for unknown strings", () => {
    expect(normalizePieceStyle("not-a-theme")).toBe(defaultSettings.pieceStyle);
    expect(normalizePieceStyle(null)).toBe(defaultSettings.pieceStyle);
  });
});

describe("removed piece sets", () => {
  it("reads a stored Alpha (dropped: its terms allow personal use only) as the default set", () => {
    expect(normalizePieceStyle("alpha")).toBe(defaultSettings.pieceStyle);
  });
});

describe("normalizePieceSizes", () => {
  it("accepts the two modes and falls back for anything else", () => {
    expect(normalizePieceSizes("uniform")).toBe("uniform");
    expect(normalizePieceSizes("ladder")).toBe("ladder");
    expect(normalizePieceSizes("tall")).toBe(defaultSettings.pieceSizes);
    expect(normalizePieceSizes(undefined)).toBe(defaultSettings.pieceSizes);
  });
});

describe("hydratePieceSettings", () => {
  it("maps older piece set ids and drops the removed piece look", () => {
    const stored = {
      ...legacyPieceStyleSettings("stauntonSoft"),
      piecePresentation: "soft"
    } as AppSettings;
    const hydrated = hydratePieceSettings(stored);
    expect(hydrated.pieceStyle).toBe("cburnett");
    expect(hydrated).not.toHaveProperty("piecePresentation");
  });

  it("keeps the chosen set and sizes", () => {
    const hydrated = hydratePieceSettings({
      ...defaultSettings,
      pieceStyle: "merida",
      pieceSizes: "uniform"
    });
    expect(hydrated.pieceStyle).toBe("merida");
    expect(hydrated.pieceSizes).toBe("uniform");
  });

  it("is idempotent for new-shape settings", () => {
    const once = hydratePieceSettings({ ...defaultSettings, pieceStyle: "cardinal" });
    expect(hydratePieceSettings(once)).toStrictEqual(once);
  });
});

describe("normalizeBoardSquareHex", () => {
  it("accepts 6-digit hex with optional hash", () => {
    expect(normalizeBoardSquareHex("#f0d9b5")).toBe("#f0d9b5");
    expect(normalizeBoardSquareHex("f0d9b5")).toBe("#f0d9b5");
    expect(normalizeBoardSquareHex(" F0D9B5 ")).toBe("#f0d9b5");
  });

  it("rejects invalid values", () => {
    expect(normalizeBoardSquareHex("")).toBeNull();
    expect(normalizeBoardSquareHex(null)).toBeNull();
    expect(normalizeBoardSquareHex("#fff")).toBeNull();
    expect(normalizeBoardSquareHex("#gggggg")).toBeNull();
  });
});

describe("review engine settings", () => {
  it("has sensible defaults", () => {
    expect(defaultSettings.reviewMultiPv).toBe(3);
    expect(defaultSettings.engineHashMb).toBe(128);
    expect(defaultSettings.engineThreads).toBeNull();
    // Maia 3 reads each side at its own game rating until a rating is chosen.
    expect(defaultSettings.reviewMaiaRating).toBeNull();
  });

  it("snaps a stored Maia 3 review rating to its grid and forgets one that isn't a number", () => {
    const read = (value: unknown) =>
      normalizeReviewEngineSettings({ ...defaultSettings, reviewMaiaRating: value as number })
        .reviewMaiaRating;
    expect(read(1700)).toBe(1700);
    expect(read(1649)).toBe(1600);
    expect(read(3000)).toBe(2600);
    expect(read(null)).toBeNull();
    expect(read("1700")).toBeNull();
    expect(read(Number.NaN)).toBeNull();
  });

  it("clamps and filters invalid persisted values", () => {
    const normalized = normalizeReviewEngineSettings({
      ...defaultSettings,
      reviewMultiPv: 9,
      engineHashMb: "abc" as unknown as number,
      engineThreads: 0
    });
    expect(normalized.reviewMultiPv).toBe(5);
    expect(normalized.engineHashMb).toBe(128);
    expect(normalized.engineThreads).toBe(1);
  });

  it("reads a thread count missing from unmerged settings as auto, like resolveEngineThreads", () => {
    const unmerged = { ...defaultSettings, engineThreads: undefined } as unknown as AppSettings;
    expect(normalizeReviewEngineSettings(unmerged).engineThreads).toBeNull();
    expect(resolveEngineThreads(undefined, 8)).toBe(resolveEngineThreads(null, 8));
  });

  it("drops a saved default engine id that points at a retired bundled engine", () => {
    expect(normalizeDefaultEngineId("bundled-stockfish")).toBeNull();
    expect(normalizeDefaultEngineId("bundled-maia")).toBeNull();
    expect(normalizeDefaultEngineId("bundled-maia-1500")).toBeNull();
    expect(normalizeDefaultEngineId("")).toBeNull();
    expect(normalizeDefaultEngineId(42)).toBeNull();
    expect(normalizeDefaultEngineId("V1StGXR8_Z5jdHi6B-myT")).toBe("V1StGXR8_Z5jdHi6B-myT");
    expect(
      normalizeReviewEngineSettings({ ...defaultSettings, defaultEngineId: "bundled-stockfish" })
        .defaultEngineId
    ).toBeNull();
    expect(
      normalizeReviewEngineSettings({ ...defaultSettings, defaultEngineId: "abc123" })
        .defaultEngineId
    ).toBe("abc123");
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
    expect(
      normalizeUpdateSettings({ ...defaultSettings, updatesAutoDownload: false })
        .updatesAutoDownload
    ).toBe(false);
    for (const bad of ["true", 1, null, undefined, {}]) {
      const stored = {
        ...defaultSettings,
        updatesAutoDownload: bad,
        updatesIncludeBeta: true
      } as unknown as AppSettings;
      const normalized = normalizeUpdateSettings(stored);
      expect(normalized.updatesAutoDownload).toBe(true);
      expect(normalized).not.toHaveProperty("updatesIncludeBeta");
    }
  });

  it("is idempotent and leaves other settings alone", () => {
    const once = normalizeUpdateSettings({ ...defaultSettings, soundVolume: 0.3 });
    expect(normalizeUpdateSettings(once)).toStrictEqual(once);
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

describe("normalizePlaySettings", () => {
  it("keeps a chosen opponent and engine, and forgets a damaged choice", () => {
    expect(normalizePlaySettings(defaultSettings)).toMatchObject({
      playOpponent: null,
      playEngineId: null
    });
    const chosen = { ...defaultSettings, playOpponent: "pool", playEngineId: "sf" } as AppSettings;
    expect(normalizePlaySettings(chosen)).toMatchObject({
      playOpponent: "pool",
      playEngineId: "sf"
    });
    const bad = {
      ...defaultSettings,
      playOpponent: "home",
      playEngineId: 7
    } as unknown as AppSettings;
    expect(normalizePlaySettings(bad)).toMatchObject({ playOpponent: null, playEngineId: null });
  });

  it("keeps the last Maia rating on its grid, and none until one is chosen", () => {
    expect(defaultSettings.playMaiaRating).toBeNull();
    const read = (value: unknown) =>
      normalizePlaySettings({ ...defaultSettings, playMaiaRating: value as number }).playMaiaRating;
    expect(read(900)).toBe(900);
    expect(read(551)).toBe(600);
    expect(read(undefined)).toBeNull();
    expect(read({})).toBeNull();
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

describe("normalizeSoundSettings", () => {
  it("defaults to Lichess's SFX set with an audible check", () => {
    expect(normalizeSoundSettings(defaultSettings)).toMatchObject({
      soundSet: "sfx",
      soundSilentCheck: false
    });
  });

  it("keeps an offered set and the check choice", () => {
    const stored = { ...defaultSettings, soundSet: "pychess", soundSilentCheck: true } as const;
    expect(normalizeSoundSettings(stored)).toMatchObject({
      soundSet: "pychess",
      soundSilentCheck: true
    });
  });

  it.each([["standard"], ["robot"], [7], [null], [undefined]])(
    "replaces a set it doesn't ship (%s) with the default",
    (bad) => {
      const stored = { ...defaultSettings, soundSet: bad } as unknown as AppSettings;
      expect(normalizeSoundSettings(stored).soundSet).toBe("sfx");
    }
  );

  it("replaces a check choice that isn't true or false", () => {
    const stored = { ...defaultSettings, soundSilentCheck: "yes" } as unknown as AppSettings;
    expect(normalizeSoundSettings(stored).soundSilentCheck).toBe(false);
  });
});

describe("normalizeOnboardingSettings", () => {
  it("defaults to a welcome that has not been completed and no tips seen", () => {
    const normalized = normalizeOnboardingSettings(defaultSettings);
    expect(normalized.onboardingCompletedAt).toBeNull();
    expect(normalized.onboardingHintsSeen).toStrictEqual([]);
  });

  it("keeps a completion time, including 0 for installs that predate the welcome", () => {
    expect(
      normalizeOnboardingSettings({ ...defaultSettings, onboardingCompletedAt: 1_700_000_000_123 })
        .onboardingCompletedAt
    ).toBe(1_700_000_000_123);
    expect(
      normalizeOnboardingSettings({ ...defaultSettings, onboardingCompletedAt: 0 })
        .onboardingCompletedAt
    ).toBe(0);
  });

  it("reads anything that is not a finite, non-negative number as not completed", () => {
    for (const bad of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1700000000000",
      true,
      {},
      undefined
    ]) {
      const stored = { ...defaultSettings, onboardingCompletedAt: bad } as unknown as AppSettings;
      expect(normalizeOnboardingSettings(stored).onboardingCompletedAt).toBeNull();
    }
  });

  it("keeps known tip ids once each and drops the rest", () => {
    const stored = {
      ...defaultSettings,
      onboardingHintsSeen: ["maia-curve", "unknown", "maia-curve", 3, "commentary-links"]
    } as unknown as AppSettings;
    // "commentary-links" was a tip that's gone: a stored one is dropped like any unknown id.
    expect(normalizeOnboardingSettings(stored).onboardingHintsSeen).toStrictEqual(["maia-curve"]);
    const notAList = {
      ...defaultSettings,
      onboardingHintsSeen: "maia-curve"
    } as unknown as AppSettings;
    expect(normalizeOnboardingSettings(notAList).onboardingHintsSeen).toStrictEqual([]);
  });

  it("is idempotent", () => {
    const once = normalizeOnboardingSettings({
      ...defaultSettings,
      onboardingCompletedAt: 5.7,
      onboardingHintsSeen: ["maia-curve"]
    });
    expect(normalizeOnboardingSettings(once)).toStrictEqual(once);
  });
});
