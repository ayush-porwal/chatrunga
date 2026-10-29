import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { LineCursor } from "./best-line-cursor";

/*
 * A scratch line: moves tried on Game review's board (played there, or a coach's line clicked)
 * that are never saved. It hangs off a game move (its anchor) and the board shows one of its
 * positions while the game stays on the move it was started from (its origin), so the panels keep
 * explaining that move. The game's move tree never changes: leaving the line (Back to game, another
 * game move) forgets it. The game store shows and steps it; playing into it is Game review's
 * (game-review/scratch-moves.ts).
 */

/** The scratch line on the board and the move of it shown. */
export type ScratchLine = LineCursor & {
  /** The game move the panels stay on while the line is shown (where it was started from). */
  originNodeId: string;
};

/**
 * The scratch line, if the board still shows it: the game is on its origin and the board on its
 * move. Any other navigation moves the board, so a line left behind is simply no longer active.
 */
export function activeScratchLine(state: {
  scratchLine: ScratchLine | null;
  currentNodeId: string;
  currentFen: string;
}): ScratchLine | null {
  const line = state.scratchLine;
  if (!line || line.originNodeId !== state.currentNodeId) return null;
  return line.moves[line.index]?.fenAfter === state.currentFen ? line : null;
}

/** The game move `steps` moves before `nodeId` (towards the start; it stops at the start). */
export function nodeBefore(moveTree: readonly MoveNode[], nodeId: string, steps: number): string {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let current = nodeId;
  for (let remaining = steps; remaining > 0; remaining -= 1) {
    const parentId = byId.get(current)?.parentId;
    if (!parentId || !byId.has(parentId)) break;
    current = parentId;
  }
  return current;
}
