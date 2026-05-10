import { create } from "zustand";
import type { BoardArrow, BoardHighlight, Square } from "../../../shared/types/chess";

type BoardStore = {
  selectedSquare: Square | null;
  legalTargets: Square[];
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
  drawingArrow: BoardArrow | null;
  setSelectedSquare: (square: Square | null) => void;
  setLegalTargets: (targets: Square[]) => void;
  setAnnotations: (arrows: BoardArrow[], highlights: BoardHighlight[]) => void;
  addArrow: (arrow: BoardArrow) => void;
  addHighlight: (highlight: BoardHighlight) => void;
  clearAnnotationsForCurrentNode: () => void;
};

export const useBoardStore = create<BoardStore>((set) => ({
  selectedSquare: null,
  legalTargets: [],
  arrows: [],
  highlights: [],
  drawingArrow: null,
  setSelectedSquare: (selectedSquare) => set({ selectedSquare }),
  setLegalTargets: (legalTargets) => set({ legalTargets }),
  setAnnotations: (arrows, highlights) => set({ arrows, highlights }),
  addArrow: (arrow) => set((state) => ({ arrows: [...state.arrows, arrow] })),
  addHighlight: (highlight) =>
    set((state) => ({ highlights: [...state.highlights, highlight] })),
  clearAnnotationsForCurrentNode: () => set({ arrows: [], highlights: [] })
}));
