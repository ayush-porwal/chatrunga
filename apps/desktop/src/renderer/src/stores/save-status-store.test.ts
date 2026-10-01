import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveStatusStore } from "./save-status-store";

describe("save status store", () => {
  beforeEach(() => useSaveStatusStore.getState().clear());

  it("holds a failure and its retry until cleared", () => {
    const retry = vi.fn();
    useSaveStatusStore.getState().setFailed("disk full", retry, "a");
    expect(useSaveStatusStore.getState()).toMatchObject({ error: "disk full", gameId: "a" });
    useSaveStatusStore.getState().retry?.();
    expect(retry).toHaveBeenCalledOnce();
    useSaveStatusStore.getState().clear();
    expect(useSaveStatusStore.getState()).toMatchObject({ error: null, retry: null, gameId: null });
  });

  it("clears a failure only when the game that failed is saved", () => {
    useSaveStatusStore.getState().setFailed("disk full", vi.fn(), "left");
    useSaveStatusStore.getState().saved("loaded");
    expect(useSaveStatusStore.getState()).toMatchObject({ error: "disk full", gameId: "left" });
    useSaveStatusStore.getState().saved("left");
    expect(useSaveStatusStore.getState()).toMatchObject({ error: null, retry: null, gameId: null });
  });
});
