import {
  app,
  BrowserWindow,
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
import { cancelAllDownloads } from "./databases/external-databases";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeCommentaryProvider } from "@chaturanga/shared/types/settings";
import { closeDb, getDb } from "./db";
import { engineRepository, externalDatabaseRepository, gameRepository, settingsRepository } from "./db/repositories";
import { EngineManager } from "./engine/engine-manager";
import { killAllEngineProcesses } from "./engine/uci-process";
import { registerIpc } from "./ipc/register";
import { shutdownLichess } from "./lichess";
import { logger } from "./logger";
import { migrateOnboarding } from "./onboarding-migration";
import { updateService } from "./updater";
import {
  isAppUrl,
  isExternalHttpUrl,
  isPermissionAllowed,
  localImagePathFromUrl,
  PRODUCTION_CSP
} from "./security";
import { installWindowGlass, windowGlassConstructorOptions } from "./window-glass";
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
app.setPath("userData", userDataOverride ?? join(app.getPath("appData"), app.isPackaged ? "chaturanga" : "chaturanga-dev"));
if (userDataOverride) app.setAppLogsPath(join(userDataOverride, "logs"));
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const engineManager = new EngineManager();
let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Only the instance that owns the profile, and before Chromium starts: Chromium deletes
  // `<userData>/databases`, where datasets used to be kept.
  try {
    const moved = rescueLegacyDatasets(app.getPath("userData"));
    if (moved.length) logger.info("databases", `moved ${moved.length} dataset file(s) out of Chromium's folder`);
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
    if (details.reason !== "clean-exit") logger.error("main", "child process gone:", details.type, details.reason);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("will-quit", shutdown);
  app.whenReady().then(startup, (error) => {
    logger.error("main", "startup failed:", error);
    app.quit();
  });
}

async function startup(): Promise<void> {
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
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(isPermissionAllowed(permission))
  );
  installLocalImageProtocol();
  // The UI is dark-only: native surfaces (window vibrancy material, menus, dialogs) follow it.
  nativeTheme.themeSource = "dark";
  installWindowGlass();
  installWindowReveal();
  registerIpc(engineManager);
  installApplicationMenu();
  const icon = createAppIcon();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);
  createWindow();
  // Quitting into an installer runs the same cleanup as a normal quit, first.
  void updateService.start({ prepareForInstall: shutdown });
}

/**
 * Stops engines, closes Lichess connections (streams, seek, sign-in server) and the database.
 * Idempotent: an update install runs it before `will-quit` does.
 */
function shutdown(): void {
  shutdownLichess();
  // Before the database closes: a download finishing now couldn't register its dataset.
  cancelAllDownloads();
  engineManager.stop();
  killAllEngineProcesses();
  closeDb();
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
    if (details.reason !== "clean-exit" && details.reason !== "killed" && !contents.isDestroyed()) contents.reload();
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
      webSecurity: true
    }
  });
  mainWindow = window;
  // Fallback reveal if the renderer never reports ready (a crash before React mounts).
  window.once("ready-to-show", () => setTimeout(() => revealWindow(window), REVEAL_FALLBACK_MS));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    // The interactive engine belongs to the window (macOS keeps the app alive).
    engineManager.stop();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [PRODUCTION_CSP] } });
    });
    void window.loadFile(rendererIndex);
  }
}

const REVEAL_FALLBACK_MS = 1500;
const revealedWindows = new WeakSet<BrowserWindow>();

/** Shows a window the first time only (a dev reload re-sends "ready" and must not un-minimise it). */
function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed() || revealedWindows.has(window)) return;
  revealedWindows.add(window);
  window.show();
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
    const imagePath = localImagePathFromUrl(request.url);
    if (!imagePath) return new Response(null, { status: 404 });
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
  const assetsDir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "src/main/assets");
  const iconFiles = process.platform === "darwin" ? ["app-icon.icns", "app-icon.png"] : ["app-icon.png"];
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
      games: gameRepository.list().length,
      engines: engineRepository.list().length,
      databases: externalDatabaseRepository.list().length,
      engineAssetState: existsSync(join(userData, "engine-assets.json")),
      openRouterConfig: existsSync(join(userData, "openrouter-config.json"))
    })
  });
  if (result !== "unchanged") logger.info("settings", `onboarding: ${result} install`);
}
