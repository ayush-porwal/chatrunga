import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBoardEdge } from "@/lib/layout-prefs";
import { MIN_BOARD_EDGE } from "./board-frame";
import { useBoardEdgeStore } from "./useBoardEdge";

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

const edge = () => useBoardEdgeStore.getState().edge;

describe("the board edge store, as the grip and the splitter drive it", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    useBoardEdgeStore.setState({ edge: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("remembers a drag only once it ends", () => {
    const { resize, commit } = useBoardEdgeStore.getState();
    resize(520);
    expect(edge()).toBe(520);
    expect(loadBoardEdge()).toBeNull();
    commit();
    expect(loadBoardEdge()).toBe(520);
  });

  it("steps from the measured edge with the keys, and remembers each step at once", () => {
    const { key } = useBoardEdgeStore.getState();
    // A filled board (no edge yet) steps from where it is on screen.
    expect(key("ArrowLeft", false, 612.5, 900)).toBe(true);
    expect(edge()).toBe(596.5);
    expect(loadBoardEdge()).toBe(597);
    expect(key("ArrowRight", true, 596.5, 900)).toBe(true);
    expect(edge()).toBe(660.5);
    expect(key("Home", false, 660.5, 900)).toBe(true);
    expect(edge()).toBe(MIN_BOARD_EDGE);
    expect(loadBoardEdge()).toBe(MIN_BOARD_EDGE);
    expect(key("End", false, MIN_BOARD_EDGE, 900)).toBe(true);
    expect(edge()).toBe(900);
  });

  it("fills the space again on Enter or a double-click, and remembers that", () => {
    const { key, resize, commit, fill } = useBoardEdgeStore.getState();
    resize(480);
    commit();
    expect(key("Enter", false, 480, 900)).toBe(true);
    expect(edge()).toBeNull();
    expect(loadBoardEdge()).toBeNull();

    resize(480);
    commit();
    // A double-click on the grip or the splitter.
    fill();
    expect(edge()).toBeNull();
    expect(loadBoardEdge()).toBeNull();
  });

  it("leaves other keys to the page and changes nothing", () => {
    const { key } = useBoardEdgeStore.getState();
    expect(key("ArrowUp", false, 500, 900)).toBe(false);
    expect(key(" ", false, 500, 900)).toBe(false);
    expect(edge()).toBeNull();
    expect(loadBoardEdge()).toBeNull();
  });
});
