import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Cpu, UserRound } from "lucide-react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key, MoveMetadata } from "@lichess-org/chessground/types";
import { formatClockForDisplay, formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { clocksOnPathToNode, nodeIdForBoardFen } from "@chaturanga/shared/chess/pgn";
import { legalDestsForFen, isPromotionMove, statusForFen } from "@chaturanga/shared/chess/position";
import type { AnnotationColor, BoardArrow, BoardHighlight, Color } from "@chaturanga/shared/types/chess";
import type { EngineClockLive } from "../../stores/game-store";
import { useBoardStore } from "../../stores/board-store";
import { useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { useReviewStore } from "../../stores/review-store";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings,
  piecePresentationTailwindClass
} from "@chaturanga/shared/types/settings";
import type { BoardTheme } from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { localImageSrc } from "@/lib/local-image";
import { muted } from "@/lib/ui";

const brushToColor: Record<string, AnnotationColor> = {
  green: "green",
  red: "red",
  yellow: "yellow",
  blue: "blue"
};

const LINE_BRUSHES = ["paleGreen", "paleBlue", "yellow", "red", "purple"];

const boardThemeClass: Record<BoardTheme, string> = {
  brown: "[&_cg-board]:bg-[conic-gradient(#b58863_25%,#f0d9b5_0_50%,#b58863_0_75%,#f0d9b5_0)] [&_cg-board]:bg-[length:25%_25%]",
  green: "[&_cg-board]:bg-[conic-gradient(#769656_25%,#eeeed2_0_50%,#769656_0_75%,#eeeed2_0)] [&_cg-board]:bg-[length:25%_25%]",
  blue: "[&_cg-board]:bg-[conic-gradient(#5f8fbf_25%,#d7e8f7_0_50%,#5f8fbf_0_75%,#d7e8f7_0)] [&_cg-board]:bg-[length:25%_25%]",
  purple: "[&_cg-board]:bg-[conic-gradient(#8364a2_25%,#e8ddf5_0_50%,#8364a2_0_75%,#e8ddf5_0)] [&_cg-board]:bg-[length:25%_25%]",
  gray: "[&_cg-board]:bg-[conic-gradient(#8f8f8f_25%,#d9d9d9_0_50%,#8f8f8f_0_75%,#d9d9d9_0)] [&_cg-board]:bg-[length:25%_25%]",
  rose: "[&_cg-board]:bg-[conic-gradient(#b17278_25%,#eaded0_0_50%,#b17278_0_75%,#eaded0_0)] [&_cg-board]:bg-[length:25%_25%]",
  newspaper: "[&_cg-board]:bg-[conic-gradient(#9b927d_25%,#f6f0df_0_50%,#9b927d_0_75%,#f6f0df_0)] [&_cg-board]:bg-[length:25%_25%]",
  wood: "[&_cg-board]:bg-[conic-gradient(#9c6235_25%,#e4bf83_0_50%,#9c6235_0_75%,#e4bf83_0)] [&_cg-board]:bg-[length:25%_25%]",
  walnut: "[&_cg-board]:bg-[conic-gradient(#6f452c_25%,#d0a56f_0_50%,#6f452c_0_75%,#d0a56f_0)] [&_cg-board]:bg-[length:25%_25%]",
  slate: "[&_cg-board]:bg-[conic-gradient(#59636f_25%,#c9d1d9_0_50%,#59636f_0_75%,#c9d1d9_0)] [&_cg-board]:bg-[length:25%_25%]"
};

const customBoardThemeClass =
  "[&_cg-board]:bg-[conic-gradient(var(--board-square-dark)_25%,var(--board-square-light)_0_50%,var(--board-square-dark)_0_75%,var(--board-square-light)_0)] [&_cg-board]:bg-[length:25%_25%]";

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
  const gameSource = useGameStore((state) => state.source);
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
  const solutionIndex = usePuzzleStore((state) => state.solutionIndex);
  const setAnnotations = useBoardStore((state) => state.setAnnotations);
  const reviewStatus = useReviewStore((state) => state.status);
  const reviewProgress = useReviewStore((state) => state.progress);
  const review = useReviewStore((state) => state.review);
  const partialMoves = useReviewStore((state) => state.partialMoves);
  const settings = useSettingsQuery();
  const engines = useEnginesQuery();
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  const appearance = hydratePieceSettings({ ...defaultSettings, ...(settings.data ?? {}) });
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
    const emptyClock = gameSource === "pgn-import" ? "—" : "";
    const fmt = (v: string | null) => (v ? formatClockForDisplay(v) : emptyClock);
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
      showTcHint: Boolean(tc && !hasMoveClocks)
    };
  }, [
    moveTree,
    currentNodeId,
    currentFen,
    headers,
    orientation,
    gameSource,
    mode,
    engineClock,
    engineClockLive,
    gameOutcome,
    clockNowMs
  ]);

  const autoShapes = useMemo<DrawShape[]>(() => {
    if (reviewStatus === "running" && reviewProgress && reviewProgress.fen === currentFen) {
      return reviewProgress.lines.slice(0, 3).map((line, index) => {
        const uci = line.pv?.[0];
        if (!uci) return null;
        return {
          orig: uci.slice(0, 2) as Key,
          dest: uci.slice(2, 4) as Key,
          brush: LINE_BRUSHES[index] ?? "paleGreen"
        } satisfies DrawShape;
      }).filter(Boolean) as DrawShape[];
    }
    const moves = review?.moves ?? partialMoves;
    const reviewMove = moves.find((item) => item.nodeId === currentNodeId);
    if (!reviewMove?.bestMove) return [];
    const arrows: DrawShape[] = [];
    arrows.push({
      orig: reviewMove.bestMove.slice(0, 2) as Key,
      dest: reviewMove.bestMove.slice(2, 4) as Key,
      brush: "paleGreen"
    });
    if (reviewMove.playedMove && reviewMove.playedMove !== reviewMove.bestMove) {
      const losing =
        reviewMove.classification === "blunder" ||
        reviewMove.classification === "mistake" ||
        reviewMove.classification === "missed_tactic";
      arrows.push({
        orig: reviewMove.playedMove.slice(0, 2) as Key,
        dest: reviewMove.playedMove.slice(2, 4) as Key,
        brush: losing ? "paleRed" : "paleBlue"
      });
    }
    return arrows;
  }, [reviewStatus, reviewProgress, review, partialMoves, currentNodeId, currentFen]);

  const hasCustomBoardColors = Boolean(appearance.boardSquareLight || appearance.boardSquareDark);
  const presetBoardColors = boardThemeSquareColors[appearance.boardTheme];
  const boardSquareLight = appearance.boardSquareLight ?? presetBoardColors.light;
  const boardSquareDark = appearance.boardSquareDark ?? presetBoardColors.dark;
  const boardSkinClass = hasCustomBoardColors
    ? customBoardThemeClass
    : boardThemeClass[appearance.boardTheme] ?? boardThemeClass.brown;
  const selectedPieceStyle = appearance.pieceStyle;
  const pieceSkinClass = piecePresentationTailwindClass(appearance.piecePresentation);
  const pieceSetCgWrapClass = cgWrapPieceSetClass(selectedPieceStyle);
  const boardColorStyle = hasCustomBoardColors
    ? ({
        "--board-square-light": boardSquareLight,
        "--board-square-dark": boardSquareDark
      } as CSSProperties)
    : undefined;
  const boardBackgroundImage = useMemo(
    () =>
      `conic-gradient(${boardSquareDark} 25%, ${boardSquareLight} 0 50%, ${boardSquareDark} 0 75%, ${boardSquareLight} 0)`,
    [boardSquareDark, boardSquareLight]
  );

  useEffect(() => {
    if (!currentNode) return;
    setAnnotations(currentNode.arrows, currentNode.highlights);
  }, [currentNode, setAnnotations]);

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

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const applyBoardBackground = () => {
      const board = element.querySelector<HTMLElement>("cg-board");
      if (!board) return;
      if (
        board.dataset.chaturangaBoardBackground === boardBackgroundImage &&
        board.style.backgroundImage.includes("conic-gradient")
      ) {
        return;
      }
      board.style.backgroundImage = boardBackgroundImage;
      board.style.backgroundSize = "25% 25%";
      board.dataset.chaturangaBoardBackground = boardBackgroundImage;
    };
    applyBoardBackground();
    const frames = [
      window.requestAnimationFrame(applyBoardBackground),
      window.requestAnimationFrame(() => window.requestAnimationFrame(applyBoardBackground))
    ];
    const observer = new MutationObserver(applyBoardBackground);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      observer.disconnect();
    };
  }, [boardBackgroundImage]);

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
    (orig: Key, dest: Key, promotion?: "queen" | "rook" | "bishop" | "knight") => {
      const move = { from: orig as never, to: dest as never, promotion };
      if (mode !== "puzzle" || !activePuzzle) {
        makeMove(move);
        return;
      }

      const played = `${orig}${dest}${promotionSuffix(promotion)}`;
      const expected = activePuzzle.solutionMoves[solutionIndex];
      if (!expected) {
        restoreGroundToCurrentPosition();
        return;
      }
      if (played !== expected) {
        usePuzzleStore.getState().markWrongMove({ played, expected });
        queueMicrotask(restoreGroundToCurrentPosition);
        window.requestAnimationFrame(restoreGroundToCurrentPosition);
        return;
      }

      if (!makeMove(move)) {
        queueMicrotask(restoreGroundToCurrentPosition);
        window.requestAnimationFrame(restoreGroundToCurrentPosition);
        return;
      }

      const nextIndex = solutionIndex + 1;
      if (nextIndex >= activePuzzle.solutionMoves.length) {
        usePuzzleStore.getState().markComplete();
      } else {
        usePuzzleStore.getState().advanceSolution(1, "Correct. Continue the line.");
      }
    },
    [activePuzzle, makeMove, mode, restoreGroundToCurrentPosition, solutionIndex]
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
    autoShapes,
    currentFen,
    currentNode,
    currentNodeId,
    activePuzzle,
    handleBoardMove,
    orientation,
    setAnnotations,
    setNodeAnnotations,
    setPendingPromotion,
    movablePieceColor,
    solutionIndex,
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

  const showTopPlayerRow = Boolean(
    mode === "engine" ||
    topClock ||
      topElo ||
      topName !== (topColor === "white" ? "White" : "Black")
  );
  const showBottomPlayerRow = Boolean(
    mode === "engine" ||
    bottomClock ||
      bottomElo ||
      bottomName !== (bottomColor === "white" ? "White" : "Black")
  );
  const displayedTopName =
    mode === "engine" && engineSide === topColor && activeEngine ? activeEngine.name : topName;
  const displayedBottomName =
    mode === "engine" && engineSide === bottomColor && activeEngine ? activeEngine.name : bottomName;

  return (
    <div
      className="grid min-h-0 w-full place-items-center content-center"
    >
      <div className="flex flex-col items-center gap-1.5 bg-transparent">
        {showTopPlayerRow ? (
          <div
            className="flex min-h-[30px] w-[var(--board-size)] min-w-80 items-center justify-between gap-3.5 px-0.5 py-0 text-[13px]"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-[#f4f1ea]">
                <PlayerBadge
                  color={topColor}
                  engine={mode === "engine" && engineSide === topColor ? activeEngine : null}
                />
                <span className="truncate">{displayedTopName}</span>
                {topElo ? (
                  <em className="shrink-0 rounded-[5px] border border-white/10 px-1 py-0.5 text-[11px] not-italic text-[#a9adb4]">
                    {topElo}
                  </em>
                ) : null}
              </div>
              {showTcHint ? (
                <div className={cn(muted, "mt-0.5 text-xs")}>Time control: {headers.timeControl}</div>
              ) : null}
            </div>
            {topClock ? (
              <div
                className={cn(
                  "min-w-[7ch] rounded-md bg-[#101214] px-2 py-1 text-right text-base font-bold tabular-nums text-[#f8f6ef] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]",
                  status.turn === topColor && !status.isEnd &&
                    "text-[#fbfff2] shadow-[inset_0_0_0_1px_rgb(183_214_132/0.38),0_0_22px_rgb(143_182_111/0.14)]"
                )}
              >
                {topClock}
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            "h-[var(--board-size)] min-h-80 w-[var(--board-size)] min-w-80 overflow-hidden rounded-lg border border-[#343941] shadow-[0_18px_50px_rgb(0_0_0/0.38)]",
            boardSkinClass,
            pieceSkinClass
          )}
          style={boardColorStyle}
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
              pieceSetCgWrapClass,
              orientation === "white" ? "orientation-white" : "orientation-black"
            )}
          />
        </div>
        {showBottomPlayerRow ? (
          <div
            className="flex min-h-[30px] w-[var(--board-size)] min-w-80 items-center justify-between gap-3.5 px-0.5 py-0 text-[13px]"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-[#f4f1ea]">
                <PlayerBadge
                  color={bottomColor}
                  engine={mode === "engine" && engineSide === bottomColor ? activeEngine : null}
                />
                <span className="truncate">{displayedBottomName}</span>
                {bottomElo ? (
                  <em className="shrink-0 rounded-[5px] border border-white/10 px-1 py-0.5 text-[11px] not-italic text-[#a9adb4]">
                    {bottomElo}
                  </em>
                ) : null}
              </div>
            </div>
            {bottomClock ? (
              <div
                className={cn(
                  "min-w-[7ch] rounded-md bg-[#101214] px-2 py-1 text-right text-base font-bold tabular-nums text-[#f8f6ef] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]",
                  status.turn === bottomColor && !status.isEnd &&
                    "text-[#fbfff2] shadow-[inset_0_0_0_1px_rgb(183_214_132/0.38),0_0_22px_rgb(143_182_111/0.14)]"
                )}
              >
                {bottomClock}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlayerBadge({
  color,
  engine
}: {
  color: Color;
  engine: { imagePath: string | null } | null;
}) {
  const src = localImageSrc(engine?.imagePath);
  const className = cn(
    "flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.40)]",
    color === "white"
      ? "bg-[#efe7d2] text-[#22262b]"
      : "bg-[#2b3036] text-[#f4f1ea] shadow-[0_0_0_1px_rgb(255_255_255/0.22),inset_0_1px_1px_rgb(255_255_255/0.10)]"
  );
  if (src) {
    return (
      <span className={className}>
        <img className="h-full w-full object-cover" src={src} alt="" />
      </span>
    );
  }
  return (
    <span className={className}>
      {engine ? <Cpu size={11} /> : <UserRound size={11} />}
    </span>
  );
}

function promotionSuffix(promotion?: "queen" | "rook" | "bishop" | "knight"): string {
  switch (promotion) {
    case "queen":
      return "q";
    case "rook":
      return "r";
    case "bishop":
      return "b";
    case "knight":
      return "n";
    default:
      return "";
  }
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
    if (shape.dest) arrows.push({ orig: shape.orig as never, dest: shape.dest as never, color });
    else highlights.push({ square: shape.orig as never, color });
  }
  return { arrows, highlights };
}
