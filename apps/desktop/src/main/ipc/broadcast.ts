import { appWindows } from "../app-windows";

/** Sends to every live app window (a closed window's webContents must not be used). */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of appWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
