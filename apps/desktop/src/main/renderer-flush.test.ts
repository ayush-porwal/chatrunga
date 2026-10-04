import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";

const ipcMain = new EventEmitter();
vi.mock("electron", () => ({ ipcMain }));

const { FLUSH_TIMEOUT_MS, requestRendererFlush } = await import("./renderer-flush");

/** A renderer that answers each flush request with `reply` (or never, when undefined). */
function renderer(reply?: boolean) {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: vi.fn((_channel: string, token: string) => {
      if (reply !== undefined)
        queueMicrotask(() => ipcMain.emit("games:flushed", { sender: contents }, token, reply));
    })
  });
  return contents as typeof contents & WebContents;
}

describe("requestRendererFlush", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the renderer's answer", async () => {
    await expect(requestRendererFlush(renderer(true))).resolves.toBe(true);
    await expect(requestRendererFlush(renderer(false))).resolves.toBe(false);
    expect(ipcMain.listenerCount("games:flushed")).toBe(0);
  });

  it("doesn't count a renderer that never answers as saved", async () => {
    const flushed = requestRendererFlush(renderer());
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
    await expect(flushed).resolves.toBe(false);
    expect(ipcMain.listenerCount("games:flushed")).toBe(0);
  });

  it("stops waiting as soon as the renderer goes away", async () => {
    const contents = renderer();
    const flushed = requestRendererFlush(contents);
    contents.emit("render-process-gone");
    await expect(flushed).resolves.toBe(false);
    expect(contents.listenerCount("destroyed")).toBe(0);
  });

  it("has nothing to wait for once the webContents is destroyed", async () => {
    const contents = Object.assign(renderer(), { isDestroyed: () => true });
    await expect(requestRendererFlush(contents)).resolves.toBe(true);
    expect(contents.send).not.toHaveBeenCalled();
  });
});
