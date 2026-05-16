import { app, BrowserWindow, Menu, nativeImage, protocol, type MenuItemConstructorOptions } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./db";
import { EngineManager } from "./engine/engine-manager";
import { registerIpc } from "./ipc/register";

const engineManager = new EngineManager();
const currentDir = dirname(fileURLToPath(import.meta.url));

const PRODUCT_NAME = "Chaturanga";
app.setName(PRODUCT_NAME);
app.setPath("userData", join(app.getPath("appData"), "chaturanga"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "chaturanga-image",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

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
  const iconPaths =
    process.platform === "darwin"
      ? [join(assetsDir, "app-icon.icns"), join(assetsDir, "app-icon.png")]
      : [join(assetsDir, "app-icon.png")];

  for (const iconPath of iconPaths) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return icon;
  }
  return undefined;
}

function installLocalImageProtocol(): void {
  protocol.registerFileProtocol("chaturanga-image", (request, callback) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "local") {
        callback({ error: -6 });
        return;
      }
      const imagePath = decodeURIComponent(url.pathname.slice(1));
      callback({ path: imagePath });
    } catch {
      callback({ error: -2 });
    }
  });
}

function createWindow(): void {
  const icon = createAppIcon();
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Chaturanga",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 20 } : undefined,
    icon,
    backgroundColor: "#161616",
    webPreferences: {
      preload: join(currentDir, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  engineManager.bindWindow(mainWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
            "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file: chaturanga-image:; connect-src 'self'"
          ]
        }
      });
    });
    void mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  getDb();
  installLocalImageProtocol();
  registerIpc(engineManager);
  installApplicationMenu();
  const icon = createAppIcon();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  engineManager.stop();
  closeDb();
});
