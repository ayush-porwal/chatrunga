import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDesktopApi, isElectronMac } from "./environment";

describe("environment helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects when the desktop preload API is unavailable", () => {
    vi.stubGlobal("window", {});

    expect(hasDesktopApi()).toBe(false);
    expect(isElectronMac()).toBe(false);
  });

  it("detects Electron on macOS", () => {
    vi.stubGlobal("window", {
      chaturanga: {
        environment: { isElectron: true, platform: "darwin" }
      }
    });

    expect(hasDesktopApi()).toBe(true);
    expect(isElectronMac()).toBe(true);
  });
});
