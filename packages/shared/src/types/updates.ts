/**
 * In-app updates (main/updater.ts). The main process owns the state; the renderer reads it with
 * `updates.getState()` and follows `events.onUpdateState`.
 */

/**
 * How this build updates itself:
 * - `auto`: electron-updater downloads and installs (Windows NSIS, Linux AppImage, signed macOS).
 * - `manual`: the app only checks; "Download" opens the installer in the browser (unsigned macOS,
 *   Linux outside an AppImage).
 * - `disabled`: no checks at all (development builds).
 */
export type UpdateMode = "auto" | "manual" | "disabled";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; notes: string; sizeBytes: number | null; releaseDate: string | null }
  | {
      kind: "downloading";
      version: string;
      notes: string;
      releaseDate: string | null;
      percent: number;
      transferredBytes: number;
      totalBytes: number;
    }
  | { kind: "ready"; version: string; notes: string; releaseDate: string | null }
  /** `url`: the installer for this platform/arch, or the release page. Opened by `updates.openDownload()`. */
  | { kind: "manual"; version: string; notes: string; sizeBytes: number | null; releaseDate: string | null; url: string }
  | { kind: "error"; message: string }
  | { kind: "disabled"; message: string };

export type UpdateState = {
  status: UpdateStatus;
  mode: UpdateMode;
  /** `app.getVersion()`. */
  currentVersion: string;
  /** Epoch ms of the last finished check (this session), or null. */
  lastCheckedAt: number | null;
  /** Downloads start on their own (the `updatesAutoDownload` setting, `auto` mode only). */
  autoDownload: boolean;
  /** Prereleases are offered: this build is one (a nightly); production builds never get them. */
  allowPrerelease: boolean;
  /** Why the mode is `manual` / `disabled`, in one sentence (null for `auto`). */
  modeReason: string | null;
};
