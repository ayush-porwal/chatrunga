import { describe, expect, it, vi } from "vitest";
import { useSaveStatusStore } from "./save-status-store";

describe("save status store", () => {
  it("holds a failure and its retry until cleared", () => {
    const retry = vi.fn();
    useSaveStatusStore.getState().setFailed("disk full", retry);
    expect(useSaveStatusStore.getState()).toMatchObject({ error: "disk full" });
    useSaveStatusStore.getState().retry?.();
    expect(retry).toHaveBeenCalledOnce();
    useSaveStatusStore.getState().clear();
    expect(useSaveStatusStore.getState()).toMatchObject({ error: null, retry: null });
  });
});
