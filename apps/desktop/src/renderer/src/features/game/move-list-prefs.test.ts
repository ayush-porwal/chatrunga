import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadMovesView,
  loadShowAllLines,
  saveMovesView,
  saveShowAllLines
} from "./move-list-prefs";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value))
  };
}

describe("move list prefs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("folds BEST lines until the list is left showing them all, and remembers either", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(loadShowAllLines()).toBe(false);
    saveShowAllLines(true);
    expect(loadShowAllLines()).toBe(true);
    saveShowAllLines(false);
    expect(loadShowAllLines()).toBe(false);
  });

  it("opens Game review's Moves tab on the move list until it is left on the key insights", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    expect(loadMovesView()).toBe("moves");
    saveMovesView("key");
    expect(loadMovesView()).toBe("key");
    saveMovesView("moves");
    expect(loadMovesView()).toBe("moves");
    // A view this build doesn't have (the old "All marks", say) opens the move list.
    store.setItem("chaturanga.review.movesView", "marked");
    expect(loadMovesView()).toBe("moves");
  });

  it("uses the defaults where storage is blocked, and still takes the choices", () => {
    const blocked = memoryStorage();
    blocked.getItem = () => {
      throw new Error("blocked");
    };
    blocked.setItem = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", blocked);
    expect(loadShowAllLines()).toBe(false);
    expect(loadMovesView()).toBe("moves");
    expect(() => saveShowAllLines(true)).not.toThrow();
    expect(() => saveMovesView("key")).not.toThrow();
  });
});
