import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import type { DrawShape } from "@lichess-org/chessground/draw";
import { uciSquares } from "@chaturanga/shared/chess/square";
import type { Square } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";

/*
 * What Game review's board shows for a moment while the pointer rests on (or the keyboard focuses)
 * a move or a square named in the coach's text: the position the text is about, with the move's
 * arrow or a ring on the square. Leaving puts the board back. Nothing about the game changes, and
 * nothing is searched: the board only draws it.
 */

export type BoardPreview =
  /** A move: the position before it, with its arrow. */
  | { kind: "move"; fen: string; uci: string }
  /** A square: the position the text is about, with a ring on it. */
  | { kind: "square"; fen: string; square: Square };

/** A preview and the position the board showed when it began (see shownPreview). */
type ActivePreview = { preview: BoardPreview; over: string };

/** The move's or square's own shapes on the previewed position (none for a move that isn't one). */
export function previewShapes(preview: BoardPreview): DrawShape[] {
  if (preview.kind === "square") return [{ orig: preview.square, brush: "yellow" }];
  const move = uciSquares(preview.uci);
  return move ? [{ orig: move[0], dest: move[1], brush: "green" }] : [];
}

/**
 * The preview to draw on a board showing `boardFen`: none once the board has moved since it began
 * (a click on the move, a step), so a preview never hides where the board went.
 */
export function shownPreview(active: ActivePreview | null, boardFen: string): BoardPreview | null {
  return active && active.over === boardFen ? active.preview : null;
}

type BoardPreviewStore = {
  active: ActivePreview | null;
  /** Shows `preview` over the board's position `over`. */
  show: (preview: BoardPreview, over: string) => void;
  /** Ends `preview` (another one shown since stays). */
  clear: (preview: BoardPreview) => void;
};

export const useBoardPreviewStore = create<BoardPreviewStore>((set) => ({
  active: null,
  show: (preview, over) => set({ active: { preview, over } }),
  clear: (preview) => set((state) => (state.active?.preview === preview ? { active: null } : {}))
}));

/**
 * The pointer and focus handlers that show `preview` on the board while an element is hovered or
 * focused (none for no preview), and `end`, which ends it now (an activated link). A preview still
 * shown when the element goes away ends with it.
 */
export function useBoardPreview(preview: BoardPreview | null) {
  const shown = useRef<BoardPreview | null>(null);
  const end = useCallback(() => {
    if (shown.current) useBoardPreviewStore.getState().clear(shown.current);
    shown.current = null;
  }, []);
  useEffect(() => end, [end]);
  const begin = useCallback(() => {
    if (!preview) return;
    shown.current = preview;
    useBoardPreviewStore.getState().show(preview, useGameStore.getState().currentFen);
  }, [preview]);
  const handlers = useMemo(
    () =>
      preview ? { onPointerEnter: begin, onPointerLeave: end, onFocus: begin, onBlur: end } : {},
    [begin, end, preview]
  );
  return { handlers, end };
}
