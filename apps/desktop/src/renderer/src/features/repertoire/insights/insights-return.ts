import { create } from "zustand";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { InsightsGameRow } from "@chaturanga/shared/types/repertoire-insights";
import { mainlinePath } from "../../game/move-tree-model";

/**
 * What Insights knows about the game it opened in Game review: its outcome, the move where it left
 * the repertoire (the issue) and the repertoire it followed. Game review's "From your games" band
 * says it and offers the fix; its board draws the moves at that position (insights-review.ts).
 */
export type InsightsReviewFocus = Pick<
  InsightsGameRow,
  "outcome" | "issue" | "repertoireId" | "repertoireName" | "color"
>;

/**
 * The game Insights opened in Game review, so its titlebar offers "Back to Insights" and its panel
 * the "From your games" band while that game is on screen (another game opened there drops it).
 */
export const useInsightsReturnStore = create<{
  gameId: string | null;
  focus: InsightsReviewFocus | null;
  setGameId: (gameId: string | null, focus?: InsightsReviewFocus | null) => void;
}>((set) => ({
  gameId: null,
  focus: null,
  setGameId: (gameId, focus = null) => set({ gameId, focus: gameId ? focus : null })
}));

/** The main-line move at `ply` (its plies are the game's own); null when the line is shorter. */
export function mainlineNodeAtPly(moveTree: readonly MoveNode[], ply: number): MoveNode | null {
  return mainlinePath(moveTree).find((node) => node.uci !== null && node.ply === ply) ?? null;
}
