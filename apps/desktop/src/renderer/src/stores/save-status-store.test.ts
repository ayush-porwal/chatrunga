import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveStatusStore } from "./save-status-store";

const store = () => useSaveStatusStore.getState();
const failedGames = () => store().failures.map((failure) => failure.gameId);

describe("save status store", () => {
  beforeEach(() => store().clear());

  it("holds a failure and its retry until cleared", () => {
    const retry = vi.fn();
    store().setFailed("disk full", retry, "a", 1);
    expect(store().error).toBe("disk full");
    expect(failedGames()).toEqual(["a"]);
    store().retry();
    expect(retry).toHaveBeenCalledOnce();
    store().clear();
    expect(store()).toMatchObject({ error: null, failures: [] });
  });

  it("clears a failure only when the game that failed is saved", () => {
    store().setFailed("disk full", vi.fn(), "left", 1);
    store().saved("loaded", 2);
    expect(failedGames()).toEqual(["left"]);
    store().saved("left", 3);
    expect(store()).toMatchObject({ error: null, failures: [] });
  });

  it("keeps a newer failure when an older write of the same game saves after it", () => {
    store().setFailed("disk full", vi.fn(), "a", 2);
    store().saved("a", 1);
    expect(failedGames()).toEqual(["a"]);
    // And an older failure settling after a newer write saved is out of date.
    store().saved("a", 3);
    store().setFailed("disk full", vi.fn(), "a", 2);
    expect(store().error).toBeNull();
  });

  it("keeps every game's failure, shows the latest, and retries them all", () => {
    const retryA = vi.fn();
    const retryB = vi.fn();
    store().setFailed("disk full", retryA, "a", 1);
    store().setFailed("read-only", retryB, "b", 2);
    expect(failedGames()).toEqual(["a", "b"]);
    expect(store().error).toBe("read-only");
    store().retry();
    expect(retryA).toHaveBeenCalledOnce();
    expect(retryB).toHaveBeenCalledOnce();

    store().saved("b", 3);
    expect(store().error).toBe("disk full");
    store().saved("a", 4);
    expect(store().error).toBeNull();
  });
});
