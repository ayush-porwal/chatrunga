import { describe, expect, it } from "vitest";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { parseSettingValue } from "./settings-values";

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
    expect(parseSettingValue("reviewMaiaLevels", [1100, 1900])).toEqual([1100, 1900]);
    expect(parseSettingValue("onboardingCompletedAt", Date.now())).toBeTypeOf("number");
    expect(parseSettingValue("repertoireCompareWhite", "rep-1")).toBe("rep-1");
    expect(parseSettingValue("repertoireCompareBlack", null)).toBeNull();
    expect(parseSettingValue("practiceAutoAdvanceMs", 0)).toBe(0);
    expect(parseSettingValue("practiceAutoAdvanceMs", 3000)).toBe(3000);
  });

  it("rejects values of the wrong type or out of range", () => {
    expect(() => parseSettingValue("soundVolume", 7)).toThrow(/soundVolume/);
    expect(() => parseSettingValue("showCoordinates", "yes")).toThrow(/setting showCoordinates/);
    expect(() => parseSettingValue("boardTheme", "neon")).toThrow(/setting boardTheme/);
    expect(() => parseSettingValue("reviewMultiPv", 2.5)).toThrow(/setting reviewMultiPv/);
    expect(() => parseSettingValue("engineHashMb", 1)).toThrow(/setting engineHashMb/);
    expect(() => parseSettingValue("reviewMaiaLevels", [1200])).toThrow(/setting reviewMaiaLevels/);
    expect(() => parseSettingValue("recentFilePaths", "path")).toThrow(/setting recentFilePaths/);
    expect(() => parseSettingValue("repertoireCompareWhite", 7)).toThrow(/repertoireCompareWhite/);
    expect(() => parseSettingValue("repertoireCompareBlack", "x".repeat(201))).toThrow(
      /setting repertoireCompareBlack/
    );
    expect(() => parseSettingValue("practiceAutoAdvanceMs", 1000)).toThrow(/practiceAutoAdvanceMs/);
  });
});
