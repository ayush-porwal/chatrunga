import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { revertFailedWrite } from "./api";
import { SettingsBatch } from "../features/settings/use-set-setting";

describe("revertFailedWrite", () => {
  it("reverts only the failed write's keys still showing its value", () => {
    const current = { ...defaultSettings, soundVolume: 0.2, boardTheme: "green" as const, showCoordinates: false };
    const reverted = revertFailedWrite(current, { soundVolume: 0.2, boardTheme: "blue" }, { soundVolume: 0.7, boardTheme: "brown" });
    // soundVolume still shows the failed value: back to 0.7. boardTheme was changed since (green): kept.
    expect(reverted.soundVolume).toBe(0.7);
    expect(reverted.boardTheme).toBe("green");
    // Keys the write didn't touch stay as they are.
    expect(reverted.showCoordinates).toBe(false);
  });
});

describe("SettingsBatch", () => {
  afterEach(() => vi.useRealTimers());

  it("writes a drag once it pauses, with the values from before it started", () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const batch = new SettingsBatch(250);
    batch.setWriter(write);
    const current = { ...defaultSettings, soundVolume: 0.7 };
    for (const volume of [0.6, 0.5, 0.4, 0.3]) {
      batch.add({ soundVolume: volume }, { ...current, soundVolume: volume + 0.1 });
      vi.advanceTimersByTime(100);
    }
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ patch: { soundVolume: 0.3 }, previous: { soundVolume: 0.7 } });
  });

  it("flush writes what's pending now, and nothing when there is nothing", () => {
    const write = vi.fn(async () => undefined);
    const batch = new SettingsBatch(250);
    batch.setWriter(write);
    batch.flush();
    expect(write).not.toHaveBeenCalled();
    batch.add({ boardSquareLight: "#ffffff", boardSquareDark: "#000000" }, defaultSettings);
    batch.flush();
    expect(write).toHaveBeenCalledWith({
      patch: { boardSquareLight: "#ffffff", boardSquareDark: "#000000" },
      previous: { boardSquareLight: null, boardSquareDark: null }
    });
  });
});

describe("settings not written yet", () => {
  it("stay on top of a read until their batch settles", async () => {
    const { pendingSettings, withPendingSettings } = await import("./settings-pending");
    let finish: () => void = () => {};
    const write = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const batch = new SettingsBatch(250);
    batch.setWriter(write);
    batch.add({ soundVolume: 0.2 }, defaultSettings);
    // A read after some other write still shows the dragged value.
    expect(withPendingSettings({ ...defaultSettings, soundVolume: 0.7 }).soundVolume).toBe(0.2);
    batch.flush();
    expect(pendingSettings()).toEqual({ soundVolume: 0.2 });
    finish();
    await vi.waitFor(() => expect(pendingSettings()).toEqual({}));
    expect(withPendingSettings({ ...defaultSettings, soundVolume: 0.7 }).soundVolume).toBe(0.7);
  });
});
