import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { revertFailedWrite, settingsWriteOptions } from "./api";
import { addPendingSettings, dropPendingSettings, pendingSettings, withPendingSettings } from "./settings-pending";
import { flushSettingsBatches, SettingsBatch } from "../features/settings/use-set-setting";

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

describe("an explicit write after a drag", () => {
  // A pending value left behind would show over every later read in this file.
  afterEach(() => dropPendingSettings(["boardSquareLight", "soundVolume"]));

  it("replaces the drag's pending value for the same keys", () => {
    addPendingSettings({ boardSquareLight: "#123456", soundVolume: 0.4 });
    dropPendingSettings(["boardSquareLight"]);
    const shown = withPendingSettings({ ...defaultSettings, boardSquareLight: null, soundVolume: 0.7 });
    expect(shown.boardSquareLight).toBeNull();
    expect(shown.soundVolume).toBe(0.4);
  });
});

describe("flushSettingsBatches (the window closing)", () => {
  afterEach(() => vi.useRealTimers());

  it("writes every drag still waiting for its pause, through the writer given", async () => {
    vi.useFakeTimers();
    const own = vi.fn(async () => undefined);
    const now = vi.fn(async () => undefined);
    const volume = new SettingsBatch(250);
    const colors = new SettingsBatch(250);
    volume.setWriter(own);
    colors.setWriter(own);
    volume.add({ soundVolume: 0.3 }, defaultSettings);
    colors.add({ boardSquareLight: "#ffffff" }, defaultSettings);
    flushSettingsBatches(now);
    expect(now).toHaveBeenCalledTimes(2);
    expect(now).toHaveBeenCalledWith(expect.objectContaining({ patch: { soundVolume: 0.3 } }));
    expect(now).toHaveBeenCalledWith(expect.objectContaining({ patch: { boardSquareLight: "#ffffff" } }));
    // Written once: the pause that follows and a second flush have nothing left.
    vi.advanceTimersByTime(250);
    flushSettingsBatches(now);
    expect(own).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(pendingSettings()).toEqual({}));
  });
});

describe("a failed drag write", () => {
  it("shows the saved value again, even when the read back is unchanged", async () => {
    const client = new QueryClient();
    const disk: AppSettings = { ...defaultSettings, soundVolume: 0.7 };
    const settings = new QueryObserver(client, {
      queryKey: ["settings"],
      queryFn: async () => ({ ...disk }),
      select: withPendingSettings
    });
    const unsubscribe = settings.subscribe(() => {});
    await vi.waitFor(() => expect(settings.getCurrentResult().data?.soundVolume).toBe(0.7));

    // No desktop API in tests: the write fails.
    const mutation = new MutationObserver(client, settingsWriteOptions(client));
    const batch = new SettingsBatch(250);
    batch.setWriter((write) => mutation.mutate(write));
    // As useSettingsWriter shows a drag: pending overlay, then the cache.
    addPendingSettings({ soundVolume: 0.2 });
    client.setQueryData<AppSettings>(["settings"], { ...disk, soundVolume: 0.2 });
    batch.add({ soundVolume: 0.2 }, disk);
    expect(settings.getCurrentResult().data?.soundVolume).toBe(0.2);

    batch.flush();
    await vi.waitFor(() => {
      expect(client.isMutating()).toBe(0);
      expect(client.isFetching()).toBe(0);
      expect(pendingSettings()).toEqual({});
    });
    expect(settings.getCurrentResult().data?.soundVolume).toBe(0.7);
    unsubscribe();
    client.clear();
  });
});
