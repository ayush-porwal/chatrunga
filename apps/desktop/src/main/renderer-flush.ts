import { randomUUID } from "node:crypto";
import { ipcMain, type IpcMainEvent, type WebContents } from "electron";

/** How long closing waits for the renderer to write its pending save. */
export const FLUSH_TIMEOUT_MS = 2_000;

/**
 * Asks the renderer to write its pending autosave. Resolves with false when the game couldn't be
 * saved, and with true once it is — or after `timeoutMs`, so a hung renderer can never keep the
 * window from closing.
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
      resolve(saved);
    };
    const onFlushed = (event: IpcMainEvent, reply: unknown, saved: unknown) => {
      if (event.sender === contents && reply === token) finish(saved !== false);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    ipcMain.on("games:flushed", onFlushed);
    contents.send("games:flush", token);
  });
}
