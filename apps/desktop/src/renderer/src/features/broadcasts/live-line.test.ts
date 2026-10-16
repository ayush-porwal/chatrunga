import { describe, expect, it } from "vitest";
import { addMoveNode, createEmptyGame } from "@chaturanga/shared/chess/pgn";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import type { BroadcastMove } from "@chaturanga/shared/types/broadcast";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { mergeLiveLine, ownMoveCount, pruneToLiveLine, restoreRemovedMoves } from "./live-line";

const move = (uci: string, san: string, clock: string | null = null): BroadcastMove => ({
  uci,
  san,
  clock
});

const E4 = move("e2e4", "e4", "1:59:58");
const E5 = move("e7e5", "e5", "1:59:50");
const NF3 = move("g1f3", "Nf3", "1:58:00");

/** Plays `uci` at `parentId` as the user would (a new move goes last among its siblings). */
function play(tree: MoveNode[], parentId: string, uci: string, san: string) {
  const parent = tree.find((node) => node.id === parentId);
  if (!parent) throw new Error("no parent");
  const fenAfter = fenAfterUci(parent.fenAfter, uci);
  if (!fenAfter) throw new Error("illegal");
  return addMoveNode(tree, parentId, { san, uci, fenBefore: parent.fenAfter, fenAfter });
}

/** `mergeLiveLine`, failing the test when the moves don't play. */
function merge(tree: readonly MoveNode[], moves: readonly BroadcastMove[]) {
  const merged = mergeLiveLine(tree, moves);
  if (!merged) throw new Error("the live moves didn't play");
  return merged;
}

const START = createEmptyGame().moveTree;

/** The main line's moves (first children from the root). */
function mainline(tree: readonly MoveNode[]): string[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const sans: string[] = [];
  for (let node = byId.get("root"); node?.children[0]; ) {
    node = byId.get(node.children[0]);
    if (node?.san) sans.push(node.san);
  }
  return sans;
}

describe("mergeLiveLine", () => {
  it("builds the live line with its clocks", () => {
    const merged = merge(START, [E4, E5]);
    expect(mainline(merged.moveTree)).toStrictEqual(["e4", "e5"]);
    expect(merged.liveIds).toHaveLength(3);
    expect(merged.moveTree.find((node) => node.id === merged.liveIds[2])?.clockAfter).toBe(
      "1:59:50"
    );
  });

  it("keeps the user's moves at the live tip as a variation once the next live move arrives", () => {
    const first = merge(START, [E4, E5]);
    const tip = first.liveIds[2];
    // The user explores 2. d4 from the live tip: it is the only child, so it reads as the main line.
    const explored = play(first.moveTree, tip, "d2d4", "d4");
    expect(mainline(explored.moveTree)).toStrictEqual(["e4", "e5", "d4"]);

    const next = merge(explored.moveTree, [E4, E5, NF3]);
    expect(mainline(next.moveTree)).toStrictEqual(["e4", "e5", "Nf3"]);
    const tipNode = next.moveTree.find((node) => node.id === tip);
    expect(tipNode?.children).toHaveLength(2);
    expect(next.moveTree.some((node) => node.id === explored.node.id)).toBe(true);
    expect(ownMoveCount(next.moveTree, next.liveIds)).toBe(1);
  });

  it("reuses a move the user guessed, making it the main line", () => {
    const first = merge(START, [E4, E5]);
    const guessed = play(first.moveTree, first.liveIds[2], "g1f3", "Nf3");
    const next = merge(guessed.moveTree, [E4, E5, NF3]);
    expect(next.liveIds.at(-1)).toBe(guessed.node.id);
    expect(next.moveTree.find((node) => node.id === guessed.node.id)?.clockAfter).toBe("1:58:00");
    expect(ownMoveCount(next.moveTree, next.liveIds)).toBe(0);
  });

  it("refuses moves that can't be played on the tree", () => {
    expect(mergeLiveLine(START, [move("e2e5", "e5")])).toBeNull();
  });
});

describe("back to live and undo", () => {
  it("clears every move off the live line and puts them back on undo, after newer live moves", () => {
    const first = merge(START, [E4, E5]);
    // A side line off the first move, two moves deep.
    const c5 = play(first.moveTree, first.liveIds[1], "c7c5", "c5");
    const nf3 = play(c5.moveTree, c5.node.id, "g1f3", "Nf3");

    const pruned = pruneToLiveLine(nf3.moveTree, first.liveIds);
    expect(pruned.moveTree.map((node) => node.id).sort()).toStrictEqual([...first.liveIds].sort());
    expect(pruned.removed.map((node) => node.san)).toStrictEqual(["c5", "Nf3"]);

    // A live move arrives, then the user undoes.
    const later = merge(pruned.moveTree, [E4, E5, NF3]);
    const restored = restoreRemovedMoves(later.moveTree, pruned.removed);
    expect(mainline(restored)).toStrictEqual(["e4", "e5", "Nf3"]);
    const e4 = restored.find((node) => node.id === first.liveIds[1]);
    expect(e4?.children).toStrictEqual([first.liveIds[2], c5.node.id]);
    expect(restored.find((node) => node.id === c5.node.id)?.children).toStrictEqual([nf3.node.id]);
  });

  it("drops a restored line whose parent is no longer in the tree", () => {
    const first = merge(START, [E4]);
    const side = play(first.moveTree, first.liveIds[1], "c7c5", "c5");
    const { removed } = pruneToLiveLine(side.moveTree, first.liveIds);
    expect(restoreRemovedMoves(START, removed)).toHaveLength(1);
  });
});
