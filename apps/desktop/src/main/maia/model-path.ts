import { getAssetManager, type AssetStatus } from "../engine/asset-manager";

/**
 * Test hook: `CHATURANGA_E2E_MAIA3=fixture` runs a deterministic stand-in for Maia 3 (see
 * fixture-evaluator.ts) so end-to-end tests never download the model. Unset in normal use.
 */
export function usesMaia3Fixture(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CHATURANGA_E2E_MAIA3 === "fixture";
}

/** What the Maia row records as its model with the fixture on (no file is read). */
const FIXTURE_MODEL_PATH = "maia3-fixture.onnx";

/** The installed Maia 3 model file (the `maia3` asset), or null while it isn't installed. */
export function maia3ModelPath(): string | null {
  if (usesMaia3Fixture()) return FIXTURE_MODEL_PATH;
  const record = getAssetManager().getInstalled().maia3;
  if (record.state !== "installed" && record.state !== "custom") return null;
  return record.customPath ?? record.installedPath ?? null;
}

/**
 * The asset status the renderer is sent (`assets:status` and the like). With the fixture on, Maia 3
 * reads as installed and up to date, as its engine row does (the fixture stands in for the model),
 * so Review, Play and Settings offer Maia rather than its download. Otherwise `status` as it is.
 */
export function withMaia3Fixture<S extends { maia3: AssetStatus }>(
  status: S,
  env: NodeJS.ProcessEnv = process.env
): S {
  if (!usesMaia3Fixture(env)) return status;
  const version = status.maia3.latestVersion;
  return {
    ...status,
    maia3: {
      ...status.maia3,
      state: "installed",
      installedPath: FIXTURE_MODEL_PATH,
      customPath: null,
      manifestVersion: version,
      version,
      installedVersion: version,
      updateAvailable: false
    }
  };
}
