import { describe, expect, it } from "vitest";
import {
  GLASS_BACKGROUND,
  GLASS_VIBRANCY,
  OPAQUE_BACKGROUND,
  resolveWindowGlassState,
  sameGlassState,
  windowGlassOptions
} from "./window-glass-state";

describe("resolveWindowGlassState", () => {
  it("is active on macOS with the setting on and Reduce transparency off", () => {
    const state = resolveWindowGlassState({ platform: "darwin", enabled: true, reducedTransparency: false });
    expect(state).toEqual({ supported: true, enabled: true, reducedTransparency: false, active: true });
  });

  it("turns off when the user disables it or the system reduces transparency", () => {
    expect(resolveWindowGlassState({ platform: "darwin", enabled: false, reducedTransparency: false }).active).toBe(false);
    const reduced = resolveWindowGlassState({ platform: "darwin", enabled: true, reducedTransparency: true });
    expect(reduced).toMatchObject({ active: false, enabled: true, reducedTransparency: true });
  });

  it("is never supported off macOS", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(resolveWindowGlassState({ platform, enabled: true, reducedTransparency: true })).toEqual({
        supported: false,
        enabled: true,
        reducedTransparency: false,
        active: false
      });
    }
  });
});

describe("windowGlassOptions", () => {
  it("maps an active state to vibrancy over a transparent background, otherwise opaque", () => {
    const on = resolveWindowGlassState({ platform: "darwin", enabled: true, reducedTransparency: false });
    const off = { ...on, enabled: false, active: false };
    expect(windowGlassOptions(on)).toEqual({ vibrancy: GLASS_VIBRANCY, backgroundColor: GLASS_BACKGROUND });
    expect(windowGlassOptions(off)).toEqual({ vibrancy: null, backgroundColor: OPAQUE_BACKGROUND });
  });
});

describe("sameGlassState", () => {
  it("compares every field", () => {
    const a = resolveWindowGlassState({ platform: "darwin", enabled: true, reducedTransparency: false });
    expect(sameGlassState(a, { ...a })).toBe(true);
    expect(sameGlassState(a, { ...a, reducedTransparency: true })).toBe(false);
  });
});
