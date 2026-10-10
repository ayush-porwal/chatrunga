import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents
} from "electron";
import { canonicalImagePath, isServableImage } from "./image-access";
import { guardIpcSenders } from "./ipc-guard";
import { cancelAllDownloads } from "./databases/external-databases";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeCommentaryProvider } from "@chaturanga/shared/types/settings";
import { closeDb, getDb } from "./db";
import {
  engineRepository,
  externalDatabaseRepository,
  gameRepository,
  settingsRepository
} from "./db/repositories";
import { EngineManager } from "./engine/engine-manager";
import { killAllEngineProcesses } from "./engine/uci-process";
import { registerIpc } from "./ipc/register";
import { shutdownLichess } from "./lichess";
import { shutdownChesscom } from "./chesscom";
import { startAccountRatingSyncs } from "./accounts";
import { errorMessage, logger } from "./logger";
import { migrateOnboarding } from "./onboarding-migration";
import { migratePlayerRatings } from "./rating-migration";
import { updateService } from "./updater";
import {
  isAppUrl,
  isExternalHttpUrl,
  isPermissionAllowed,
  localImagePathFromUrl,
  PRODUCTION_CSP
} from "./security";
import { installWindowGlass, windowGlassConstructorOptions } from "./window-glass";
import { requestRendererFlush, type FlushResult } from "./renderer-flush";
import { getTelemetry, initTelemetry } from "./telemetry";
import { resolveTelemetryConfig, usageAnalyticsConsent } from "./telemetry/config";
import { noteEngineReadiness } from "./telemetry/engine-readiness";
import { rescueLegacyDatasets } from "./databases/dataset-location";

const PRODUCT_NAME = "Chaturanga";
const IMAGE_SCHEME = "chaturanga-image";
const currentDir = dirname(fileURLToPath(import.meta.url));
const rendererIndex = join(currentDir, "../renderer/index.html");
/** Dev: the Vite server; production: the bundled page. */
const appUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererIndex).href;

process.on("uncaughtException", (error) => logger.error("main", "uncaught exception:", error));
process.on("unhandledRejection", (reason) => logger.error("main", "unhandled rejection:", reason));

app.setName(PRODUCT_NAME);
// The profile, set before the single-instance lock (which is scoped to it). Development builds
// (`pnpm dev`) keep their own: sharing the installed app's would share its lock too, and with the
// installed app open `pnpm dev` would quit and bring that (older) app forward instead of opening.
// Dev/test hook: CHATURANGA_USER_DATA_DIR points the app at a throwaway profile (UI automation,
// clean-install checks). Unset in normal use.
const userDataOverride = process.env.CHATURANGA_USER_DATA_DIR;
// Test hook: the e2e harness sets CHATURANGA_E2E_BACKGROUND so its windows never show on screen
// (they still load, lay out and run; the harness drives them over the DevTools protocol) and the
// developer keeps working undisturbed. Unset in normal use.
const openInBackground = process.env.CHATURANGA_E2E_BACKGROUND === "1";
app.setPath(
  "userData",
  userDataOverride ?? join(app.getPath("appData"), app.isPackaged ? "chaturanga" : "chaturanga-dev")
);
if (userDataOverride) app.setAppLogsPath(join(userDataOverride, "logs"));
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const engineManager = new EngineManager();
let mainWindow: BrowserWindow | null = null;
/** A quit is under way: once a window's pending save is written, the quit continues. */
let quitRequested = false;
/** Cleanup ran (quit, or an update install): windows close without asking the renderer. */
let shutDown = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Only the instance that owns the profile, and before Chromium starts: Chromium deletes
  // `<userData>/databases`, where datasets used to be kept.
  try {
    const moved = rescueLegacyDatasets(app.getPath("userData"));
    if (moved.length)
      logger.info("databases", `moved ${moved.length} dataset file(s) out of Chromium's folder`);
  } catch (error) {
    logger.error("databases", "moving datasets out of Chromium's folder failed:", error);
  }
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));
  app.on("child-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit")
      logger.error("main", "child process gone:", details.type, details.reason);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("before-quit", () => {
    if (!quitRequested) logger.info("main", "quit requested");
    quitRequested = true;
  });
  app.on("will-quit", (event) => {
    if (shutdownDone) return;
    // Held until running downloads have stopped, then quit again (this time straight through).
    event.preventDefault();
    void shutdown()
      .catch((error: unknown) => logger.error("main", "shutdown failed:", error))
      // Not before this event has returned: a quit asked for during `will-quit` is ignored, and
      // with nothing to wait for, shutdown settles that soon.
      .finally(() => setImmediate(() => app.quit()));
  });
  app.on("quit", (_event, exitCode) => logger.info("main", `exiting (code ${exitCode})`));
  app.whenReady().then(startup, (error) => {
    logger.error("main", "startup failed:", error);
    app.quit();
  });
}

async function startup(): Promise<void> {
  // Before any IPC handler is registered.
  guardIpcSenders(appUrl);
  getDb();
  try {
    migrateCommentaryProvider();
  } catch (error) {
    logger.error("settings", "commentary provider migration failed:", error);
  }
  try {
    classifyInstallForOnboarding();
  } catch (error) {
    logger.error("settings", "onboarding migration failed:", error);
  }
  try {
    const result = migratePlayerRatings({
      storedRatings: () => settingsRepository.getStored("playerRatings"),
      legacyRating: () => settingsRepository.getStored("reviewPlayerRating"),
      set: (ratings) => settingsRepository.set("playerRatings", ratings)
    });
    if (result === "migrated") logger.info("settings", "ratings: one rating per mode");
  } catch (error) {
    logger.error("settings", "ratings migration failed:", error);
  }
  startTelemetry();
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(isPermissionAllowed(permission))
  );
  installLocalImageProtocol();
  // The UI is dark-only: native surfaces (window vibrancy material, menus, dialogs) follow it.
  nativeTheme.themeSource = "dark";
  installWindowGlass();
  installWindowReveal();
  registerIpc(engineManager);
  try {
    startAccountRatingSyncs();
  } catch (error) {
    logger.error("settings", "starting the ratings sync failed:", error);
  }
  installApplicationMenu();
  const icon = createAppIcon();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);
  // No Dock icon and no activation.
  if (openInBackground && process.platform === "darwin") app.setActivationPolicy("accessory");
  createWindow();
  // Quitting into an installer runs the same cleanup as a normal quit, first.
  void updateService.start({
    prepareForInstall: async () => {
      // The installer quits without the usual close path: write pending saves first, and if one
      // failed (or the renderer didn't answer), ask before losing it (Cancel keeps the app open to
      // retry; no install then). Only this part can fail: shutdown() doesn't throw.
      for (const window of BrowserWindow.getAllWindows()) {
        const saved = (await flushLogged(window, "install")) === "saved";
        if (!saved && !window.isDestroyed() && !confirmCloseUnsaved(window)) return false;
      }
      await shutdown();
      return true;
    }
  });
}

/**
 * Usage analytics (docs/telemetry.md): on when this build has a project and the environment allows
 * it, unless the user turned it off. A failure here never stops the app from starting.
 */
function startTelemetry(): void {
  try {
    initTelemetry({
      config: resolveTelemetryConfig({
        env: process.env,
        isPackaged: app.isPackaged,
        token: import.meta.env.MAIN_VITE_POSTHOG_PROJECT_TOKEN,
        host: import.meta.env.MAIN_VITE_POSTHOG_HOST
      }),
      database: getDb,
      consent: () => usageAnalyticsConsent(settingsRepository.getStored("usageAnalyticsEnabled")),
      // Chromium's network stack: system proxy settings apply.
      fetchImpl: (input, init) => net.fetch(input, init),
      appVersion: app.getVersion(),
      buildChannel: import.meta.env.MAIN_VITE_RELEASE_CHANNEL,
      platform: process.platform,
      arch: process.arch,
      log: (message, error) =>
        logger.warn("telemetry", message, error === undefined ? "" : errorMessage(error))
    });
    noteEngineReadiness(true);
  } catch (error) {
    logger.error("telemetry", "starting usage analytics failed:", error);
  }
}

let shuttingDown: Promise<void> | null = null;
/** Set once shutdown has finished: the held `will-quit` goes through. */
let shutdownDone = false;

/**
 * Stops engines, closes Lichess connections (streams, seek, sign-in server), stops a chess.com
 * import, and closes the database.
 * Idempotent: an update install runs it before `will-quit` does. Never throws, and a failed step
 * doesn't skip the rest: once it has started, the app is on its way out (an install that follows
 * must not stop at a half-closed app).
 */
function shutdown(): Promise<void> {
  shuttingDown ??= (async () => {
    shutDown = true;
    const steps: [string, () => void | Promise<void>][] = [
      ["lichess", shutdownLichess],
      ["chess.com", shutdownChesscom],
      ["reviews", () => engineManager.cancelAllReviews()],
      ["engines", () => void engineManager.dispose()],
      ["engine processes", killAllEngineProcesses],
      // Before the database closes: a download finishing now couldn't register its dataset.
      ["downloads", () => cancelAllDownloads()],
      // Also before it closes, and time-bounded: what isn't sent stays queued for the next launch.
      ["usage analytics", () => getTelemetry()?.shutdown()],
      ["database", closeDb]
    ];
    for (const [name, step] of steps) {
      const started = Date.now();
      logger.info("main", `shutdown: closing ${name}`);
      try {
        await step();
      } catch (error) {
        logger.error("main", `shutdown: closing ${name} failed:`, error);
      }
      logger.info("main", `shutdown: closed ${name} (${Date.now() - started} ms)`);
    }
    // The held `will-quit` goes through now.
    shutdownDone = true;
  })();
  return shuttingDown;
}

/**
 * Every webContents stays on the app page: http(s) links (`target=_blank`
 * or plain navigations) open in the OS browser, anything else is dropped,
 * and no child windows or webviews are ever created.
 */
function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url, appUrl)) return;
    event.preventDefault();
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("render-process-gone", (_event, details) => {
    logger.error("main", "renderer process gone:", details.reason);
    if (details.reason !== "clean-exit" && details.reason !== "killed" && !contents.isDestroyed())
      contents.reload();
  });
}

function createWindow(): void {
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: PRODUCT_NAME,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    icon: createAppIcon(),
    // Hidden until the renderer has committed its first real frame (see installWindowReveal):
    // no blank or bare-frosted window at launch.
    show: false,
    ...windowGlassConstructorOptions(),
    webPreferences: {
      // CommonJS build: sandboxed preloads cannot be ES modules.
      preload: join(currentDir, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // A window kept off screen: its timers and frames keep full speed, as they would in front.
      backgroundThrottling: !openInBackground
    }
  });
  mainWindow = window;
  // Off screen, the window is silent too: a test run plays no move sounds.
  if (openInBackground) window.webContents.setAudioMuted(true);
  flushSavesBeforeClose(window);
  // Fallback reveal if the renderer never reports ready (a crash before React mounts).
  window.once("ready-to-show", () => setTimeout(() => revealWindow(window), REVEAL_FALLBACK_MS));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    // The engine work belongs to the window (macOS keeps the app alive): the interactive engine
    // shuts down and running reviews are cancelled.
    void engineManager.dispose();
    engineManager.cancelAllReviews();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [PRODUCTION_CSP] }
      });
    });
    void window.loadFile(rendererIndex);
  }
}

/**
 * The first close (the close button, or a quit) waits for the renderer to write its pending
 * autosave, then closes for real — continuing the quit if one was under way (preventing a close
 * during a quit cancels the quit).
 */
function flushSavesBeforeClose(window: BrowserWindow): void {
  // "flushing": the save is being written, so another close (a second click, or a quit) waits
  // for it too. "closing": written, so the close that follows goes through.
  let phase: "open" | "flushing" | "closing" = "open";
  window.on("close", (event) => {
    if (phase === "closing" || shutDown || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (phase === "flushing") return;
    phase = "flushing";
    void flushLogged(window, "close").then((result) => {
      if (result !== "saved" && !window.isDestroyed() && !confirmCloseUnsaved(window)) {
        // Stay open so the titlebar's Retry can save it.
        phase = "open";
        quitRequested = false;
        return;
      }
      phase = "closing";
      if (quitRequested) app.quit();
      else if (!window.isDestroyed()) window.close();
    });
  });
}

/** Writes the window's pending saves (requestRendererFlush), logging how it ended and how long it took. */
async function flushLogged(window: BrowserWindow, reason: string): Promise<FlushResult> {
  const started = Date.now();
  const result = await requestRendererFlush(window.webContents);
  logger.info("main", `${reason}: pending saves ${result} (${Date.now() - started} ms)`);
  return result;
}

/**
 * A save failed (a game's, a study chapter's, or a repertoire's prompt, hint or other change in
 * any repertoire): close anyway (losing the latest changes), or stay to retry?
 */
function confirmCloseUnsaved(window: BrowserWindow): boolean {
  const choice = dialog.showMessageBoxSync(window, {
    type: "warning",
    buttons: ["Close Anyway", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Some of your latest changes couldn't be saved.",
    detail:
      "Close anyway and lose them, or cancel to keep them: a game's or chapter's titlebar offers " +
      "Retry, and a repertoire's chapter lists the practice prompts, hints and other changes " +
      "that weren't saved."
  });
  logger.warn(
    "main",
    `unsaved changes on closing: ${choice === 0 ? "closed anyway" : "kept open"}`
  );
  return choice === 0;
}

const REVEAL_FALLBACK_MS = 1500;
const revealedWindows = new WeakSet<BrowserWindow>();

/** Shows a window the first time only (a dev reload re-sends "ready" and must not un-minimise it). */
function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed() || revealedWindows.has(window)) return;
  revealedWindows.add(window);
  // In the background the window is never shown (see openInBackground).
  if (!openInBackground) window.show();
}

function installWindowReveal(): void {
  ipcMain.on("appearance:rendererReady", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) revealWindow(window);
  });
}

/** Serves engine pictures from disk; see `localImagePathFromUrl` for what is allowed. */
function installLocalImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (request) => {
    const requested = localImagePathFromUrl(request.url);
    // Fetch the canonical spelling: on Windows the request can arrive as `/C:/x.png`.
    const imagePath = requested && canonicalImagePath(requested);
    if (
      !imagePath ||
      !isServableImage(imagePath, () => engineRepository.list().map((engine) => engine.imagePath))
    ) {
      return new Response(null, { status: 404 });
    }
    return net.fetch(pathToFileURL(imagePath).href);
  });
}

function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: PRODUCT_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createAppIcon() {
  const assetsDir = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), "src/main/assets");
  // macOS already ships the bundle icon as Resources/icon.icns. Don't copy a second icns.
  const iconFiles =
    process.platform === "darwin"
      ? ["icon.icns", "app-icon.png"]
      : ["app-icon.png"];
  for (const file of iconFiles) {
    const icon = nativeImage.createFromPath(join(assetsDir, file));
    if (!icon.isEmpty()) return icon;
  }
  return undefined;
}

/**
 * One-time settings migration: the hosted ("server") and offline ("local") commentary providers
 * were removed. Any stored value other than OpenRouter is rewritten to it.
 */
function migrateCommentaryProvider(): void {
  const stored = settingsRepository.getStored("reviewCommentaryProvider");
  if (stored === undefined || stored === "openrouter") return;
  settingsRepository.set("reviewCommentaryProvider", normalizeCommentaryProvider(stored));
}

/**
 * First launch of a build with the welcome: installs with earlier use skip it, new ones see it
 * (see onboarding-migration.ts). Runs before the window loads, so the renderer reads the result.
 */
function classifyInstallForOnboarding(): void {
  const userData = app.getPath("userData");
  const result = migrateOnboarding({
    getStored: () => settingsRepository.getStored("onboardingCompletedAt"),
    set: (value) => settingsRepository.set("onboardingCompletedAt", value),
    traces: () => ({
      settingKeys: settingsRepository.storedKeys(),
      games: gameRepository.count(),
      engines: engineRepository.list().length,
      databases: externalDatabaseRepository.list().length,
      engineAssetState: existsSync(join(userData, "engine-assets.json")),
      openRouterConfig: existsSync(join(userData, "openrouter-config.json"))
    })
  });
  if (result !== "unchanged") logger.info("settings", `onboarding: ${result} install`);
}
