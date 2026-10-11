import { memo, useMemo, type ReactNode } from "react";
import { useEventCallback } from "@/lib/use-event-callback";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";
import { blackToMove } from "./move-counter";
import { MoveNavigationBar } from "./MoveNavigationBar";

/**
 * Workspace panel footer: First / Previous · "n / N" (full moves) · Next / Last, wired to the game store
 * (the same navigation as the ← → Home End shortcuts). Shared by the game view and Game review.
 */
export const MoveNavigation = memo(function MoveNavigation({ caption }: { caption?: ReactNode }) {
  const moveTree = useGameStore((state) => state.moveTree);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const goToNode = useGameStore((state) => state.goToNode);
  const undo = useGameStore((state) => state.undo);
  const redo = useGameStore((state) => state.redo);

  const { rootId, depth, total, blackFirst, canPrevious, canNext, lastId } = useMemo(
    () => navigationAt(moveTree, currentNodeId),
    [currentNodeId, moveTree]
  );

  const goFirst = useEventCallback(() => goToNode(rootId));
  const goLast = useEventCallback(() => {
    if (lastId && lastId !== currentNodeId) goToNode(lastId);
  });

  return (
    <MoveNavigationBar
      depth={depth}
      total={total}
      blackFirst={blackFirst}
      caption={caption}
      canPrevious={canPrevious}
      canNext={canNext}
      onFirst={goFirst}
      onPrevious={undo}
      onNext={redo}
      onLast={goLast}
    />
  );
});

type NodeIndex = ReadonlyMap<string, MoveNode>;

/**
 * Where `currentNodeId` stands for the navigation: its depth, out of the main line's length (or the
 * line's own depth inside a longer variation), whether it can step back or on, and the start and
 * end the First / Last buttons go to.
 */
function navigationAt(moveTree: readonly MoveNode[], currentNodeId: string) {
  const byId: NodeIndex = new Map(moveTree.map((node) => [node.id, node]));
  const root = moveTree.find((node) => !node.parentId) ?? null;
  const current = byId.get(currentNodeId) ?? null;
  const ply = depthOf(current, byId);
  return {
    rootId: root?.id ?? "root",
    depth: ply,
    // Position within the game: the main line's length, or the line's depth inside a longer variation.
    total: Math.max(ply, mainlineLength(root, byId, moveTree.length)),
    blackFirst: blackToMove(root?.fenBefore),
    canPrevious: Boolean(current?.parentId),
    canNext: Boolean(current?.children[0]),
    lastId: lineEnd(current, byId, moveTree.length)?.id ?? null
  };
}

/** How many moves `node` is from the root (a broken parent chain stops the count). */
function depthOf(node: MoveNode | null, byId: NodeIndex): number {
  let ply = 0;
  const seen = new Set<string>();
  for (
    let cursor = node;
    cursor?.parentId && !seen.has(cursor.id);
    cursor = byId.get(cursor.parentId) ?? null
  ) {
    seen.add(cursor.id);
    ply += 1;
  }
  return ply;
}

/** The main line's length from `root`, never more than the tree's `size` (a cycle stops it). */
function mainlineLength(root: MoveNode | null, byId: NodeIndex, size: number): number {
  let mainline = 0;
  for (let cursor = root; cursor?.children[0]; cursor = byId.get(cursor.children[0]) ?? null) {
    mainline += 1;
    if (mainline > size) break;
  }
  return mainline;
}

/** The last move of `node`'s line, following each first child (at most the tree's `size` steps). */
function lineEnd(node: MoveNode | null, byId: NodeIndex, size: number): MoveNode | null {
  let last = node;
  for (let guard = 0; last?.children[0] && guard <= size; guard += 1) {
    last = byId.get(last.children[0]) ?? null;
  }
  return last;
}
