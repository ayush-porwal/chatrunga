import { describe, expect, it, vi } from "vitest";
import { isExistingInstall, migrateOnboarding, type InstallTraces } from "./onboarding-migration";

const fresh: InstallTraces = {
  settingKeys: [],
  games: 0,
  engines: 0,
  engineAssetState: false,
  openRouterConfig: false
};

describe("isExistingInstall", () => {
  it("treats an empty profile as a new install", () => {
    expect(isExistingInstall(fresh)).toBe(false);
  });

  it("ignores the welcome's own settings", () => {
    expect(
      isExistingInstall({ ...fresh, settingKeys: ["onboardingCompletedAt", "onboardingHintsSeen"] })
    ).toBe(false);
  });

  it("recognises any trace of earlier use", () => {
    expect(isExistingInstall({ ...fresh, settingKeys: ["boardTheme"] })).toBe(true);
    expect(isExistingInstall({ ...fresh, games: 1 })).toBe(true);
    expect(isExistingInstall({ ...fresh, engines: 2 })).toBe(true);
    expect(isExistingInstall({ ...fresh, engineAssetState: true })).toBe(true);
    expect(isExistingInstall({ ...fresh, openRouterConfig: true })).toBe(true);
  });
});

describe("migrateOnboarding", () => {
  it("marks an install with engines as predating the welcome", () => {
    const set = vi.fn();
    const result = migrateOnboarding({
      getStored: () => undefined,
      set,
      traces: () => ({ ...fresh, engineAssetState: true })
    });
    expect(result).toBe("existing");
    expect(set).toHaveBeenCalledWith(0);
  });

  it("stores an explicit null for a new install, so the welcome shows", () => {
    const set = vi.fn();
    expect(migrateOnboarding({ getStored: () => undefined, set, traces: () => fresh })).toBe("new");
    expect(set).toHaveBeenCalledWith(null);
  });

  it("never runs again once a value is stored (null included)", () => {
    for (const stored of [null, 0, 1_700_000_000_000]) {
      const set = vi.fn();
      const traces = vi.fn(() => ({ ...fresh, games: 3 }));
      expect(migrateOnboarding({ getStored: () => stored, set, traces })).toBe("unchanged");
      expect(set).not.toHaveBeenCalled();
      expect(traces).not.toHaveBeenCalled();
    }
  });
});
