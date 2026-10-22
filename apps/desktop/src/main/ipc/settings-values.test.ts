import { describe, expect, it } from "vitest";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { uniformRatings } from "@chaturanga/shared/types/ratings";
import { parseSettingValue, parseSettingWrite } from "./settings-values";

describe("parseSettingValue", () => {
  it("accepts every default", () => {
    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) {
      expect(() => parseSettingValue(key, defaultSettings[key])).not.toThrow();
    }
  });

  it("accepts the values the settings screens write", () => {
    expect(parseSettingValue("soundVolume", 0.35)).toBe(0.35);
    expect(parseSettingValue("boardSquareLight", "#F0D9B5")).toBe("#f0d9b5");
    expect(parseSettingValue("boardSquareDark", " FFFFFF ")).toBe("#ffffff");
    expect(parseSettingValue("engineThreads", 4)).toBe(4);
    expect(parseSettingValue("onboardingCompletedAt", Date.now())).toBeTypeOf("number");
    expect(parseSettingValue("repertoireCompareWhite", "rep-1")).toBe("rep-1");
    expect(parseSettingValue("repertoireCompareBlack", null)).toBeNull();
    expect(parseSettingValue("practiceAutoAdvanceMs", 0)).toBe(0);
    expect(parseSettingValue("practiceAutoAdvanceMs", 3000)).toBe(3000);
    expect(parseSettingValue("analysisPlanArrows", 0)).toBe(0);
    expect(parseSettingValue("analysisPlanArrows", 4)).toBe(4);
    const ratings = {
      ...uniformRatings(1500),
      blitz: { source: "lichess", rating: 1720, syncedAt: Date.now() },
      rapid: { source: "manual", rating: 1650 }
    };
    expect(parseSettingValue("playerRatings", ratings)).toStrictEqual(ratings);
    expect(parseSettingValue("ratingsAccount", "chesscom")).toBe("chesscom");
    expect(parseSettingValue("playOpponent", "pool")).toBe("pool");
    expect(parseSettingValue("playOpponent", null)).toBeNull();
    expect(parseSettingValue("playEngineId", "engine-1")).toBe("engine-1");
    expect(parseSettingValue("playEngineId", null)).toBeNull();
    expect(parseSettingValue("soundSet", "pychess")).toBe("pychess");
    expect(parseSettingValue("soundSilentCheck", true)).toBe(true);
    expect(parseSettingValue("reviewMaiaRating", 1700)).toBe(1700);
    expect(parseSettingValue("reviewMaiaRating", null)).toBeNull();
    expect(parseSettingValue("playMaiaRating", 600)).toBe(600);
    expect(parseSettingValue("playMaiaRating", 2600)).toBe(2600);
  });

  it("rejects values of the wrong type or out of range", () => {
    expect(() => parseSettingValue("soundVolume", 7)).toThrow(/soundVolume/);
    expect(() => parseSettingValue("showCoordinates", "yes")).toThrow(/setting showCoordinates/);
    expect(() => parseSettingValue("boardTheme", "neon")).toThrow(/setting boardTheme/);
    expect(() => parseSettingValue("reviewMultiPv", 2.5)).toThrow(/setting reviewMultiPv/);
    expect(() => parseSettingValue("engineHashMb", 1)).toThrow(/setting engineHashMb/);
    expect(() => parseSettingValue("recentFilePaths", "path")).toThrow(/setting recentFilePaths/);
    expect(() => parseSettingValue("repertoireCompareWhite", 7)).toThrow(/repertoireCompareWhite/);
    expect(() => parseSettingValue("repertoireCompareBlack", "x".repeat(201))).toThrow(
      /setting repertoireCompareBlack/
    );
    expect(() => parseSettingValue("practiceAutoAdvanceMs", 1000)).toThrow(/practiceAutoAdvanceMs/);
    // Off, 2, 3 or 4 moves: never one (that's the best-move arrow), more, or a numeric string.
    expect(() => parseSettingValue("analysisPlanArrows", 1)).toThrow(/analysisPlanArrows/);
    expect(() => parseSettingValue("analysisPlanArrows", 5)).toThrow(/analysisPlanArrows/);
    expect(() => parseSettingValue("analysisPlanArrows", "3")).toThrow(/analysisPlanArrows/);
    expect(() => parseSettingValue("ratingsAccount", "fide")).toThrow(/setting ratingsAccount/);
    expect(() => parseSettingValue("playOpponent", "home")).toThrow(/setting playOpponent/);
    expect(() => parseSettingValue("playEngineId", 7)).toThrow(/setting playEngineId/);
    // Only the sets the app ships: never Lichess's non-free standard or robot sets.
    expect(() => parseSettingValue("soundSet", "standard")).toThrow(/setting soundSet/);
    expect(() => parseSettingValue("soundSet", "robot")).toThrow(/setting soundSet/);
    expect(() => parseSettingValue("soundSilentCheck", "on")).toThrow(/setting soundSilentCheck/);
    // Maia 3's grid only: 600–2600 in steps of 100.
    expect(() => parseSettingValue("reviewMaiaRating", 1650)).toThrow(/setting reviewMaiaRating/);
    expect(() => parseSettingValue("reviewMaiaRating", 500)).toThrow(/setting reviewMaiaRating/);
    expect(() => parseSettingValue("playMaiaRating", 2700)).toThrow(/setting playMaiaRating/);
    expect(() => parseSettingValue("playMaiaRating", "1500")).toThrow(/setting playMaiaRating/);
    // One rating per mode: not the single number older builds stored, nor a mode short or damaged.
    expect(() => parseSettingValue("playerRatings", 1500)).toThrow(/setting playerRatings/);
    const { correspondence: _missing, ...fourModes } = uniformRatings(1500);
    expect(() => parseSettingValue("playerRatings", fourModes)).toThrow(/playerRatings/);
    expect(() =>
      parseSettingValue("playerRatings", {
        ...uniformRatings(1500),
        blitz: { source: "lichess", rating: 1720 }
      })
    ).toThrow(/playerRatings/);
  });
});

describe("piece set ids", () => {
  it("accepts current ids, maps an older build's to the current one, and refuses unknown ones", () => {
    expect(parseSettingValue("pieceStyle", "kosal")).toBe("kosal");
    expect(parseSettingValue("pieceStyle", "kosalo")).toBe("kosal");
    expect(parseSettingValue("pieceStyle", "cburnettCrisp")).toBe("cburnett");
    expect(() => parseSettingValue("pieceStyle", "neon")).toThrow(/setting pieceStyle/);
    expect(() => parseSettingValue("pieceStyle", 7)).toThrow(/setting pieceStyle/);
  });

  it("writes a setting alone: an older combined set id as just its set", () => {
    expect(parseSettingWrite("pieceStyle", "cburnettSoft")).toStrictEqual({
      pieceStyle: "cburnett"
    });
    expect(parseSettingWrite("pieceSizes", "uniform")).toStrictEqual({ pieceSizes: "uniform" });
    expect(() => parseSettingValue("pieceSizes", "tall")).toThrow(/setting pieceSizes/);
    expect(parseSettingWrite("soundVolume", 0.5)).toStrictEqual({ soundVolume: 0.5 });
  });
});
