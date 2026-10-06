import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLibraryTab, saveLibraryTab, sourceLabel } from "./library-tab";

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

describe("library tab", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the tab last chosen; nothing (or an unknown tab) reads as none", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    expect(loadLibraryTab()).toBeNull();
    saveLibraryTab("chesscom");
    expect(loadLibraryTab()).toBe("chesscom");
    // The filters older builds had are not tabs.
    storage.setItem("chaturanga.library.tab", "other");
    expect(loadLibraryTab()).toBeNull();
  });

  it("still works where storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(() => saveLibraryTab("lichess")).not.toThrow();
    expect(loadLibraryTab()).toBeNull();
  });

  it("names each row's source as its tab does", () => {
    expect(sourceLabel("chesscom")).toBe("Chess.com");
    expect(sourceLabel("lichess")).toBe("Lichess");
    expect(sourceLabel("pgn-import")).toBe("Imported");
    expect(sourceLabel("engine-game")).toBe("Engine");
    expect(sourceLabel("analysis")).toBe("Chaturanga");
  });
});
