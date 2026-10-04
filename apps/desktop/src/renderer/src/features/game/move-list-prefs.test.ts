import { afterEach, describe, expect, it, vi } from "vitest";
import { loadShowAllLines, saveShowAllLines } from "./move-list-prefs";

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

  it("folds the lines where storage is blocked, and still takes the choice", () => {
    const blocked = memoryStorage();
    blocked.getItem = () => {
      throw new Error("blocked");
    };
    blocked.setItem = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", blocked);
    expect(loadShowAllLines()).toBe(false);
    expect(() => saveShowAllLines(true)).not.toThrow();
  });
});
