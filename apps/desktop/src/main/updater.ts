/**
 * In-app updates through electron-updater, reading the feed electron-builder writes from
 * `build.publish` (Resources/app-update.yml: GitHub releases of the configured repo).
 *
 * Per platform (decided in `resolveUpdateMode`):
 * - Windows (NSIS), Linux AppImage, Developer-ID-signed macOS: check → download in the background
 *   (the `updatesAutoDownload` setting) → "Restart to update" (`install()`).
 * - Unsigned macOS (ad-hoc builds; Squirrel.Mac refuses them) and Linux outside an AppImage: check
 *   only; `openDownload()` opens the installer for this CPU (or the release page) in the browser.
 * - Development (`!app.isPackaged`): disabled.
 *
 * Checks run shortly after startup and every 6 hours. Failures never throw out of here: they become
 * an `error` status with one readable sentence.
 *
 * Test hook: `CHATURANGA_UPDATE_FEED_URL=<http(s) url>` points a packaged build at a generic feed
 * (a folder with `latest*.yml`) instead of GitHub. Unset in normal use.
 */
import { app, shell } from "electron";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater";
import type { UpdateState, UpdateStatus } from "@chaturanga/shared/types/updates";
import { settingsRepository } from "./db/repositories";
import { errorMessage, logger } from "./logger";
import {
  isAllowedDownloadUrl,
  isCheckBlocked,
  isDeveloperIdSigned,
  manualDownloadUrl,
  parseAppUpdateConfig,
  readableUpdateError,
  reduceUpdateStatus,
  resolveUpdateMode,
  shouldAllowPrerelease,
  type UpdateEvent,
  type UpdateFeedConfig
} from "./updater-state";

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FEED_OVERRIDE_ENV = "CHATURANGA_UPDATE_FEED_URL";

type UpdaterEvents = { state: [UpdateState] };

class UpdateService extends EventEmitter<UpdaterEvents> {
  private state: UpdateState = {
    status: { kind: "idle" },
    mode: "disabled",
    currentVersion: app.getVersion(),
    lastCheckedAt: null,
    autoDownload: false,
    allowPrerelease: false,
    modeReason: null
  };
  private updater: AppUpdater | null = null;
  private feed: UpdateFeedConfig | null = null;
  private feedOverride: string | null = null;
  private prepareForInstall: () => void = () => {};
  private started: Promise<void> | null = null;

  /** Resolves the mode, configures electron-updater and schedules checks. Safe to call once. */
  start(options: { prepareForInstall: () => void }): Promise<void> {
    this.prepareForInstall = options.prepareForInstall;
    this.started ??= this.init().catch((error) => {
      logger.error("updater", "init failed:", error);
      this.setStatus({ kind: "error", message: readableUpdateError(error, "check") });
    });
    return this.started;
  }

  getState(): UpdateState {
    return this.state;
  }

  /** "Check for updates". Resolves with the state after the check finished (or was skipped). */
  async check(): Promise<UpdateState> {
    await this.started;
    const updater = this.updater;
    if (!updater || isCheckBlocked(this.state.status)) return this.state;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      // electron-updater also emits "error" (handled there); this only guards the promise.
      logger.warn("updater", "check failed:", errorMessage(error));
      if (this.state.status.kind === "checking") this.dispatch({ type: "error", error });
    }
    return this.state;
  }

  /** Starts the download of an available update (auto mode, when background downloads are off). */
  async download(): Promise<UpdateState> {
    await this.started;
    const updater = this.updater;
    if (!updater || this.state.mode !== "auto" || this.state.status.kind !== "available") return this.state;
    this.dispatch({ type: "download-started" });
    updater.downloadUpdate().catch((error) => logger.warn("updater", "download failed:", errorMessage(error)));
    return this.state;
  }

  /** "Restart to update": stops engines and closes the database, then quits into the installer. */
  install(): boolean {
    const updater = this.updater;
    if (!updater || this.state.status.kind !== "ready") return false;
    try {
      this.prepareForInstall();
    } catch (error) {
      logger.error("updater", "cleanup before install failed:", error);
    }
    logger.info("updater", `installing ${this.state.status.version}`);
    // Silent: the assisted NSIS installer would otherwise show its wizard again; relaunch afterwards.
    setImmediate(() => {
      try {
        updater.quitAndInstall(true, true);
      } catch (error) {
        logger.error("updater", "quitAndInstall failed:", error);
        this.setStatus({ kind: "error", message: readableUpdateError(error, "install") });
      }
    });
    return true;
  }

  /** Manual path: opens the installer / release page in the browser (allow-listed URLs only). */
  async openDownload(): Promise<boolean> {
    const status = this.state.status;
    if (status.kind !== "manual") return false;
    if (!isAllowedDownloadUrl(status.url, this.feedOverride)) {
      logger.warn("updater", "refused to open download url:", status.url);
      return false;
    }
    await shell.openExternal(status.url);
    return true;
  }

  /** Re-reads the update settings (after Settings changed one) and applies them. */
  applySettings(): void {
    const updater = this.updater;
    if (!updater) return;
    const before = this.state.allowPrerelease;
    this.configure(updater);
    if (this.state.allowPrerelease !== before) void this.check();
    else if (this.state.autoDownload && this.state.status.kind === "available") void this.download();
  }

  private async init(): Promise<void> {
    const macSigned = process.platform === "darwin" && app.isPackaged ? await isRunningAppDeveloperIdSigned() : false;
    const { mode, reason } = resolveUpdateMode({
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      macSigned
    });
    this.state = { ...this.state, mode, modeReason: reason };
    logger.info("updater", `mode ${mode} (version ${this.state.currentVersion}, ${process.platform}-${process.arch})`);
    if (mode === "disabled") {
      this.setStatus({ kind: "disabled", message: reason ?? "" });
      return;
    }

    this.feedOverride = parseFeedOverride(process.env[FEED_OVERRIDE_ENV]);
    this.feed = this.feedOverride
      ? { provider: "generic", url: this.feedOverride }
      : parseAppUpdateConfig(await readFile(join(process.resourcesPath, "app-update.yml"), "utf8"));
    if (!this.feed) throw new Error("app-update.yml names no update feed");

    const updater = await loadAutoUpdater();
    updater.logger = {
      info: (message?: unknown) => logger.info("updater", message),
      warn: (message?: unknown) => logger.warn("updater", message),
      // electron-updater logs every failed check as an error; the status carries it already.
      error: (message?: unknown) => logger.warn("updater", message)
    };
    if (this.feedOverride) {
      logger.info("updater", `using test feed ${this.feedOverride}`);
      updater.setFeedURL({ provider: "generic", url: this.feedOverride });
    }
    updater.allowDowngrade = false;
    updater.autoInstallOnAppQuit = mode === "auto";
    this.configure(updater);
    this.subscribe(updater);
    this.updater = updater;

    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS).unref();
    setInterval(() => void this.check(), CHECK_INTERVAL_MS).unref();
  }

  private configure(updater: AppUpdater): void {
    const settings = settingsRepository.getAll();
    const autoDownload = this.state.mode === "auto" && settings.updatesAutoDownload;
    const allowPrerelease = shouldAllowPrerelease(this.state.currentVersion, settings.updatesIncludeBeta);
    updater.autoDownload = autoDownload;
    updater.allowPrerelease = allowPrerelease;
    this.state = { ...this.state, autoDownload, allowPrerelease };
    this.emit("state", this.state);
  }

  private subscribe(updater: AppUpdater): void {
    updater.on("checking-for-update", () => this.dispatch({ type: "checking" }));
    updater.on("update-not-available", () => this.dispatch({ type: "not-available" }, { checked: true }));
    updater.on("update-available", (info: UpdateInfo) => {
      const manualUrl = this.state.mode === "manual" && this.feed ? manualDownloadUrl(this.feed, info, downloadTarget()) : null;
      logger.info("updater", `update available: ${info.version}${manualUrl ? ` (manual: ${manualUrl})` : ""}`);
      this.dispatch({ type: "available", info, manualUrl }, { checked: true });
      if (!manualUrl && updater.autoDownload) this.dispatch({ type: "download-started" });
    });
    updater.on("download-progress", (progress: ProgressInfo) =>
      this.dispatch({ type: "progress", percent: progress.percent, transferred: progress.transferred, total: progress.total })
    );
    updater.on("update-downloaded", (info: UpdateInfo) => {
      logger.info("updater", `update downloaded: ${info.version}`);
      this.dispatch({ type: "downloaded", info });
    });
    updater.on("error", (error: Error) => {
      const checking = this.state.status.kind === "checking";
      this.dispatch({ type: "error", error }, { checked: checking });
    });
  }

  private dispatch(event: UpdateEvent, options: { checked?: boolean } = {}): void {
    const status = reduceUpdateStatus(this.state.status, event);
    this.state = { ...this.state, status, lastCheckedAt: options.checked ? Date.now() : this.state.lastCheckedAt };
    this.emit("state", this.state);
  }

  private setStatus(status: UpdateStatus): void {
    this.state = { ...this.state, status };
    this.emit("state", this.state);
  }
}

export const updateService = new UpdateService();

/** electron-updater, loaded only in packaged builds (it patches `fs` and constructs a platform updater). */
async function loadAutoUpdater(): Promise<AppUpdater> {
  const module = (await import("electron-updater")) as { autoUpdater?: AppUpdater; default?: { autoUpdater: AppUpdater } };
  const updater = module.autoUpdater ?? module.default?.autoUpdater;
  if (!updater) throw new Error("electron-updater did not load");
  return updater;
}

/** Platform + CPU to pick an installer for; an x64 build under Rosetta gets the native arm64 one. */
function downloadTarget(): { platform: NodeJS.Platform; arch: string } {
  return { platform: process.platform, arch: app.runningUnderARM64Translation ? "arm64" : process.arch };
}

function parseFeedOverride(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Whether the running .app carries a Developer ID signature (`codesign -dv` names a team). */
function isRunningAppDeveloperIdSigned(): Promise<boolean> {
  const bundle = resolve(process.execPath, "../../..");
  return new Promise((done) => {
    execFile("/usr/bin/codesign", ["-dv", "--verbose=2", bundle], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        logger.warn("updater", "codesign check failed:", errorMessage(error));
        done(false);
        return;
      }
      done(isDeveloperIdSigned(`${stdout}\n${stderr}`));
    });
  });
}
