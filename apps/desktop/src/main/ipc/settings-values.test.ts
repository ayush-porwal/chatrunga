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
    expect(parseSettingValue("boardSquareLight", "#F0D9B5")).toBe("#F0D9B5");
    expect(parseSettingValue("engineThreads", 4)).toBe(4);
    expect(parseSettingValue("reviewMaiaLevels", [1100, 1900])).toEqual([1100, 1900]);
    expect(parseSettingValue("onboardingCompletedAt", Date.now())).toBeTypeOf("number");
  });

  it("rejects values of the wrong type or out of range", () => {
    expect(() => parseSettingValue("soundVolume", 7)).toThrow(/soundVolume/);
    expect(() => parseSettingValue("showCoordinates", "yes")).toThrow();
    expect(() => parseSettingValue("boardTheme", "neon")).toThrow();
    expect(() => parseSettingValue("reviewMultiPv", 2.5)).toThrow();
    expect(() => parseSettingValue("engineHashMb", 1)).toThrow();
    expect(() => parseSettingValue("reviewMaiaLevels", [1200])).toThrow();
    expect(() => parseSettingValue("recentFilePaths", "path")).toThrow();
  });
});
