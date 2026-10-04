import { memo, useMemo, type CSSProperties } from "react";
import { parseSquare } from "chessops/util";
import type { SquareName } from "chessops/types";
import type { Color } from "@chaturanga/shared/types/chess";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings,
  piecePresentationTailwindClass,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { useSettingsQuery } from "../../queries/api";
import { CgPieceGlyph, type PreviewPieceRole } from "./piece-style-preview";
import { isSquare } from "@chaturanga/shared/chess/square";

type Cell = { color: Color; role: PreviewPieceRole } | null;

/** Chessground's own last-move tint (chessground.brown.css), so thumbnails read like the real board. */
const LAST_MOVE_TINT = "rgba(155, 199, 0, 0.41)";

function boardForFen(fen: string): ReturnType<typeof positionFromFen>["board"] | null {
  try {
    return positionFromFen(fen).board;
  } catch {
    return null;
  }
}

/** 8×8 cells, top row first, for the given orientation. Unparseable FENs give an empty board. */
function cellsForFen(
  fen: string,
  orientation: Color
): { cells: Cell[][]; squares: SquareName[][] } {
  const board = boardForFen(fen);
  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "white" ? "abcdefgh" : "hgfedcba";
  const cells: Cell[][] = [];
  const squares: SquareName[][] = [];
  for (const rank of ranks) {
    const row: Cell[] = [];
    const names: SquareName[] = [];
    for (const file of files) {
      const name = `${file}${rank}`;
      if (!isSquare(name)) continue;
      const square = parseSquare(name);
      const piece = board && square !== undefined ? board.get(square) : undefined;
      row.push(piece ? { color: piece.color, role: piece.role as PreviewPieceRole } : null);
      names.push(name);
    }
    cells.push(row);
    squares.push(names);
  }
  return { cells, squares };
}

/**
 * A static board picture: the position of `fen` in the saved board theme and piece set (or the
 * overrides, for live previews in Settings). Pieces use the same CSS as the real board, so a
 * thumbnail always matches what the game will look like when opened. No interaction.
 */
export const BoardThumbnail = memo(function BoardThumbnail({
  fen,
  orientation = "white",
  lastMove,
  light,
  dark,
  pieceStyle,
  piecePresentation,
  label,
  rounded = "lg",
  className
}: {
  fen: string;
  orientation?: Color;
  /** UCI of the last move (`e2e4`), tinted like Chessground's last-move squares. */
  lastMove?: string | null;
  light?: string;
  dark?: string;
  pieceStyle?: PieceStyle;
  piecePresentation?: PiecePresentation;
  /** Accessible description; omit for decorative thumbnails next to a visible title. */
  label?: string;
  rounded?: "md" | "lg" | "xl";
  className?: string;
}) {
  const settings = useSettingsQuery();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...settings.data });
  const preset = boardThemeSquareColors[appearance.boardTheme];
  const squareLight = light ?? appearance.boardSquareLight ?? preset.light;
  const squareDark = dark ?? appearance.boardSquareDark ?? preset.dark;
  const style = pieceStyle ?? appearance.pieceStyle;
  const presentation = piecePresentation ?? appearance.piecePresentation;
  const { cells, squares } = useMemo(() => cellsForFen(fen, orientation), [fen, orientation]);
  const highlighted =
    lastMove && lastMove.length >= 4 ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];
  // The checkerboard is drawn from a8 (light) in white orientation; flipped boards start on h1 (light) too.
  const boardStyle: CSSProperties = { "--thumb-light": squareLight, "--thumb-dark": squareDark };

  return (
    <div
      className={cn(
        // `.cg-wrap` is display:block in chessground.base.css — keep it on the outer wrapper.
        "cg-wrap relative isolate aspect-square w-full min-w-0 select-none",
        cgWrapPieceSetClass(style),
        piecePresentationTailwindClass(presentation),
        className
      )}
      // board.css gives every .cg-wrap inline-size containment (for the real board's coordinates); not needed here.
      style={{ containerType: "normal" }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div
        className={cn(
          "flex size-full flex-col overflow-hidden bg-[conic-gradient(var(--thumb-dark)_25%,var(--thumb-light)_0_50%,var(--thumb-dark)_0_75%,var(--thumb-light)_0)] bg-[length:25%_25%] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25)]",
          rounded === "md" ? "rounded-md" : rounded === "xl" ? "rounded-xl" : "rounded-lg"
        )}
        style={boardStyle}
      >
        {cells.map((row, rowIndex) => (
          <div key={rowIndex} className="flex min-h-0 flex-1">
            {row.map((cell, fileIndex) => {
              const square = squares[rowIndex][fileIndex];
              return (
                <span
                  key={square}
                  className="relative block min-w-0 flex-1 overflow-hidden"
                  style={
                    highlighted.includes(square) ? { backgroundColor: LAST_MOVE_TINT } : undefined
                  }
                >
                  {cell ? <CgPieceGlyph color={cell.color} role={cell.role} /> : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
