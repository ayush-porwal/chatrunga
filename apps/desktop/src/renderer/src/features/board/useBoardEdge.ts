import { create } from "zustand";
import { loadBoardEdge, saveBoardEdge } from "@/lib/layout-prefs";
import { keyedBoardEdge, restoredBoardEdge } from "./board-frame";

/**
 * The board edge the user resized the board to, with its corner grip (BoardResizeGrip) or the
 * splitter beside the side panel (BoardSplitter), shared by every board workspace; null while the
 * board fills its space (the default, and after a double-click on either, or Enter on the
 * splitter). Remembered on this machine once a drag ends, or at once for a key (layout-prefs).
 */
type BoardEdgeStore = {
  edge: number | null;
  /** A drag in progress: applies at once, remembered by `commit` when the drag ends. */
  resize: (edge: number) => void;
  commit: () => void;
  /**
   * A key pressed on the splitter (keyedBoardEdge), from the board's measured `edge` within `max`:
   * a step applies and is remembered at once, Enter fills. False for a key it leaves to the page.
   */
  key: (key: string, shift: boolean, edge: number, max: number) => boolean;
  /** Back to filling the space, remembered. */
  fill: () => void;
};

export const useBoardEdgeStore = create<BoardEdgeStore>((set, get) => ({
  edge: restoredBoardEdge(loadBoardEdge()),
  resize: (edge) => set({ edge }),
  commit: () => saveBoardEdge(get().edge),
  key: (key, shift, edge, max) => {
    const next = keyedBoardEdge(key, shift, edge, max);
    if (next === null) return false;
    if (next === "fill") get().fill();
    else {
      set({ edge: next });
      saveBoardEdge(next);
    }
    return true;
  },
  fill: () => {
    set({ edge: null });
    saveBoardEdge(null);
  }
}));
