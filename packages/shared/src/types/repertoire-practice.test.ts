import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRACTICE_SETTINGS,
  isRepertoirePracticeSettings,
  normalizeRepertoirePracticeSettings,
  openingFamily
} from "./repertoire-practice";

describe("practice settings", () => {
  it("reads stored settings field by field, a bad field taking its default", () => {
    expect(normalizeRepertoirePracticeSettings(undefined)).toStrictEqual(DEFAULT_PRACTICE_SETTINGS);
    expect(
      normalizeRepertoirePracticeSettings({ newPerDay: null, showMoveOnNew: false, sounds: "x" })
    ).toStrictEqual({ newPerDay: null, showMoveOnNew: false, sounds: true });
    expect(normalizeRepertoirePracticeSettings({ newPerDay: 7 }).newPerDay).toBe(10);
  });

  it("accepts only a whole, valid settings object for a write", () => {
    expect(isRepertoirePracticeSettings(DEFAULT_PRACTICE_SETTINGS)).toBe(true);
    expect(isRepertoirePracticeSettings({ ...DEFAULT_PRACTICE_SETTINGS, newPerDay: 15 })).toBe(
      false
    );
    expect(isRepertoirePracticeSettings({ ...DEFAULT_PRACTICE_SETTINGS, extra: 1 })).toBe(false);
  });
});

describe("openingFamily", () => {
  it("groups openings by the part of the name before the colon", () => {
    expect(openingFamily("Caro-Kann Defense: Advance Variation")).toBe("Caro-Kann Defense");
    expect(openingFamily("London System")).toBe("London System");
  });
});
