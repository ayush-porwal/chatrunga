import { describe, expect, it, vi } from "vitest";
import type { AssetStatus } from "../engine/asset-manager";
import { usesMaia3Fixture, withMaia3Fixture } from "./model-path";

// The real asset manager needs Electron's app; these functions never ask it.
vi.mock("../engine/asset-manager", () => ({ getAssetManager: vi.fn() }));

/** Maia 3 as the asset manager reports it before a download. */
const MISSING: AssetStatus = {
  id: "maia3",
  state: "missing",
  installedPath: null,
  customPath: null,
  sha256: null,
  manifestVersion: null,
  version: null,
  source: null,
  sizeBytes: 0,
  installedAt: null,
  installedVersion: null,
  latestVersion: "0013cc8e",
  updateAvailable: false,
  downloadSizeBytes: 45_683_686,
  latestSource: "fixed",
  autoDownload: true,
  installInstructions: null,
  checkedAt: null,
  checkError: null
};

const FIXTURE_ENV = { CHATURANGA_E2E_MAIA3: "fixture" };

describe("usesMaia3Fixture", () => {
  it("is on only for CHATURANGA_E2E_MAIA3=fixture", () => {
    expect(usesMaia3Fixture(FIXTURE_ENV)).toBe(true);
    expect(usesMaia3Fixture({})).toBe(false);
    expect(usesMaia3Fixture({ CHATURANGA_E2E_MAIA3: "1" })).toBe(false);
  });
});

describe("withMaia3Fixture", () => {
  it("leaves the status alone without the fixture", () => {
    const status = { maia3: MISSING, other: 1 };
    expect(withMaia3Fixture(status, {})).toBe(status);
    expect(withMaia3Fixture(status, { CHATURANGA_E2E_MAIA3: "real" })).toBe(status);
  });

  it("reports Maia 3 installed and up to date with the fixture, touching nothing else", () => {
    const other = { state: "missing" };
    const status = { maia3: MISSING, other };
    const shown = withMaia3Fixture(status, FIXTURE_ENV);
    expect(shown.other).toBe(other);
    expect(shown.maia3).toStrictEqual({
      ...MISSING,
      state: "installed",
      installedPath: "maia3-fixture.onnx",
      manifestVersion: "0013cc8e",
      version: "0013cc8e",
      installedVersion: "0013cc8e",
      updateAvailable: false
    });
    // The real status isn't changed in place.
    expect(status.maia3).toBe(MISSING);
  });
});
