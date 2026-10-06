import { randomUUID } from "node:crypto";
import { ipcMain, type IpcMainEvent, type WebContents } from "electron";

/** How long closing waits for the renderer to write its pending save. */
export const FLUSH_TIMEOUT_MS = 2_000;

/**
 * How a flush ended: written ("saved"), a save failed ("unsaved"), no reply in time
 * ("no-answer"), or the renderer went away first ("renderer-gone").
 */
export type FlushResult = "saved" | "unsaved" | "no-answer" | "renderer-gone";

/**
 * Asks the renderer to write its pending autosave. Resolves "saved" once it is; anything else
 * means the game couldn't be saved — or isn't known to be: no reply within `timeoutMs` (a hung
 * renderer), or the renderer went away first. Then callers ask before closing, so a hung
 * renderer can neither keep the window open nor have its unsaved changes dropped unasked. A
 * webContents already destroyed resolves "saved": nothing is left there to save.
 */
export function requestRendererFlush(
  contents: WebContents,
  timeoutMs = FLUSH_TIMEOUT_MS
): Promise<FlushResult> {
  return new Promise((resolve) => {
    if (contents.isDestroyed()) {
      resolve("saved");
      return;
    }
    const token = randomUUID();
    const finish = (result: FlushResult) => {
      clearTimeout(timer);
      ipcMain.off("games:flushed", onFlushed);
      contents.off("render-process-gone", onGone);
      contents.off("destroyed", onGone);
      resolve(result);
    };
    const onFlushed = (event: IpcMainEvent, reply: unknown, saved: unknown) => {
      if (event.sender === contents && reply === token)
        finish(saved === false ? "unsaved" : "saved");
    };
    const onGone = () => finish("renderer-gone");
    const timer = setTimeout(() => finish("no-answer"), timeoutMs);
    ipcMain.on("games:flushed", onFlushed);
    contents.once("render-process-gone", onGone);
    contents.once("destroyed", onGone);
    contents.send("games:flush", token);
  });
}
