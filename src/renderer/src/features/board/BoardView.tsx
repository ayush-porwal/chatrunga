import { useEffect, useMemo, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { legalDestsForFen, isPromotionMove, statusForFen } from "../../../../shared/chess/position";
import type { AnnotationColor, BoardArrow, BoardHighlight } from "../../../../shared/types/chess";
import { useBoardStore } from "../../stores/board-store";
import { useGameStore } from "../../stores/game-store";
import { useSettingsQuery } from "../../queries/api";
import { defaultSettings } from "../../../../shared/types/settings";

const brushToColor: Record<string, AnnotationColor> = {
  green: "green",
  red: "red",
  yellow: "yellow",
  blue: "blue"
};

export function BoardView() {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const groundRef = useRef<Api | null>(null);
  const currentFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const moveTree = useGameStore((state) => state.moveTree);
  const makeMove = useGameStore((state) => state.makeMove);
  const setPendingPromotion = useGameStore((state) => state.setPendingPromotion);
  const setNodeAnnotations = useGameStore((state) => state.setNodeAnnotations);
  const setAnnotations = useBoardStore((state) => state.setAnnotations);
  const settings = useSettingsQuery();
  const appearance = settings.data ?? defaultSettings;
  const currentNode = moveTree.find((node) => node.id === currentNodeId);
  const status = useMemo(() => statusForFen(currentFen), [currentFen]);

  useEffect(() => {
    if (!currentNode) return;
    setAnnotations(currentNode.arrows, currentNode.highlights);
  }, [currentNode, setAnnotations]);

  useEffect(() => {
    if (!elementRef.current) return;
    groundRef.current = Chessground(elementRef.current, {
      coordinates: appearance.showCoordinates,
      disableContextMenu: true,
      highlight: { lastMove: true, check: true },
      animation: { enabled: appearance.boardAnimation, duration: 180 },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: true, visible: true, defaultSnapToValidMove: true },
      movable: { free: false, rookCastle: true }
    });
    return () => groundRef.current?.destroy();
  }, [appearance.boardAnimation, appearance.showCoordinates]);

  useEffect(() => {
    const dests = legalDestsForFen(currentFen);
    const shapes = shapesFromAnnotations(currentNode?.arrows ?? [], currentNode?.highlights ?? []);
    groundRef.current?.set({
      fen: currentFen,
      orientation,
      coordinates: appearance.showCoordinates,
      animation: { enabled: appearance.boardAnimation, duration: 180 },
      turnColor: status.turn,
      check: status.isCheck,
      lastMove: currentNode?.uci ? ([currentNode.uci.slice(0, 2), currentNode.uci.slice(2, 4)] as Key[]) : undefined,
      movable: {
        color: status.isEnd ? undefined : status.turn,
        dests,
        showDests: appearance.showLegalMoves,
        free: false,
        rookCastle: true,
        events: {
          after: (orig, dest) => {
            if (isPromotionMove(currentFen, orig, dest)) {
              setPendingPromotion({ from: orig, to: dest });
              return;
            }
            makeMove({ from: orig as never, to: dest as never });
          }
        }
      },
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        shapes,
        onChange: (newShapes) => {
          const { arrows, highlights } = annotationsFromShapes(newShapes);
          setAnnotations(arrows, highlights);
          setNodeAnnotations(currentNodeId, { arrows, highlights });
        }
      }
    });
  }, [
    appearance.boardAnimation,
    appearance.showCoordinates,
    appearance.showLegalMoves,
    currentFen,
    currentNode,
    currentNodeId,
    makeMove,
    orientation,
    setAnnotations,
    setNodeAnnotations,
    setPendingPromotion,
    status.isCheck,
    status.isEnd,
    status.turn
  ]);

  return (
    <div className="board-wrap">
      <div
        className={`is2d board board-theme-${appearance.boardTheme} piece-set-${appearance.pieceStyle}`}
        ref={elementRef}
      />
    </div>
  );
}

function shapesFromAnnotations(arrows: BoardArrow[], highlights: BoardHighlight[]): DrawShape[] {
  return [
    ...arrows.map((arrow) => ({ orig: arrow.orig as Key, dest: arrow.dest as Key, brush: arrow.color })),
    ...highlights.map((highlight) => ({ orig: highlight.square as Key, brush: highlight.color }))
  ];
}

function annotationsFromShapes(shapes: DrawShape[]): {
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
} {
  const arrows: BoardArrow[] = [];
  const highlights: BoardHighlight[] = [];
  for (const shape of shapes) {
    const color = brushToColor[shape.brush ?? "green"] ?? "green";
    if (shape.dest) arrows.push({ orig: shape.orig as never, dest: shape.dest as never, color });
    else highlights.push({ square: shape.orig as never, color });
  }
  return { arrows, highlights };
}
