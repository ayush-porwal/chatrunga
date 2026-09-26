import { useEffect, useMemo, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import type { Color } from "@chaturanga/shared/types/chess";
import { cn } from "@/lib/utils";
import { useBoardAppearance, useCgBoardBackground } from "../board/useBoardAppearance";
import { useBoardPolish } from "../board/useBoardPolish";
import {
  PIECE_MOVE_MS,
  RAPID_STEP_MS,
  fadeInSquares,
  isOneMoveApart,
  isRapidNavigation,
  usePrefersReducedMotion
} from "../board/board-motion";
import "../board/board.css";

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
  const lastRef = useRef({ fen: "", at: 0 });
  const { appearance, squareBackground, squareColors, pieceClassName } = useBoardAppearance();
  const reducedMotion = usePrefersReducedMotion();
  const animationEnabled = appearance.boardAnimation && !reducedMotion;
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
    // Chessground keeps itself sized (its own ResizeObserver); no rebuilds on resize.
    const ground = Chessground(elementRef.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: appearance.showCoordinates,
      ranksPosition: "left",
      animation: { enabled: false, duration: PIECE_MOVE_MS },
      drawable: {
        enabled: false,
        visible: true,
        defaultSnapToValidMove: false,
        shapes
      }
    });
    groundRef.current = ground;
    lastRef.current = { fen, at: performance.now() };
    return () => {
      ground.destroy();
      groundRef.current = null;
    };
    // The board API is created once; prop updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ground = groundRef.current;
    if (!ground || ground.state.coordinates === appearance.showCoordinates) return;
    ground.set({ coordinates: appearance.showCoordinates });
    ground.redrawAll();
  }, [appearance.showCoordinates]);

  // Slide pieces for a single move at a calm pace; snap for jumps and while scrubbing.
  const lastFrom = lastMove?.[0];
  const lastTo = lastMove?.[1];
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
    const now = performance.now();
    const previous = lastRef.current;
    const changed = previous.fen !== fen;
    const animate = animationEnabled && changed && now - previous.at > RAPID_STEP_MS && !isRapidNavigation(now) && isOneMoveApart(previous.fen, fen);
    if (changed) lastRef.current = { fen, at: now };
    // Snapping mid-slide: drop the running slide so pieces land on the new position at once.
    if (!animate) ground.state.animation.current = undefined;
    ground.set({
      fen,
      orientation,
      animation: { enabled: animate, duration: PIECE_MOVE_MS },
      lastMove: lastFrom && lastTo ? [lastFrom as Key, lastTo as Key] : undefined,
      drawable: { shapes }
    });
    if (changed && !isRapidNavigation(now)) window.requestAnimationFrame(() => fadeInSquares(elementRef.current, "square.last-move"));
  }, [animationEnabled, fen, orientation, lastFrom, lastTo, shapes]);

  useCgBoardBackground(elementRef, squareBackground, squareColors);
  useBoardPolish(elementRef);

  return (
    <div
      ref={elementRef}
      className={cn("cg-wrap board-surface min-h-0 min-w-0 overflow-hidden rounded-lg", pieceClassName, className)}
      aria-label="Review board"
    />
  );
}
