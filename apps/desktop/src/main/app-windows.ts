import { BrowserWindow, type WebContents } from "electron";

/**
 * Hidden windows main runs for itself (the Maia host, main/maia/maia-host.ts): not the app's
 * own UI, so they get no app events, never count as an open window, and are never shown.
 */
const serviceWindows = new WeakSet<BrowserWindow>();

export function markServiceWindow(window: BrowserWindow): void {
  serviceWindows.add(window);
}

/** The webContents is a service window's (checked when an event fires, after the mark). */
export function isServiceContents(contents: WebContents): boolean {
  const window = BrowserWindow.fromWebContents(contents);
  return window !== null && serviceWindows.has(window);
}

/** The app's own windows: every window but the service windows. */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !serviceWindows.has(window));
}
