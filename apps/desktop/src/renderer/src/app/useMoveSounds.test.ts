import { describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../stores/game-store";
import { movedNodeBetween, pickSound, useMoveSounds, withoutMoveSounds } from "./useMoveSounds";

// The hook's effects run at once, outside React; the sounds are recorded instead of played.
const cleanups: (() => void)[] = [];
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}));
const played = vi.hoisted(() => [] as string[]);
vi.mock("../sounds/sounds", () => ({
  keepAudioAwake: () => () => undefined,
  playSound: (kind: string) => played.push(kind)
}));

function node(id: string, parentId: string | null, children: string[] = []): MoveNode {
  return {
    id,
    parentId,
    san: id,
    uci: null,
    fenBefore: "",
    fenAfter: "",
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children
  };
}

// root → a → b → c, with a side line a → x
const tree = [
  node("root", null, ["a"]),
  node("a", "root", ["b", "x"]),
  node("b", "a", ["c"]),
  node("c", "b"),
  node("x", "a")
];

describe("movedNodeBetween", () => {
  it("finds the move for forward and backward steps", () => {
    expect(movedNodeBetween(tree, "a", "b")?.id).toBe("b");
    expect(movedNodeBetween(tree, "b", "a")?.id).toBe("b");
  });

  it("finds the first move below the start on a longer jump", () => {
    expect(movedNodeBetween(tree, "a", "c")?.id).toBe("b");
  });

  it("returns null when the nodes are on different lines", () => {
    expect(movedNodeBetween(tree, "c", "x")).toBeNull();
  });
});

describe("pickSound", () => {
  const base = { result: "*", isEnd: false, engineSide: null, orientation: "white" } as const;

  it("picks check, capture or move from the SAN", () => {
    expect(pickSound({ ...base, san: "Qxf7#" })).toBe("check");
    expect(pickSound({ ...base, san: "Bxc6" })).toBe("capture");
    expect(pickSound({ ...base, san: "Nf3" })).toBe("move");
  });

  it("judges the result from the user's side", () => {
    expect(pickSound({ ...base, san: "Qh7#", isEnd: true, result: "1-0" })).toBe("victory");
    expect(pickSound({ ...base, san: "Qh2#", isEnd: true, result: "0-1" })).toBe("defeat");
    expect(
      pickSound({ ...base, san: "Qh2#", isEnd: true, result: "0-1", engineSide: "white" })
    ).toBe("victory");
    expect(pickSound({ ...base, san: "Kh1", isEnd: true, result: "1/2-1/2" })).toBe("draw");
  });
});

describe("useMoveSounds", () => {
  it("sounds each board step, except the steps made without their sound", () => {
    const { game } = importPgnText("1. e4 e5 2. Nf3 Nc6 *");
    useGameStore.getState().loadGame(game);
    const mainline = game.moveTree.filter((item) => item.san).map((item) => item.id);
    useGameStore.getState().goToNode("root");
    useMoveSounds({ enabled: true, volume: 1 });
    useGameStore.getState().goToNode(mainline[0]!);
    withoutMoveSounds(() => useGameStore.getState().goToNode(mainline[3]!));
    useGameStore.getState().goToNode(mainline[2]!);
    expect(played).toEqual(["move", "move"]);
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
});
