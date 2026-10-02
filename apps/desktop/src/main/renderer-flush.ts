import { randomUUID } from "node:crypto";
import { ipcMain, type IpcMainEvent, type WebContents } from "electron";

/** How long closing waits for the renderer to write its pending save. */
export const FLUSH_TIMEOUT_MS = 2_000;

/**
 * Asks the renderer to write its pending autosave. Resolves with true once it is, and with false
 * when the game couldn't be saved — or isn't known to be: no reply within `timeoutMs` (a hung
 * renderer), or the renderer went away first. On false, callers ask before closing, so a hung
 * renderer can neither keep the window open nor have its unsaved changes dropped unasked. A
 * webContents already destroyed resolves true: nothing is left there to save.
 */
export function requestRendererFlush(contents: WebContents, timeoutMs = FLUSH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (contents.isDestroyed()) {
      resolve(true);
      return;
    }
    const token = randomUUID();
    const finish = (saved: boolean) => {
      clearTimeout(timer);
      ipcMain.off("games:flushed", onFlushed);
      contents.off("render-process-gone", onGone);
      contents.off("destroyed", onGone);
      resolve(saved);
    };
    const onFlushed = (event: IpcMainEvent, reply: unknown, saved: unknown) => {
      if (event.sender === contents && reply === token) finish(saved !== false);
    };
    const onGone = () => finish(false);
    const timer = setTimeout(onGone, timeoutMs);
    ipcMain.on("games:flushed", onFlushed);
    contents.once("render-process-gone", onGone);
    contents.once("destroyed", onGone);
    contents.send("games:flush", token);
  });
}
