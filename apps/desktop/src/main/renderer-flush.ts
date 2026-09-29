import { randomUUID } from "node:crypto";
import { ipcMain, type IpcMainEvent, type WebContents } from "electron";

/** How long closing waits for the renderer to write its pending save. */
export const FLUSH_TIMEOUT_MS = 2_000;

/**
 * Asks the renderer to write its pending autosave and resolves when it has — or after
 * `timeoutMs`, so a hung renderer can never keep the window from closing.
 */
export function requestRendererFlush(contents: WebContents, timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    if (contents.isDestroyed()) {
      resolve();
      return;
    }
    const token = randomUUID();
    const finish = () => {
      clearTimeout(timer);
      ipcMain.off("games:flushed", onFlushed);
      resolve();
    };
    const onFlushed = (event: IpcMainEvent, reply: unknown) => {
      if (event.sender === contents && reply === token) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    ipcMain.on("games:flushed", onFlushed);
    contents.send("games:flush", token);
  });
}
