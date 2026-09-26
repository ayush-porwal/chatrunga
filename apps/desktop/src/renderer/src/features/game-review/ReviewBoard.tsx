import { useEffect, useMemo, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import type { Color } from "@chaturanga/shared/types/chess";
import { cn } from "@/lib/utils";
import { useBoardAppearance, useCgBoardBackground } from "../board/useBoardAppearance";

export type ReviewArrow = {
  orig: string;
  dest: string;
  brush: "green" | "red" | "blue" | "yellow";
};

type ReviewBoardProps = {
  fen: string;
  orientation: Color;
  arrows?: ReviewArrow[];
  lastMove?: [string, string];
  className?: string;
};

const NO_ARROWS: ReviewArrow[] = [];

export function ReviewBoard({ fen, orientation, arrows = NO_ARROWS, lastMove, className }: ReviewBoardProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const groundRef = useRef<Api | null>(null);
  const { appearance, squareBackground, pieceClassName } = useBoardAppearance();
  const shapes = useMemo<DrawShape[]>(
    () =>
      arrows.map((arrow) => ({
        orig: arrow.orig as Key,
        dest: arrow.dest as Key,
        brush: arrow.brush
      })),
    [arrows]
  );

  useEffect(() => {
    if (!elementRef.current) return;
    const ground = Chessground(elementRef.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: appearance.showCoordinates,
      animation: { enabled: appearance.boardAnimation, duration: 160 },
      drawable: {
        enabled: false,
        visible: true,
        defaultSnapToValidMove: false,
        shapes
      }
    });
    groundRef.current = ground;
    const redraw = () => window.requestAnimationFrame(() => ground.redrawAll());
    const observer = new ResizeObserver(redraw);
    observer.observe(elementRef.current);
    redraw();
    return () => {
      observer.disconnect();
      ground.destroy();
      groundRef.current = null;
    };
    // The board API is created once; prop updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
    ground.set({
      fen,
      orientation,
      lastMove: lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined,
      drawable: { shapes }
    });
  }, [fen, orientation, lastMove, shapes]);

  useCgBoardBackground(elementRef, squareBackground);

  return (
    <div
      ref={elementRef}
      className={cn("cg-wrap min-h-0 min-w-0 overflow-hidden rounded-lg", pieceClassName, className)}
      aria-label="Review board"
    />
  );
}
