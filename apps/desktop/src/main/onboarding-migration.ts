/**
 * Decides, once per install, whether the first-run welcome belongs to this user.
 *
 * The welcome is for new installs. Someone upgrading from a build without it already has a
 * library, engines or settings, and must not be walked through setup again. On the first launch
 * of a build with the welcome, `onboardingCompletedAt` has no stored row yet: an install with any
 * trace of earlier use gets `0` ("predates the welcome"), a genuinely new one gets an explicit
 * `null` ("show it"). Either way the row now exists, so this never runs again — quitting half way
 * through the welcome brings it back next launch instead of reclassifying the user as existing.
 */

/** Evidence of use by an earlier build (or of this one, before the welcome finished). */
export type InstallTraces = {
  /** Stored setting keys, whatever their values. */
  settingKeys: readonly string[];
  /** Saved library games. */
  games: number;
  /** Engines in the engines table (added by hand or synced from downloads). */
  engines: number;
  /** Downloaded puzzle / analysis databases. */
  databases: number;
  /** The engine download manager has state on disk (`engine-assets.json`). */
  engineAssetState: boolean;
  /** An OpenRouter config file exists (a key or model was saved). */
  openRouterConfig: boolean;
};

/** Setting rows written by the welcome itself, which say nothing about earlier use. */
const ONBOARDING_KEYS = new Set(["onboardingCompletedAt", "onboardingHintsSeen"]);

export function isExistingInstall(traces: InstallTraces): boolean {
  return (
    traces.settingKeys.some((key) => !ONBOARDING_KEYS.has(key)) ||
    traces.games > 0 ||
    traces.engines > 0 ||
    traces.databases > 0 ||
    traces.engineAssetState ||
    traces.openRouterConfig
  );
}

/**
 * Writes the install's classification when none is stored. Returns what it wrote
 * (`"existing"` / `"new"`), or `"unchanged"` when the setting was already stored.
 */
export function migrateOnboarding(deps: {
  getStored: () => unknown;
  set: (value: number | null) => void;
  traces: () => InstallTraces;
}): "existing" | "new" | "unchanged" {
  if (deps.getStored() !== undefined) return "unchanged";
  if (isExistingInstall(deps.traces())) {
    deps.set(0);
    return "existing";
  }
  deps.set(null);
  return "new";
}
