import { useEffect, useState, type CSSProperties } from "react";
import type { Square } from "@chaturanga/shared/types/chess";
import {
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings,
  pieceSizesClass
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { usePieceSet } from "@/styles/generated-piece-themes";
import { useSettingsQuery } from "../../queries/api";
import { usePrefersReducedMotion } from "../board/board-motion";
import { useBoardSquareColors } from "../play/piece-art";
import { CgPieceGlyph } from "../settings/piece-style-preview";
import {
  OPERA_LOOP_MATED_SQUARE,
  OPERA_LOOP_TICK_MS,
  operaLoopFinalView,
  operaLoopFrames,
  operaLoopView
} from "./opera-loop";

/**
 * The welcome's board: Morphy's finish from the Opera game on a loop (opera-loop.ts has the
 * sequence), in the user's board colours and piece set. Pieces slide, captures fade, the last move
 * is highlighted and the mated king's square glows. It is mounted once for the whole welcome, so it
 * keeps going across steps. Reduced motion: the final mate position, still. Illustration only.
 */
export function Stage() {
  const reducedMotion = usePrefersReducedMotion();
  const tick = useLoopTick(!reducedMotion);
  const view = reducedMotion ? operaLoopFinalView() : operaLoopView(tick);
  const frame = operaLoopFrames()[view.frame];
  const settings = useSettingsQuery();
  const { pieceStyle, pieceSizes } = hydratePieceSettings({ ...defaultSettings, ...settings.data });
  usePieceSet(pieceStyle);
  const { light, dark } = useBoardSquareColors();
  const squares: CSSProperties = { "--thumb-light": light, "--thumb-dark": dark };

  return (
    <div
      role="img"
      aria-label="Morphy’s Opera game, played on a loop"
      data-slot="onb-board"
      data-fading={view.fading || undefined}
      className={cn(
        "onb-board onb-board-in cg-wrap relative size-[808px] select-none overflow-hidden rounded-[14px] shadow-[0_0_0_1px_#000,0_40px_80px_-30px_#000]",
        cgWrapPieceSetClass(pieceStyle),
        pieceSizesClass(pieceSizes)
      )}
      // Unlayered `.cg-wrap` rules (display:block, board.css inline-size containment) beat utilities.
      style={{ containerType: "normal" }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[conic-gradient(var(--thumb-dark)_25%,var(--thumb-light)_0_50%,var(--thumb-dark)_0_75%,var(--thumb-light)_0)] bg-[length:25%_25%]"
        style={squares}
      />
      {/* The last move and the mate glow; they fade out with the pieces before a replay. */}
      <div aria-hidden className="onb-fade absolute inset-0">
        {frame.lastMove?.map((square) => (
          <span
            key={`${view.cycle}-${view.frame}-${square}`}
            className="onb-highlight absolute size-[12.5%]"
            style={place(square)}
          />
        ))}
        {view.mate ? (
          <span className="onb-mate absolute size-[12.5%]" style={place(OPERA_LOOP_MATED_SQUARE)} />
        ) : null}
      </div>
      {/* A new run draws fresh pieces (faded in) rather than sliding the old ones back. */}
      <div
        key={view.cycle}
        aria-hidden
        className={cn("onb-fade absolute inset-0", view.cycle > 0 && "onb-replay-in")}
      >
        {frame.pieces.map((piece) => (
          <span
            key={piece.id}
            data-captured={piece.captured || undefined}
            className="onb-piece absolute left-0 top-0 size-[12.5%]"
            style={at(piece.square)}
          >
            <CgPieceGlyph color={piece.color} role={piece.role} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** A square's column and row from the top left (white at the bottom). */
function cell(square: Square): { file: number; row: number } {
  return { file: square.charCodeAt(0) - 97, row: 8 - Number(square[1]) };
}

/** A piece's place, as a transform of its 1/8-size box, so a move slides. */
function at(square: Square): CSSProperties {
  const { file, row } = cell(square);
  return { transform: `translate(${file * 100}%, ${row * 100}%)` };
}

/** A square overlay's place (left/top, leaving `transform` to its animation). */
function place(square: Square): CSSProperties {
  const { file, row } = cell(square);
  return { left: `${file * 12.5}%`, top: `${row * 12.5}%` };
}

/** Counts ticks while `running`; the count survives pauses, so the loop resumes where it was. */
function useLoopTick(running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), OPERA_LOOP_TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  return tick;
}
