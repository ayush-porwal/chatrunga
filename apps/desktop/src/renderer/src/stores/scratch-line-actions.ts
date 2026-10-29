import type { MoveNode } from "@chaturanga/shared/types/chess";
import { stepBestLine, type BestLineCursor } from "../features/game/best-line-cursor";
import { activeScratchLine, nodeBefore, type ScratchLine } from "../features/game/scratch-line";

/**
 * The game store's scratch line actions (Game review's board; see scratch-line.ts): showing and
 * stepping it. Playing into it is Game review's own (game-review/scratch-moves.ts).
 */
export type ScratchLineActions = {
  /** Shows a position of a scratch line on the board (the game goes to its origin, the tree is not changed). */
  showScratchLine: (line: ScratchLine) => void;
  /**
   * `delta` moves along the scratch line on the board (back before its first move: the game move
   * it hangs off, then on along the game). False, doing nothing, when no scratch line is shown.
   */
  stepScratchLine: (delta: number) => boolean;
};

/** What the actions read of the game store. */
type ScratchHost = ScratchLineActions & {
  moveTree: MoveNode[];
  currentNodeId: string;
  currentFen: string;
  scratchLine: ScratchLine | null;
  bestLine: BestLineCursor | null;
  goToNode: (nodeId: string) => void;
};

/** What showing a scratch line's position changes in the game store (never the tree). */
type ScratchPatch = Pick<
  ScratchHost,
  "scratchLine" | "bestLine" | "currentNodeId" | "currentFen"
> & {
  pendingPromotion: null;
  lastError: null;
};

export function createScratchLineActions(
  set: (patch: ScratchPatch) => void,
  get: () => ScratchHost
): ScratchLineActions {
  return {
    showScratchLine: (line) => {
      const step = line.moves.at(line.index);
      if (!step || !get().moveTree.some((node) => node.id === line.originNodeId)) return;
      set({
        scratchLine: line,
        bestLine: null,
        currentNodeId: line.originNodeId,
        currentFen: step.fenAfter,
        pendingPromotion: null,
        lastError: null
      });
    },

    stepScratchLine: (delta) => {
      const state = get();
      const line = activeScratchLine(state);
      if (!line) return false;
      const next = stepBestLine(line, delta);
      if (next.kind === "line") state.showScratchLine(next.cursor);
      else state.goToNode(nodeBefore(state.moveTree, next.nodeId, -next.stepsLeft));
      return true;
    }
  };
}
