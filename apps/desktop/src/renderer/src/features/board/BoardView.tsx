import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key, MoveMetadata } from "@lichess-org/chessground/types";
import { nodeIdForBoardFen } from "@chaturanga/shared/chess/pgn";
import { legalDestsForFen, isPromotionMove, statusForFen } from "@chaturanga/shared/chess/position";
import type {
  BoardArrow,
  BoardHighlight,
  Color,
  GameHeaders,
  MoveNode,
  UserMove
} from "@chaturanga/shared/types/chess";
import { isMatchMode, useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { useDisplayedReviewMoves } from "../../stores/review-validity";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useEnginesQuery } from "../../queries/api";
import { cn } from "@/lib/utils";
import { uciFromUserMove, userMoveBetween } from "@/lib/uci";
import { submitPuzzleMove } from "../puzzles/puzzle-session";
import { PlayerRow } from "./PlayerIdentity";
import { useSavedEngineSide } from "../game/use-saved-engine-side";
import { EvalBar } from "./EvalBar";
import { BoardMoveMarkBadge } from "./BoardMoveMarkBadge";
import { boardMoveMark, mainBoardSurface } from "./move-mark";
import { activeBestLine, bestLineStep } from "../game/best-line-cursor";
import { boardShowsLiveAnalysis } from "../analysis/live-analysis";
import { BoardStage } from "./BoardWorkspace";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { BroadcastClock } from "../broadcasts/BroadcastLivePanel";
import { EngineClock } from "./EngineClock";
import { boardClocksAt, timeControlLabel } from "./board-clocks";
import { useBoardAppearance, useCgBoardBackground } from "./useBoardAppearance";
import { useBoardPolish } from "./useBoardPolish";
import { restoreBoardConfig } from "./board-config";
import { celebratesEnding, liveEnding, type BoardEndState } from "./game-end";
import { useBoardConfetti } from "./useBoardConfetti";
import {
  annotationsFromShapes,
  liveAnalysisShapes,
  reviewMoveShapes,
  shapesFromAnnotations
} from "./board-shapes";
import {
  PIECE_MOVE_MS,
  RAPID_STEP_MS,
  fadeInSquares,
  isRapidNavigation,
  isSingleStep,
  usePrefersReducedMotion
} from "./board-motion";
import "./board.css";
import { uciSquares } from "@chaturanga/shared/chess/square";
import { isMaiaEngine } from "../play/engine-game";

/** How long a puzzle right/wrong flash stays on its squares (matches the CSS keyframes). */
const FLASH_MS = 900;

export function BoardView() {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const groundRef = useRef<Api | null>(null);
  const currentFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const headers = useGameStore((state) => state.headers);
  const mode = useGameStore((state) => state.mode);
  const engineSide = useGameStore((state) => state.engineSide);
  const hasLiveClock = useGameStore((state) => Boolean(state.engineClock && state.engineClockLive));
  const gameOutcome = useGameStore((state) => state.gameOutcome);
  const board = useGameStore((state) => state.board);
  const broadcastLiveTip = useBroadcastStore((state) =>
    state.follow?.board === board && state.follow.result === "*"
      ? (state.follow.liveIds.at(-1) ?? null)
      : null
  );
  const moveTree = useGameStore((state) => state.moveTree);
  const makeMove = useGameStore((state) => state.makeMove);
  const setPendingPromotion = useGameStore((state) => state.setPendingPromotion);
  const setNodeAnnotations = useGameStore((state) => state.setNodeAnnotations);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  // Only a clean solve celebrates: a puzzle finished after a wrong move or a look at the solution
  // also reaches "complete", but it was failed.
  const puzzleSolved = usePuzzleStore(
    (state) => state.feedbackKind === "complete" && state.outcome === "solved"
  );
  const reviewMoves = useDisplayedReviewMoves();
  const analysisBoard = useGameStore((state) => state.analysisBoard);
  // A BEST line on the board: its position isn't a game move, so the error it answers lends it
  // no mark, arrows or drawings; its own move is the one highlighted.
  const bestLine = useGameStore(activeBestLine);
  // The reviewed move's mark on its square: on the Analyze board only (never in play or puzzles).
  const moveMark = useMemo(
    () =>
      bestLine
        ? null
        : boardMoveMark(mainBoardSurface(mode, analysisBoard), {
            moves: reviewMoves,
            nodeId: currentNodeId
          }),
    [analysisBoard, bestLine, currentNodeId, mode, reviewMoves]
  );
  const engines = useEnginesQuery();
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  const { appearance, squareBackground, squareColors, pieceClassName } = useBoardAppearance();
  const reducedMotion = usePrefersReducedMotion();
  const activeEngine = engines.data?.find((engine) => engine.id === activeEngineId) ?? null;
  const currentNode = useMemo(
    () => (bestLine ? undefined : moveTree.find((node) => node.id === currentNodeId)),
    [bestLine, moveTree, currentNodeId]
  );
  const status = useMemo(() => statusForFen(currentFen), [currentFen]);
  const animationEnabled = appearance.boardAnimation && !reducedMotion;

  /** Chessground premove requires movable.color to stay on the human's pieces while waiting (e.g. vs engine). */
  const movablePieceColor = useMemo<"white" | "black" | undefined>(() => {
    if (gameOutcome || status.isEnd) return undefined;
    if (isMatchMode(mode) && engineSide) return engineSide === "white" ? "black" : "white";
    return status.turn;
  }, [engineSide, gameOutcome, mode, status.isEnd, status.turn]);

  const players = useMemo(
    () =>
      playerRowsAt({
        moveTree,
        currentNodeId,
        currentFen,
        headers,
        orientation,
        liveClock: isMatchMode(mode) && hasLiveClock,
        engineGame: mode === "engine" && Boolean(engineSide)
      }),
    [moveTree, currentNodeId, currentFen, headers, orientation, mode, engineSide, hasLiveClock]
  );

  // Live analysis (never an engine or Lichess game), running or paused on this position: the start
  // of the engine's top line from this position, as many moves as the arrows draw (a string, so
  // the board only redraws when they change, not on every engine update). Only moves legal here
  // are drawn (lines of the previous position are dropped as a search starts, but never trusted).
  const showBestArrow = appearance.analysisBestMoveArrow;
  const planArrows = appearance.analysisPlanArrows;
  const liveLine = useAnalysisStore((state) => {
    if (!boardShowsLiveAnalysis({ mode, currentNodeId, currentFen }, state.paused)) return "";
    const pv = state.topLines.find((line) => (line.multipv ?? 1) === 1)?.pv;
    const line = pv?.length ? pv : state.bestMove ? [state.bestMove] : [];
    return line.slice(0, Math.max(1, planArrows)).join(" ");
  });
  const liveShapes = useMemo(
    () =>
      liveAnalysisShapes(currentFen, liveLine ? liveLine.split(" ") : [], {
        bestMoveArrow: showBestArrow,
        planArrows
      }),
    [currentFen, liveLine, planArrows, showBestArrow]
  );

  const autoShapes = useMemo<DrawShape[]>(() => {
    if (liveShapes.length) return liveShapes;
    // Only completed moves draw arrows (never the live lines of the move being searched, which
    // change several times a second and made the board flicker).
    const reviewMove = currentNode
      ? reviewMoves.find((item) => item.nodeId === currentNode.id)
      : undefined;
    if (!reviewMove) return NO_SHAPES;
    // The review's arrows, pale, under the same engine arrows settings as Game review's board.
    return reviewMoveShapes(reviewMove, { bestMoveArrow: showBestArrow, planArrows, pale: true });
  }, [liveShapes, reviewMoves, currentNode, showBestArrow, planArrows]);

  // Chessground owns its DOM and keeps it sized itself (its own ResizeObserver repositions pieces
  // on resize) — rebuilding the board on every resize frame is what used to flicker.
  useEffect(() => {
    if (!elementRef.current) return;
    const ground = Chessground(elementRef.current, {
      disableContextMenu: true,
      coordinates: false,
      ranksPosition: "left",
      highlight: { lastMove: true, check: true },
      animation: { enabled: false, duration: PIECE_MOVE_MS },
      draggable: { enabled: true, showGhost: true, distance: 3 },
      drawable: { enabled: true, visible: true, defaultSnapToValidMove: true },
      movable: { free: false, rookCastle: true },
      premovable: { enabled: true, showDests: true, castle: true }
    });
    groundRef.current = ground;
    // Chessground caches the board's screen position and refreshes it only on resize and scroll;
    // collapsing the sidebar (or Focus board) moves the board without resizing it, so clicks,
    // drags and drawn arrows landed a square off. Every press re-reads it first (capture phase,
    // before Chessground's own listener on the board).
    const element = elementRef.current;
    const refreshBounds = () => ground.state.dom.bounds.clear();
    element.addEventListener("mousedown", refreshBounds, { capture: true });
    element.addEventListener("touchstart", refreshBounds, { capture: true, passive: true });
    return () => {
      element.removeEventListener("mousedown", refreshBounds, { capture: true });
      element.removeEventListener("touchstart", refreshBounds, { capture: true });
      ground.destroy();
      groundRef.current = null;
    };
  }, []);

  // Coordinates are part of Chessground's DOM: toggling them needs one rebuild (not on every render).
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground || ground.state.coordinates === appearance.showCoordinates) return;
    ground.set({ coordinates: appearance.showCoordinates });
    ground.redrawAll();
  }, [appearance.showCoordinates]);

  useCgBoardBackground(elementRef, squareBackground, squareColors);
  useBoardPolish(elementRef);

  // Custom square classes: puzzle right/wrong flashes.
  const [flash, setFlash] = useState<{
    squares: Key[];
    kind: "correct" | "wrong";
    key: number;
  } | null>(null);
  const flashSquares = useCallback((squares: Key[], kind: "correct" | "wrong") => {
    setFlash({ squares, kind, key: performance.now() });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const customHighlights = useMemo(() => {
    const custom = new Map<Key, string>();
    if (flash) for (const square of flash.squares) custom.set(square, `cg-flash-${flash.kind}`);
    return custom;
  }, [flash]);

  const restoreGroundToCurrentPosition = useCallback(() => {
    const ground = groundRef.current;
    if (!ground) return;
    const game = useGameStore.getState();
    const {
      currentFen: fen,
      orientation: boardOrientation,
      moveTree: tree,
      currentNodeId: nodeId
    } = game;
    const line = activeBestLine(game);
    ground.cancelPremove();
    ground.cancelMove();
    ground.selectSquare(null);
    ground.set(
      restoreBoardConfig({
        fen,
        orientation: boardOrientation,
        lastMove: lastMoveOf(line ? bestLineStep(line) : tree.find((item) => item.id === nodeId)),
        movableColor: movablePieceColor,
        showDests: appearance.showLegalMoves,
        animate: animationEnabled
      })
    );
  }, [animationEnabled, appearance.showLegalMoves, movablePieceColor]);

  const handleBoardMove = useCallback(
    (orig: Key, dest: Key, promotion?: UserMove["promotion"]) => {
      const move = userMoveBetween(orig, dest, promotion);
      if (!move) return;
      if (mode !== "puzzle" || !activePuzzle) {
        makeMove(move);
        return;
      }
      if (
        submitPuzzleMove(
          uciFromUserMove(move),
          () => makeMove(move),
          useGameStore.getState().currentFen
        )
      ) {
        flashSquares([dest], "correct");
        return;
      }
      flashSquares([orig, dest], "wrong");
      // Chessground already moved the piece; put it back once it has finished its own update.
      queueMicrotask(restoreGroundToCurrentPosition);
      window.requestAnimationFrame(restoreGroundToCurrentPosition);
    },
    [activePuzzle, flashSquares, makeMove, mode, restoreGroundToCurrentPosition]
  );

  // A refused move (flag fell, game over, not at the latest move online, a refused promotion): the
  // piece Chessground already moved goes back, since the stored position — and so the effect
  // below — didn't change.
  const rejectedMoves = useGameStore((state) => state.rejectedMoves);
  const seenRejections = useRef(rejectedMoves);
  useEffect(() => {
    if (rejectedMoves === seenRejections.current) return;
    seenRejections.current = rejectedMoves;
    queueMicrotask(restoreGroundToCurrentPosition);
    window.requestAnimationFrame(restoreGroundToCurrentPosition);
  }, [rejectedMoves, restoreGroundToCurrentPosition]);

  // A promotion chosen (or dropped) without the position changing — a wrong puzzle promotion, or a
  // move refused — leaves the pawn Chessground moved on the last rank: put the board back.
  const pendingPromotion = useGameStore((state) => state.pendingPromotion);
  const promotionStart = useRef<string | null>(null);
  useEffect(() => {
    if (pendingPromotion) {
      promotionStart.current = useGameStore.getState().currentFen;
      return;
    }
    const startFen = promotionStart.current;
    promotionStart.current = null;
    if (startFen === null || useGameStore.getState().currentFen !== startFen) return;
    queueMicrotask(restoreGroundToCurrentPosition);
    window.requestAnimationFrame(restoreGroundToCurrentPosition);
  }, [pendingPromotion, restoreGroundToCurrentPosition]);

  // Position: slide pieces only for a single step taken at a calm pace; snap for jumps (Home/End,
  // clicking a distant move) and while scrubbing with a held key, so the board never lags behind.
  const lastPositionRef = useRef<{ nodeId: string | null; fen: string; at: number }>({
    nodeId: null,
    fen: "",
    at: 0
  });
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
    const previous = lastPositionRef.current;
    const positionChanged = previous.fen !== currentFen || previous.nodeId !== currentNodeId;
    const now = performance.now();
    const animate =
      animationEnabled &&
      positionChanged &&
      isSingleStep(useGameStore.getState().moveTree, previous.nodeId, currentNodeId) &&
      now - previous.at > RAPID_STEP_MS &&
      !isRapidNavigation(now);
    if (positionChanged)
      lastPositionRef.current = { nodeId: currentNodeId, fen: currentFen, at: now };
    // Snapping mid-slide: drop the running slide so pieces land on the new position at once.
    if (!animate) ground.state.animation.current = undefined;
    ground.set({
      fen: currentFen,
      orientation,
      animation: { enabled: animate, duration: PIECE_MOVE_MS },
      turnColor: status.turn,
      check: status.isCheck,
      lastMove: lastMoveOf(bestLine ? bestLineStep(bestLine) : currentNode)
    });
    if (positionChanged && !isRapidNavigation(now)) {
      // Chessground paints on its next frame; fade the fresh highlights in right after.
      window.requestAnimationFrame(() =>
        fadeInSquares(elementRef.current, "square.last-move, square.check")
      );
    }
  }, [
    animationEnabled,
    bestLine,
    currentFen,
    currentNode,
    currentNodeId,
    orientation,
    status.isCheck,
    status.turn
  ]);

  // Interaction: who may move, legal destinations, premoves and the move handler.
  // Legal moves depend on the position only: computed once per FEN, not again whenever the move
  // handler or an appearance option changes.
  const legalDests = useMemo(() => legalDestsForFen(currentFen), [currentFen]);
  useEffect(() => {
    groundRef.current?.set({
      premovable: {
        enabled: Boolean(movablePieceColor),
        showDests: appearance.showLegalMoves,
        castle: true
      },
      movable: {
        color: movablePieceColor,
        dests: legalDests,
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
      }
    });
  }, [
    appearance.showLegalMoves,
    handleBoardMove,
    legalDests,
    movablePieceColor,
    setPendingPromotion
  ]);

  // Drawn annotations (per node) and review arrows.
  useEffect(() => {
    groundRef.current?.set({
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        shapes: shapesFromAnnotations(
          currentNode?.arrows ?? NO_ARROWS,
          currentNode?.highlights ?? NO_HIGHLIGHTS
        ),
        autoShapes,
        // Drawings belong to a game move (a BEST line's position isn't one: they aren't kept).
        onChange: (newShapes) => {
          if (currentNode) setNodeAnnotations(currentNode.id, annotationsFromShapes(newShapes));
        }
      }
    });
  }, [autoShapes, currentNode, setNodeAnnotations]);

  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
    // Assigned, not passed to set(): Chessground's config merge cannot replace one Map with another.
    ground.state.highlight.custom = customHighlights;
    ground.state.dom.redraw();
  }, [customHighlights]);

  useEffect(() => {
    const ground = groundRef.current;
    if (!ground || !isMatchMode(mode) || !engineSide || status.isEnd) return;
    const humanColor = engineSide === "white" ? "black" : "white";
    if (status.turn !== humanColor) return;
    queueMicrotask(() => ground.playPremove());
  }, [currentFen, engineSide, mode, status.isEnd, status.turn]);

  // Confetti once, when the user wins as the game ends on the board (a move just played, a
  // resignation, a flag) or solves a puzzle — never when stepping to the end of a finished game.
  // The result itself shows in the titlebar and the side panel.
  const fireConfetti = useBoardConfetti();
  const endRef = useRef<BoardEndState>({
    ended: status.isEnd || Boolean(gameOutcome),
    outcome: Boolean(gameOutcome),
    treeSize: moveTree.length,
    nodeId: currentNodeId,
    puzzleSolved
  });
  useEffect(() => {
    const previous = endRef.current;
    const next: BoardEndState = {
      ended: status.isEnd || Boolean(gameOutcome),
      outcome: Boolean(gameOutcome),
      treeSize: moveTree.length,
      nodeId: currentNodeId,
      puzzleSolved
    };
    endRef.current = next;
    const ending = liveEnding(previous, { ...next, mode, parentId: currentNode?.parentId });
    if (
      !celebratesEnding(ending, { result: gameOutcome?.result ?? status.result, mode, engineSide })
    )
      return;
    // Deferred a frame so the final move's slide has started first.
    const frame = window.requestAnimationFrame(() =>
      fireConfetti(elementRef.current, ending === "puzzle" ? "puzzle" : "game")
    );
    return () => window.cancelAnimationFrame(frame);
  }, [
    currentNode?.parentId,
    currentNodeId,
    engineSide,
    fireConfetti,
    gameOutcome,
    mode,
    moveTree.length,
    puzzleSolved,
    status
  ]);

  // Player rows always render (fixed height) so the board never jumps between modes.
  const nameFor = (color: Color, name: string) => {
    if (mode !== "engine" || !engineSide) return name;
    // Maia goes by the game's name for it, with its rating ("Maia 1500").
    if (engineSide === color)
      return activeEngine && !isMaiaEngine(activeEngine)
        ? engineDisplayName(activeEngine.name)
        : name;
    return name === (color === "white" ? "White" : "Black") ? "You" : name;
  };
  // The engine's picture on its side: the match's engine while one is played, else a saved engine
  // game's (opened on the board).
  const savedEngine = useSavedEngineSide(headers);
  const engineFor = (color: Color) => {
    if (mode === "engine" && engineSide) return engineSide === color ? activeEngine : null;
    return savedEngine?.side === color ? savedEngine.engine : null;
  };
  const liveClocks = isMatchMode(mode) && hasLiveClock;
  // A followed broadcast game on its live position: the side to move's clock runs.
  const broadcastRunning = (color: Color) =>
    broadcastLiveTip === currentNodeId && status.turn === color && !status.isEnd;
  const playerRow = (player: BoardPlayer, hint?: string | null) => (
    <PlayerRow
      color={player.color}
      name={nameFor(player.color, player.name)}
      elo={player.elo}
      clock={
        liveClocks ? (
          <EngineClock color={player.color} />
        ) : player.clock && broadcastRunning(player.color) ? (
          <BroadcastClock color={player.color} fallback={player.clock} />
        ) : (
          player.clock
        )
      }
      clockActive={status.turn === player.color && !status.isEnd}
      engine={engineFor(player.color)}
      hint={hint}
    />
  );

  return (
    <BoardStage
      evalBar={<EvalBar orientation={orientation} />}
      top={playerRow(players.top, players.hint)}
      bottom={playerRow(players.bottom)}
    >
      {/* Its own stacking context: Chessground's layers and the move mark stack within the board. */}
      <div className="relative isolate h-full w-full">
        {/*
          Chessground mutates the mount node’s classList (cg-wrap, orientation-*, manipulable).
          Keeping those classes in React-controlled className prevents reconciliation from stripping them,
          which would break piece sprites that target `.cg-wrap piece.*` in chessground.cburnett.css.
          The `piece-set-*` class here lets scoped rules built by generated-piece-themes.ts override those sprites.
        */}
        <div
          ref={elementRef}
          className={cn(
            "cg-wrap board-surface manipulable h-full w-full",
            pieceClassName,
            orientation === "white" ? "orientation-white" : "orientation-black"
          )}
        />
        <BoardMoveMarkBadge mark={moveMark} orientation={orientation} />
      </div>
    </BoardStage>
  );
}

type BoardPlayer = { color: Color; name: string; elo: string | null; clock: string };

/**
 * The players from the headers: engines by their plain name (older builds saved "Stockfish
 * (managed)").
 */
function headerPlayers(headers: GameHeaders): Record<Color, { name: string; elo: string | null }> {
  return {
    white: {
      name: engineDisplayName(headers.white?.trim() ?? "") || "White",
      elo: headers.whiteElo?.trim() || null
    },
    black: {
      name: engineDisplayName(headers.black?.trim() ?? "") || "Black",
      elo: headers.blackElo?.trim() || null
    }
  };
}

/**
 * The player rows: the side at the bottom is the orientation, each with its time at this move
 * from the game's [%clk] (no clock boxes for a game without them), and the top row's hint: the
 * time control of a game without clocks (the live engine clock already shows it), or that a timed
 * engine game saved before its clocks were kept is played on without one.
 */
function playerRowsAt({
  moveTree,
  currentNodeId,
  currentFen,
  headers,
  orientation,
  liveClock,
  engineGame
}: {
  moveTree: MoveNode[];
  currentNodeId: string;
  currentFen: string;
  headers: GameHeaders;
  orientation: Color;
  /** A match's live clock shows the time instead of [%clk]. */
  liveClock: boolean;
  /** An engine game in progress (or resumed). */
  engineGame: boolean;
}): { top: BoardPlayer; bottom: BoardPlayer; hint: string | null } {
  const self = moveTree.find((n) => n.id === currentNodeId);
  const clockAnchorId =
    self?.fenAfter === currentFen
      ? currentNodeId
      : nodeIdForBoardFen(moveTree, currentFen, currentNodeId);
  const tc = headers.timeControl?.trim() || null;
  const clocks = boardClocksAt(moveTree, clockAnchorId, tc);
  const players = headerPlayers(headers);
  const row = (color: Color): BoardPlayer => ({
    color,
    ...players[color],
    clock: clocks ? clocks[color] : ""
  });
  const [topColor, bottomColor]: [Color, Color] =
    orientation === "white" ? ["black", "white"] : ["white", "black"];
  const showTcHint = Boolean(tc && tc !== "-" && !clocks && !liveClock);
  // A timed engine game saved before its clocks were kept, played on: without a clock.
  const resumedUntimed = engineGame && !liveClock;
  return {
    top: row(topColor),
    bottom: row(bottomColor),
    hint: showTcHint
      ? resumedUntimed
        ? "Resumed without a clock"
        : `Time control ${timeControlLabel(headers.timeControl)}`
      : null
  };
}

function lastMoveOf(node: Pick<MoveNode, "uci"> | undefined): Key[] | undefined {
  return (node?.uci && uciSquares(node.uci)) || undefined;
}

const NO_SHAPES: DrawShape[] = [];
const NO_ARROWS: BoardArrow[] = [];
const NO_HIGHLIGHTS: BoardHighlight[] = [];
