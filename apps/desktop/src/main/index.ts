import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  net,
  protocol,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents
} from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  normalizeCommentaryProvider,
  REVIEW_COMMENTARY_PROVIDERS,
  type ReviewCommentaryProvider
} from "@chaturanga/shared/types/settings";
import { closeDb, getDb } from "./db";
import { settingsRepository } from "./db/repositories";
import { EngineManager } from "./engine/engine-manager";
import { killAllEngineProcesses } from "./engine/uci-process";
import { registerIpc } from "./ipc/register";
import { getOpenRouterConfigStore } from "./commentary/openrouter-config";
import { logger } from "./logger";
import {
  isAppUrl,
  isExternalHttpUrl,
  isPermissionAllowed,
  localImagePathFromUrl,
  PRODUCTION_CSP
} from "./security";

const PRODUCT_NAME = "Chaturanga";
const IMAGE_SCHEME = "chaturanga-image";
const currentDir = dirname(fileURLToPath(import.meta.url));
const rendererIndex = join(currentDir, "../renderer/index.html");
/** Dev: the Vite server; production: the bundled page. */
const appUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererIndex).href;

process.on("uncaughtException", (error) => logger.error("main", "uncaught exception:", error));
process.on("unhandledRejection", (reason) => logger.error("main", "unhandled rejection:", reason));

app.setName(PRODUCT_NAME);
// Dev/test hook: CHATURANGA_USER_DATA_DIR points the app at a throwaway profile
// (UI automation, clean-install checks). Unset in normal use. Set before the
// single-instance lock, which is scoped to the user-data directory.
const userDataOverride = process.env.CHATURANGA_USER_DATA_DIR;
app.setPath("userData", userDataOverride ?? join(app.getPath("appData"), "chaturanga"));
if (userDataOverride) app.setAppLogsPath(join(userDataOverride, "logs"));
protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const engineManager = new EngineManager();
let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
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
  await migrateCommentaryProvider().catch((error) =>
    logger.error("settings", "commentary provider migration failed:", error)
  );
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(isPermissionAllowed(permission))
  );
  installLocalImageProtocol();
  registerIpc(engineManager);
  installApplicationMenu();
  const icon = createAppIcon();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);
  createWindow();
}

function shutdown(): void {
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
    backgroundColor: "#161616",
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
 * One-time settings migration: the hosted commentary provider ("server") was removed.
 * Users who already saved an OpenRouter key move to OpenRouter; everyone else to offline.
 */
async function migrateCommentaryProvider(): Promise<void> {
  const stored = settingsRepository.getStored("reviewCommentaryProvider");
  if (stored === undefined || REVIEW_COMMENTARY_PROVIDERS.includes(stored as ReviewCommentaryProvider)) return;
  const { hasApiKey } = await getOpenRouterConfigStore().get();
  settingsRepository.set("reviewCommentaryProvider", normalizeCommentaryProvider(stored, hasApiKey));
}
