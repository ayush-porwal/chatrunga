import { create } from "zustand";
import { loadBoardEdge, saveBoardEdge } from "@/lib/layout-prefs";
import { restoredBoardEdge } from "./board-frame";

/**
 * The board edge the user dragged the board to with its corner grip (BoardResizeGrip), shared by
 * every board workspace; null while the board fills its space (the default, and after a
 * double-click on the grip). Remembered on this machine once a drag ends (layout-prefs).
 */
type BoardEdgeStore = {
  edge: number | null;
  /** A drag in progress: applies at once, remembered by `commit` when the drag ends. */
  resize: (edge: number) => void;
  commit: () => void;
  /** Back to filling the space, remembered. */
  fill: () => void;
};

export const useBoardEdgeStore = create<BoardEdgeStore>((set, get) => ({
  edge: restoredBoardEdge(loadBoardEdge()),
  resize: (edge) => set({ edge }),
  commit: () => saveBoardEdge(get().edge),
  fill: () => {
    set({ edge: null });
    saveBoardEdge(null);
  }
}));
