import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key, MoveMetadata } from "@lichess-org/chessground/types";
import { formatClockForDisplay, formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { clocksOnPathToNode, nodeIdForBoardFen } from "@chaturanga/shared/chess/pgn";
import { legalDestsForFen, isPromotionMove, statusForFen } from "@chaturanga/shared/chess/position";
import type { AnnotationColor, BoardArrow, BoardHighlight, Color, Square, UserMove } from "@chaturanga/shared/types/chess";
import type { EngineClockLive } from "../../stores/game-store";
import { useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { selectDisplayedMoves, useReviewStore } from "../../stores/review-store";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useEnginesQuery } from "../../queries/api";
import { cn } from "@/lib/utils";
import { uciFromUserMove } from "@/lib/uci";
import { submitPuzzleMove } from "../puzzles/puzzle-session";
import { PlayerRow } from "./PlayerIdentity";
import { BoardStage } from "./BoardWorkspace";
import { useBoardAppearance, useCgBoardBackground } from "./useBoardAppearance";

const brushToColor: Record<string, AnnotationColor> = {
  green: "green",
  red: "red",
  yellow: "yellow",
  blue: "blue"
};

const LOSING_CLASSIFICATIONS = new Set(["blunder", "mistake", "missed_tactic", "human_error"]);

function remainingClockMs(live: EngineClockLive, side: Color, now: number): number {
  const elapsed = live.sideToMove === side ? now - live.turnStartedAt : 0;
  return Math.max(0, (side === "white" ? live.whiteMs : live.blackMs) - elapsed);
}

export function BoardView() {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const groundRef = useRef<Api | null>(null);
  const currentFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const headers = useGameStore((state) => state.headers);
  const mode = useGameStore((state) => state.mode);
  const engineSide = useGameStore((state) => state.engineSide);
  const engineClock = useGameStore((state) => state.engineClock);
  const engineClockLive = useGameStore((state) => state.engineClockLive);
  const gameOutcome = useGameStore((state) => state.gameOutcome);
  const moveTree = useGameStore((state) => state.moveTree);
  const makeMove = useGameStore((state) => state.makeMove);
  const setPendingPromotion = useGameStore((state) => state.setPendingPromotion);
  const setNodeAnnotations = useGameStore((state) => state.setNodeAnnotations);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  const reviewMoves = useReviewStore(selectDisplayedMoves);
  const engines = useEnginesQuery();
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  const { appearance, squareBackground, pieceClassName } = useBoardAppearance();
  const activeEngine = engines.data?.find((engine) => engine.id === activeEngineId) ?? null;
  const currentNode = moveTree.find((node) => node.id === currentNodeId);
  const status = useMemo(() => statusForFen(currentFen), [currentFen]);

  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!engineClock || !engineClockLive || gameOutcome) return;
    const refresh = () => setClockNowMs(Date.now());
    const tid = window.setTimeout(refresh, 0);
    const id = window.setInterval(refresh, 250);
    return () => {
      window.clearTimeout(tid);
      window.clearInterval(id);
    };
  }, [engineClock, engineClockLive, gameOutcome]);

  /** Chessground premove requires movable.color to stay on the human's pieces while waiting (e.g. vs engine). */
  const movablePieceColor = useMemo<"white" | "black" | undefined>(() => {
    if (gameOutcome || status.isEnd) return undefined;
    if (mode === "engine" && engineSide) return engineSide === "white" ? "black" : "white";
    return status.turn;
  }, [engineSide, gameOutcome, mode, status.isEnd, status.turn]);

  const {
    topName,
    topElo,
    topClock,
    topColor,
    bottomName,
    bottomElo,
    bottomClock,
    bottomColor,
    showTcHint
  } = useMemo(() => {
    const self = moveTree.find((n) => n.id === currentNodeId);
    const clockAnchorId =
      self?.fenAfter === currentFen ? currentNodeId : nodeIdForBoardFen(moveTree, currentFen, currentNodeId);
    const { white: wClock, black: bClock } = clocksOnPathToNode(moveTree, clockAnchorId);
    const hasMoveClocks = Boolean(wClock ?? bClock);
    const white = headers.white?.trim() || "White";
    const black = headers.black?.trim() || "Black";
    const wElo = headers.whiteElo?.trim() || null;
    const bElo = headers.blackElo?.trim() || null;
    const tc = headers.timeControl?.trim() || null;

    const topIsBlack = orientation === "white";
    // No clock box at all when the game has no clock data (e.g. PGN imports without %clk).
    const fmt = (v: string | null) => (v ? formatClockForDisplay(v) : "");
    const liveClock = mode === "engine" && Boolean(engineClock);
    let topClockOut = fmt(topIsBlack ? bClock : wClock);
    let bottomClockOut = fmt(topIsBlack ? wClock : bClock);
    if (mode === "engine" && engineClock && engineClockLive && !gameOutcome) {
      const wMs = remainingClockMs(engineClockLive, "white", clockNowMs);
      const bMs = remainingClockMs(engineClockLive, "black", clockNowMs);
      topClockOut = formatMillisecondsClock(topIsBlack ? bMs : wMs);
      bottomClockOut = formatMillisecondsClock(topIsBlack ? wMs : bMs);
    }
    return {
      topName: topIsBlack ? black : white,
      topElo: topIsBlack ? bElo : wElo,
      topClock: topClockOut,
      topColor: (topIsBlack ? "black" : "white") as Color,
      bottomName: topIsBlack ? white : black,
      bottomElo: topIsBlack ? wElo : bElo,
      bottomClock: bottomClockOut,
      bottomColor: (topIsBlack ? "white" : "black") as Color,
      // The live engine clock already shows the time control; only hint it for imported games.
      showTcHint: Boolean(tc && tc !== "-" && !hasMoveClocks && !liveClock)
    };
  }, [
    moveTree,
    currentNodeId,
    currentFen,
    headers,
    orientation,
    mode,
    engineClock,
    engineClockLive,
    gameOutcome,
    clockNowMs
  ]);

  const autoShapes = useMemo<DrawShape[]>(() => {
    // Only completed moves draw arrows (never the live lines of the move being searched, which
    // change several times a second and made the board flicker).
    const reviewMove = reviewMoves.find((item) => item.nodeId === currentNodeId);
    if (!reviewMove?.bestMove) return [];
    const arrows: DrawShape[] = [
      { orig: reviewMove.bestMove.slice(0, 2) as Key, dest: reviewMove.bestMove.slice(2, 4) as Key, brush: "paleGreen" }
    ];
    if (reviewMove.playedMove && reviewMove.playedMove !== reviewMove.bestMove) {
      arrows.push({
        orig: reviewMove.playedMove.slice(0, 2) as Key,
        dest: reviewMove.playedMove.slice(2, 4) as Key,
        brush: LOSING_CLASSIFICATIONS.has(reviewMove.classification) ? "paleRed" : "paleBlue"
      });
    }
    return arrows;
  }, [reviewMoves, currentNodeId]);

  useEffect(() => {
    if (!elementRef.current) return;
    groundRef.current = Chessground(elementRef.current, {
      disableContextMenu: true,
      highlight: { lastMove: true, check: true },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: true, visible: true, defaultSnapToValidMove: true },
      movable: { free: false, rookCastle: true },
      premovable: { enabled: true, showDests: true, castle: true }
    });
    window.requestAnimationFrame(() => groundRef.current?.redrawAll());
    return () => groundRef.current?.destroy();
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let frame = 0;
    const redraw = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => groundRef.current?.redrawAll());
    };
    const observer = new ResizeObserver(redraw);
    observer.observe(element);
    redraw();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useCgBoardBackground(elementRef, squareBackground);

  const restoreGroundToCurrentPosition = useCallback(() => {
    const ground = groundRef.current;
    if (!ground) return;
    const nextStatus = statusForFen(currentFen);
    ground.cancelPremove();
    ground.cancelMove();
    ground.selectSquare(null);
    ground.set({
      fen: currentFen,
      orientation,
      turnColor: nextStatus.turn,
      check: nextStatus.isCheck,
      lastMove: currentNode?.uci
        ? ([currentNode.uci.slice(0, 2), currentNode.uci.slice(2, 4)] as Key[])
        : undefined,
      movable: {
        color: movablePieceColor,
        dests: legalDestsForFen(currentFen),
        showDests: appearance.showLegalMoves,
        free: false,
        rookCastle: true
      }
    });
    ground.redrawAll();
  }, [
    appearance.showLegalMoves,
    currentFen,
    currentNode,
    movablePieceColor,
    orientation
  ]);

  const handleBoardMove = useCallback(
    (orig: Key, dest: Key, promotion?: UserMove["promotion"]) => {
      const move: UserMove = { from: orig as Square, to: dest as Square, promotion };
      if (mode !== "puzzle" || !activePuzzle) {
        makeMove(move);
        return;
      }
      if (!submitPuzzleMove(uciFromUserMove(move), () => makeMove(move))) {
        // Chessground already moved the piece; put it back once it has finished its own update.
        queueMicrotask(restoreGroundToCurrentPosition);
        window.requestAnimationFrame(restoreGroundToCurrentPosition);
      }
    },
    [activePuzzle, makeMove, mode, restoreGroundToCurrentPosition]
  );

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
      lastMove: currentNode?.uci
        ? ([currentNode.uci.slice(0, 2), currentNode.uci.slice(2, 4)] as Key[])
        : undefined,
      premovable: {
        enabled: Boolean(movablePieceColor),
        showDests: appearance.showLegalMoves,
        castle: true
      },
      movable: {
        color: movablePieceColor,
        dests,
        showDests: appearance.showLegalMoves,
        free: false,
        rookCastle: true,
        events: {
          after: (orig, dest, meta?: MoveMetadata) => {
            const fenBeforeMove = useGameStore.getState().currentFen;
            if (isPromotionMove(fenBeforeMove, orig, dest)) {
              if (meta?.premove) {
                handleBoardMove(orig, dest, "queen");
                return;
              }
              setPendingPromotion({ from: orig, to: dest });
              return;
            }
            handleBoardMove(orig, dest);
          }
        }
      },
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        shapes,
        autoShapes,
        onChange: (newShapes) => setNodeAnnotations(currentNodeId, annotationsFromShapes(newShapes))
      }
    });
  }, [
    appearance.boardAnimation,
    appearance.showCoordinates,
    appearance.showLegalMoves,
    autoShapes,
    currentFen,
    currentNode,
    currentNodeId,
    handleBoardMove,
    orientation,
    setNodeAnnotations,
    setPendingPromotion,
    movablePieceColor,
    status.isCheck,
    status.isEnd,
    status.turn
  ]);

  useEffect(() => {
    const ground = groundRef.current;
    if (!ground || mode !== "engine" || !engineSide || status.isEnd) return;
    const humanColor = engineSide === "white" ? "black" : "white";
    if (status.turn !== humanColor) return;
    queueMicrotask(() => ground.playPremove());
  }, [currentFen, engineSide, mode, status.isEnd, status.turn]);

  // Player rows always render (fixed height) so the board never jumps between modes.
  const nameFor = (color: Color, name: string) => {
    if (mode !== "engine" || !engineSide) return name;
    if (engineSide === color) return activeEngine?.name ?? name;
    return name === (color === "white" ? "White" : "Black") ? "You" : name;
  };

  return (
    <BoardStage
      top={
        <PlayerRow
          color={topColor}
          name={nameFor(topColor, topName)}
          elo={topElo}
          clock={topClock}
          clockActive={status.turn === topColor && !status.isEnd}
          engine={mode === "engine" && engineSide === topColor ? activeEngine : null}
          hint={showTcHint ? `Time control ${headers.timeControl}` : null}
        />
      }
      bottom={
        <PlayerRow
          color={bottomColor}
          name={nameFor(bottomColor, bottomName)}
          elo={bottomElo}
          clock={bottomClock}
          clockActive={status.turn === bottomColor && !status.isEnd}
          engine={mode === "engine" && engineSide === bottomColor ? activeEngine : null}
        />
      }
    >
      {/*
        Chessground mutates the mount node’s classList (cg-wrap, orientation-*, manipulable).
        Keeping those classes in React-controlled className prevents reconciliation from stripping them,
        which would break piece sprites that target `.cg-wrap piece.*` in chessground.cburnett.css.
        Non-default sets also apply `piece-set-*` here so scoped rules in generated-piece-themes.css override those sprites.
      */}
      <div
        ref={elementRef}
        className={cn(
          "cg-wrap manipulable h-full w-full",
          pieceClassName,
          orientation === "white" ? "orientation-white" : "orientation-black"
        )}
      />
    </BoardStage>
  );
}

function shapesFromAnnotations(arrows: BoardArrow[], highlights: BoardHighlight[]): DrawShape[] {
  return [
    ...arrows.map((arrow) => ({
      orig: arrow.orig as Key,
      dest: arrow.dest as Key,
      brush: arrow.color
    })),
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
    if (shape.dest) arrows.push({ orig: shape.orig as Square, dest: shape.dest as Square, color });
    else highlights.push({ square: shape.orig as Square, color });
  }
  return { arrows, highlights };
}
