import { create } from "zustand";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { mainlinePath } from "../../game/move-tree-model";

/**
 * The game Insights opened in Game review, so its titlebar offers "Back to Insights" while that
 * game is on screen (another game opened there drops it).
 */
export const useInsightsReturnStore = create<{
  gameId: string | null;
  setGameId: (gameId: string | null) => void;
}>((set) => ({
  gameId: null,
  setGameId: (gameId) => set({ gameId })
}));

/** The main-line move at `ply` (its plies are the game's own); null when the line is shorter. */
export function mainlineNodeAtPly(moveTree: readonly MoveNode[], ply: number): MoveNode | null {
  return mainlinePath(moveTree).find((node) => node.uci !== null && node.ply === ply) ?? null;
}
