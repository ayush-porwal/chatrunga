import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyTabCounts, type LibraryTabCounts } from "@chaturanga/shared/types/library";
import {
  DEFAULT_LIBRARY_FILTER,
  libraryFilterApplies,
  libraryFilterState,
  libraryListState,
  loadLibraryTab,
  saveLibraryTab,
  sourceLabel
} from "./library-tab";

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

  describe("the Library's filter", () => {
    const counts = (
      tabs: Partial<Record<keyof LibraryTabCounts, [games: number, reviewed: number]>>
    ): LibraryTabCounts => {
      const all = emptyTabCounts();
      for (const [tab, [games, reviewed]] of Object.entries(tabs)) {
        all[tab as keyof LibraryTabCounts] = { games, reviewed };
      }
      return all;
    };
    const library = counts({ lichess: [571, 40], chesscom: [12, 2], engine: [3, 0] });

    it("starts from every game with Reviewed off, the one setting without the filter's dot", () => {
      expect(libraryFilterApplies(DEFAULT_LIBRARY_FILTER)).toBe(false);
      expect(libraryFilterApplies({ tab: "lichess", reviewed: false })).toBe(true);
      expect(libraryFilterApplies({ tab: null, reviewed: true })).toBe(true);
      expect(libraryFilterApplies({ tab: "engine", reviewed: true })).toBe(true);
    });

    it("counts the games it lists: every source's, one source's, or their reviewed ones", () => {
      const all = libraryFilterState(library, DEFAULT_LIBRARY_FILTER);
      expect(all.options).toStrictEqual([
        { tab: null, label: "All games", count: 586 },
        { tab: "lichess", label: "Lichess", count: 571 },
        { tab: "chesscom", label: "Chess.com", count: 12 },
        { tab: "engine", label: "Engine", count: 3 }
      ]);
      expect([all.total, all.reviewed]).toStrictEqual([586, 42]);
      const reviewed = libraryFilterState(library, { tab: null, reviewed: true });
      expect([reviewed.total, reviewed.reviewed]).toStrictEqual([42, 42]);
      const chesscom = libraryFilterState(library, { tab: "chesscom", reviewed: false });
      expect([chesscom.total, chesscom.reviewed]).toStrictEqual([12, 2]);
      expect(libraryFilterState(library, { tab: "chesscom", reviewed: true }).total).toBe(2);
    });

    it("lists every game once the chosen source has none left (no dot), keeping Reviewed", () => {
      const gone = libraryFilterState(library, { tab: "imported", reviewed: false });
      expect(gone.filter).toStrictEqual(DEFAULT_LIBRARY_FILTER);
      expect(libraryFilterApplies(gone.filter)).toBe(false);
      expect(gone.total).toBe(586);
      const reviewed = libraryFilterState(library, { tab: "imported", reviewed: true });
      expect(reviewed.filter).toStrictEqual({ tab: null, reviewed: true });
      expect(reviewed.total).toBe(42);
    });

    it("counts an empty library as no games", () => {
      const empty = libraryFilterState(emptyTabCounts(), DEFAULT_LIBRARY_FILTER);
      expect(empty.options).toStrictEqual([{ tab: null, label: "All games", count: 0 }]);
      expect([empty.total, empty.reviewed]).toStrictEqual([0, 0]);
    });
  });

  it("shows a failed first read of the counts as the list's error, not loading forever", () => {
    const games = { pending: true, failed: false };
    expect(libraryListState({ read: false, failed: false }, games)).toBe("loading");
    expect(libraryListState({ read: false, failed: true }, games)).toBe("counts-error");
    // Counts read once: a failed re-read keeps them, and the list's own state shows.
    expect(libraryListState({ read: true, failed: true }, games)).toBe("loading");
    expect(libraryListState({ read: true, failed: true }, { pending: false, failed: false })).toBe(
      "ready"
    );
    expect(libraryListState({ read: true, failed: false }, { pending: false, failed: true })).toBe(
      "error"
    );
  });
});
