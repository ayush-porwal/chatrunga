import { app, BrowserWindow, ipcMain, nativeTheme, type BrowserWindowConstructorOptions } from "electron";
import type { WindowGlassState } from "@chaturanga/shared/ipc/chaturanga-api";
import { settingsRepository } from "./db/repositories";
import { resolveWindowGlassState, sameGlassState, windowGlassOptions } from "./window-glass-state";

/*
 * Window glass: macOS vibrancy behind the web contents, visible wherever the renderer leaves the
 * page transparent (the `html.glass` chrome: titlebar + sidebar; the content panel stays opaque).
 *
 * Flow: the state is derived from the `glassEffect` setting and the system Reduce transparency
 * preference → applied to every window (setVibrancy + setBackgroundColor) → pushed to the renderer
 * ("appearance:glassChanged"), which toggles `html.glass`. The preload reads the initial state
 * synchronously so the first frame already matches the native window.
 */

let lastState: WindowGlassState | null = null;

function computeState(): WindowGlassState {
  return resolveWindowGlassState({
    platform: process.platform,
    enabled: settingsRepository.getAll().glassEffect,
    reducedTransparency: nativeTheme.prefersReducedTransparency
  });
}

/** Glass-related options for a new BrowserWindow. */
export function windowGlassConstructorOptions(): Pick<
  BrowserWindowConstructorOptions,
  "vibrancy" | "visualEffectState" | "backgroundColor"
> {
  lastState = computeState();
  const { vibrancy, backgroundColor } = windowGlassOptions(lastState);
  return {
    backgroundColor,
    ...(vibrancy
      ? {
          vibrancy,
          // Native behaviour: the material dims to its inactive look when the window loses focus.
          visualEffectState: "followWindow"
        }
      : {})
  };
}

/** Re-derives the state and, when it changed, updates every window and tells its renderer. */
export function refreshWindowGlass(): void {
  const next = computeState();
  if (lastState && sameGlassState(lastState, next)) return;
  lastState = next;
  const { vibrancy, backgroundColor } = windowGlassOptions(next);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    if (next.supported) window.setVibrancy(vibrancy);
    window.setBackgroundColor(backgroundColor);
    if (!window.webContents.isDestroyed()) window.webContents.send("appearance:glassChanged", next);
  }
}

/** IPC + system listeners. Call once, before the first window is created. */
export function installWindowGlass(): void {
  ipcMain.on("appearance:getGlassSync", (event) => {
    event.returnValue = lastState ?? computeState();
  });
  // Fires for Reduce transparency (and appearance) changes in System Settings.
  nativeTheme.on("updated", refreshWindowGlass);
  // Belt and braces: re-check whenever a window gains focus (the user returns from System
  // Settings). Cheap, and a no-op unless something changed.
  app.on("browser-window-focus", refreshWindowGlass);
}
