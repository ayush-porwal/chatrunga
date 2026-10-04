import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadBoardEdge,
  loadSidebarExpanded,
  saveBoardEdge,
  saveSidebarExpanded
} from "./layout-prefs";

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

describe("layout prefs", () => {
  let store: Storage;
  beforeEach(() => {
    store = memoryStorage();
    vi.stubGlobal("localStorage", store);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens the sidebar expanded until it is left as a rail, and remembers either", () => {
    expect(loadSidebarExpanded()).toBe(true);
    saveSidebarExpanded(false);
    expect(loadSidebarExpanded()).toBe(false);
    saveSidebarExpanded(true);
    expect(loadSidebarExpanded()).toBe(true);
  });

  it("remembers the board edge in whole pixels, and fill once it is cleared", () => {
    expect(loadBoardEdge()).toBeNull();
    saveBoardEdge(512.4);
    expect(loadBoardEdge()).toBe(512);
    saveBoardEdge(null);
    expect(loadBoardEdge()).toBeNull();
  });

  it("ignores a stored edge it could not have written", () => {
    for (const raw of ["", "wide", "-40", "0", "Infinity", "1e9"]) {
      store.setItem("chaturanga.layout.boardEdge", raw);
      expect(loadBoardEdge()).toBeNull();
    }
  });

  it("falls back to the defaults where storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      }
    });
    expect(() => saveSidebarExpanded(false)).not.toThrow();
    expect(() => saveBoardEdge(400)).not.toThrow();
    expect(loadSidebarExpanded()).toBe(true);
    expect(loadBoardEdge()).toBeNull();
  });
});
