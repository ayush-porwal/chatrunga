import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key, MoveMetadata } from "@lichess-org/chessground/types";
import { formatClockForDisplay } from "@chaturanga/shared/chess/clock-display";
import { clocksOnPathToNode, nodeIdForBoardFen } from "@chaturanga/shared/chess/pgn";
import { legalDestsForFen, isPromotionMove, statusForFen } from "@chaturanga/shared/chess/position";
import type { AnnotationColor, BoardArrow, BoardHighlight, Color, GameMode, MoveNode, UserMove } from "@chaturanga/shared/types/chess";
import { isMatchMode, useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { selectDisplayedMoves, useReviewStore } from "../../stores/review-store";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useEnginesQuery } from "../../queries/api";
import { cn } from "@/lib/utils";
import { asSquare, uciFromUserMove, userMoveBetween } from "@/lib/uci";
import { submitPuzzleMove } from "../puzzles/puzzle-session";
import { PlayerRow } from "./PlayerIdentity";
import { EvalBar } from "./EvalBar";
import { BoardStage } from "./BoardWorkspace";
import { EngineClock } from "./EngineClock";
import { useBoardAppearance, useCgBoardBackground } from "./useBoardAppearance";
import { useBoardPolish } from "./useBoardPolish";
import { restoreBoardConfig } from "./board-config";
import {
  PIECE_MOVE_MS,
  RAPID_STEP_MS,
  fadeInSquares,
  isRapidNavigation,
  isSingleStep,
  usePrefersReducedMotion
} from "./board-motion";
import "./board.css";

const brushToColor: Record<string, AnnotationColor> = {
  green: "green",
  red: "red",
  yellow: "yellow",
  blue: "blue"
};

const LOSING_CLASSIFICATIONS = new Set(["blunder", "mistake", "missed_tactic", "human_error"]);
/** How long a puzzle right/wrong flash stays on its squares (matches the CSS keyframes). */
const FLASH_MS = 900;
/** The game-over moment: king glow, board ring and result chip. */
const FINALE_MS = 2800;

type Finale = { key: number; tone: "win" | "loss" | "draw"; title: string; detail: string | null };

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
  const moveTree = useGameStore((state) => state.moveTree);
  const makeMove = useGameStore((state) => state.makeMove);
  const setPendingPromotion = useGameStore((state) => state.setPendingPromotion);
  const setNodeAnnotations = useGameStore((state) => state.setNodeAnnotations);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  const puzzleFeedbackKind = usePuzzleStore((state) => state.feedbackKind);
  const reviewMoves = useReviewStore(selectDisplayedMoves);
  const engines = useEnginesQuery();
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  const { appearance, squareBackground, squareColors, pieceClassName } = useBoardAppearance();
  const reducedMotion = usePrefersReducedMotion();
  const activeEngine = engines.data?.find((engine) => engine.id === activeEngineId) ?? null;
  const currentNode = useMemo(() => moveTree.find((node) => node.id === currentNodeId), [moveTree, currentNodeId]);
  const status = useMemo(() => statusForFen(currentFen), [currentFen]);
  const animationEnabled = appearance.boardAnimation && !reducedMotion;

  /** Chessground premove requires movable.color to stay on the human's pieces while waiting (e.g. vs engine). */
  const movablePieceColor = useMemo<"white" | "black" | undefined>(() => {
    if (gameOutcome || status.isEnd) return undefined;
    if (isMatchMode(mode) && engineSide) return engineSide === "white" ? "black" : "white";
    return status.turn;
  }, [engineSide, gameOutcome, mode, status.isEnd, status.turn]);

  const { topName, topElo, topClock, topColor, bottomName, bottomElo, bottomClock, bottomColor, showTcHint } = useMemo(() => {
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
    const liveClock = isMatchMode(mode) && hasLiveClock;
    return {
      topName: topIsBlack ? black : white,
      topElo: topIsBlack ? bElo : wElo,
      topClock: fmt(topIsBlack ? bClock : wClock),
      topColor: (topIsBlack ? "black" : "white") as Color,
      bottomName: topIsBlack ? white : black,
      bottomElo: topIsBlack ? wElo : bElo,
      bottomClock: fmt(topIsBlack ? wClock : bClock),
      bottomColor: (topIsBlack ? "white" : "black") as Color,
      // The live engine clock already shows the time control; only hint it for imported games.
      showTcHint: Boolean(tc && tc !== "-" && !hasMoveClocks && !liveClock)
    };
  }, [moveTree, currentNodeId, currentFen, headers, orientation, mode, hasLiveClock]);

  // Live analysis: the engine's best move from this position (a string, so the board only redraws
  // when it changes, not on every engine update). Only a move legal here (lines of the previous
  // position are dropped as a search starts, but never trusted).
  const liveBest = useAnalysisStore((state) =>
    mode === "analysis"
      ? (state.topLines.find((line) => (line.multipv ?? 1) === 1)?.pv?.[0] ?? state.bestMove ?? null)
      : null
  );
  const showBestArrow = appearance.analysisBestMoveArrow;
  const bestArrow = useMemo<DrawShape | null>(() => {
    if (!showBestArrow || !liveBest) return null;
    const dests = legalDestsForFen(currentFen) as Map<string, string[]>;
    if (!dests.get(liveBest.slice(0, 2))?.includes(liveBest.slice(2, 4))) return null;
    return { orig: liveBest.slice(0, 2) as Key, dest: liveBest.slice(2, 4) as Key, brush: "blue" };
  }, [showBestArrow, liveBest, currentFen]);

  const autoShapes = useMemo<DrawShape[]>(() => {
    if (bestArrow) return [bestArrow];
    // Only completed moves draw arrows (never the live lines of the move being searched, which
    // change several times a second and made the board flicker).
    const reviewMove = reviewMoves.find((item) => item.nodeId === currentNodeId);
    if (!reviewMove?.bestMove) return NO_SHAPES;
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
  }, [bestArrow, reviewMoves, currentNodeId]);

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

  // Custom square classes: puzzle right/wrong flashes and the game-over king glow.
  const [flash, setFlash] = useState<{ squares: Key[]; kind: "correct" | "wrong"; key: number } | null>(null);
  const [finale, setFinale] = useState<Finale | null>(null);
  const flashSquares = useCallback((squares: Key[], kind: "correct" | "wrong") => {
    setFlash({ squares, kind, key: performance.now() });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!finale) return;
    const timer = window.setTimeout(() => setFinale(null), FINALE_MS);
    return () => window.clearTimeout(timer);
  }, [finale]);
  const customHighlights = useMemo(() => {
    const custom = new Map<Key, string>();
    if (finale) {
      for (const square of finaleKingSquares(currentFen, finale.tone === "draw" ? null : finaleWinner(currentFen, finale, gameOutcome?.result)))
        custom.set(square, finale.tone === "draw" ? "cg-finale-draw" : "cg-finale-win");
    }
    if (flash) for (const square of flash.squares) custom.set(square, `cg-flash-${flash.kind}`);
    return custom;
  }, [currentFen, finale, flash, gameOutcome?.result]);

  const restoreGroundToCurrentPosition = useCallback(() => {
    const ground = groundRef.current;
    if (!ground) return;
    const { currentFen: fen, orientation: boardOrientation, moveTree: tree, currentNodeId: nodeId } = useGameStore.getState();
    ground.cancelPremove();
    ground.cancelMove();
    ground.selectSquare(null);
    ground.set(
      restoreBoardConfig({
        fen,
        orientation: boardOrientation,
        lastMove: lastMoveOf(tree.find((item) => item.id === nodeId)),
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
      if (submitPuzzleMove(uciFromUserMove(move), () => makeMove(move), useGameStore.getState().currentFen)) {
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
  const lastPositionRef = useRef<{ nodeId: string | null; fen: string; at: number }>({ nodeId: null, fen: "", at: 0 });
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
    if (positionChanged) lastPositionRef.current = { nodeId: currentNodeId, fen: currentFen, at: now };
    // Snapping mid-slide: drop the running slide so pieces land on the new position at once.
    if (!animate) ground.state.animation.current = undefined;
    ground.set({
      fen: currentFen,
      orientation,
      animation: { enabled: animate, duration: PIECE_MOVE_MS },
      turnColor: status.turn,
      check: status.isCheck,
      lastMove: lastMoveOf(currentNode)
    });
    if (positionChanged && !isRapidNavigation(now)) {
      // Chessground paints on its next frame; fade the fresh highlights in right after.
      window.requestAnimationFrame(() => fadeInSquares(elementRef.current, "square.last-move, square.check"));
    }
  }, [animationEnabled, currentFen, currentNode, currentNodeId, orientation, status.isCheck, status.turn]);

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
  }, [appearance.showLegalMoves, handleBoardMove, legalDests, movablePieceColor, setPendingPromotion]);

  // Drawn annotations (per node) and review arrows.
  useEffect(() => {
    groundRef.current?.set({
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        shapes: shapesFromAnnotations(currentNode?.arrows ?? NO_ARROWS, currentNode?.highlights ?? NO_HIGHLIGHTS),
        autoShapes,
        onChange: (newShapes) => setNodeAnnotations(currentNodeId, annotationsFromShapes(newShapes))
      }
    });
  }, [autoShapes, currentNode?.arrows, currentNode?.highlights, currentNodeId, setNodeAnnotations]);

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

  // The game-over moment plays once, when the game ends on the board (a move just played, a
  // resignation, a flag, a solved puzzle) — never when stepping to the end of a finished game.
  const endRef = useRef({
    ended: status.isEnd || Boolean(gameOutcome),
    outcome: Boolean(gameOutcome),
    treeSize: moveTree.length,
    nodeId: currentNodeId,
    puzzle: puzzleFeedbackKind
  });
  useEffect(() => {
    const previous = endRef.current;
    const ended = status.isEnd || Boolean(gameOutcome);
    const puzzleSolved = mode === "puzzle" && puzzleFeedbackKind === "complete" && previous.puzzle !== "complete";
    // A move was just played onto the board (not a game loaded, not a step through existing moves).
    const movePlayed = moveTree.length === previous.treeSize + 1 && currentNode?.parentId === previous.nodeId;
    const endedLive =
      mode !== "puzzle" && ended && !previous.ended && (movePlayed || (Boolean(gameOutcome) && !previous.outcome));
    endRef.current = {
      ended,
      outcome: Boolean(gameOutcome),
      treeSize: moveTree.length,
      nodeId: currentNodeId,
      puzzle: puzzleFeedbackKind
    };
    if (!endedLive && !puzzleSolved) return;
    const next = puzzleSolved
      ? { tone: "win" as const, title: "Puzzle solved", detail: null }
      : describeFinale({ result: gameOutcome?.result ?? status.result, termination: gameOutcome?.termination ?? null, status, mode, engineSide, orientation });
    // Deferred a frame so the final move's slide has started before the moment plays.
    const frame = window.requestAnimationFrame(() => setFinale({ key: performance.now(), ...next }));
    return () => window.cancelAnimationFrame(frame);
  }, [currentNode?.parentId, currentNodeId, engineSide, gameOutcome, mode, moveTree.length, orientation, puzzleFeedbackKind, status]);

  // Player rows always render (fixed height) so the board never jumps between modes.
  const nameFor = (color: Color, name: string) => {
    if (mode !== "engine" || !engineSide) return name;
    if (engineSide === color) return activeEngine?.name ?? name;
    return name === (color === "white" ? "White" : "Black") ? "You" : name;
  };
  const liveClocks = isMatchMode(mode) && hasLiveClock;

  return (
    <BoardStage
      evalBar={<EvalBar orientation={orientation} />}
      top={
        <PlayerRow
          color={topColor}
          name={nameFor(topColor, topName)}
          elo={topElo}
          clock={liveClocks ? <EngineClock color={topColor} /> : topClock}
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
          clock={liveClocks ? <EngineClock color={bottomColor} /> : bottomClock}
          clockActive={status.turn === bottomColor && !status.isEnd}
          engine={mode === "engine" && engineSide === bottomColor ? activeEngine : null}
        />
      }
    >
      <div className="relative h-full w-full">
        {/*
          Chessground mutates the mount node’s classList (cg-wrap, orientation-*, manipulable).
          Keeping those classes in React-controlled className prevents reconciliation from stripping them,
          which would break piece sprites that target `.cg-wrap piece.*` in chessground.cburnett.css.
          Non-default sets also apply `piece-set-*` here so scoped rules in generated-piece-themes.css override those sprites.
        */}
        <div
          ref={elementRef}
          className={cn(
            "cg-wrap board-surface manipulable h-full w-full",
            pieceClassName,
            orientation === "white" ? "orientation-white" : "orientation-black"
          )}
        />
        {finale ? <FinaleOverlay key={finale.key} finale={finale} /> : null}
      </div>
    </BoardStage>
  );
}

const FinaleOverlay = memo(function FinaleOverlay({ finale }: { finale: Finale }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[inherit]" aria-hidden>
      <div className="board-finale-ring" data-tone={finale.tone} />
      <div
        className={cn(
          "board-finale-chip grid justify-items-center gap-0.5 rounded-xl border px-5 py-3 text-center shadow-popover backdrop-blur-md",
          finale.tone === "win" ? "border-warn/40 bg-surface-raised/85" : "border-line bg-surface-raised/85"
        )}
      >
        <span className="text-lg font-semibold text-fg">{finale.title}</span>
        {finale.detail ? <span className="text-xs text-fg-muted">{finale.detail}</span> : null}
      </div>
    </div>
  );
});

function describeFinale({
  result,
  termination,
  status,
  mode,
  engineSide,
  orientation
}: {
  result: string;
  termination: string | null;
  status: ReturnType<typeof statusForFen>;
  mode: string;
  engineSide: Color | null;
  orientation: Color;
}): Omit<Finale, "key"> {
  const winner: Color | null = result === "1-0" ? "white" : result === "0-1" ? "black" : null;
  const how =
    termination === "Time forfeit"
      ? "on time"
      : termination === "Player resign"
        ? "by resignation"
        : status.isCheckmate
          ? "by checkmate"
          : null;
  const drawHow = status.isStalemate ? "Stalemate" : termination ?? "Draw";
  const score = result.replace("1/2", "½");
  // An aborted online game has no result.
  if (result === "*") return { tone: "draw", title: termination ?? "Game over", detail: null };
  if (!winner) return { tone: "draw", title: "Draw", detail: `${drawHow} · ${score}` };
  const versus = isMatchMode(mode as GameMode) && Boolean(engineSide);
  const user: Color = versus && engineSide ? (engineSide === "white" ? "black" : "white") : orientation;
  const title = versus ? (winner === user ? "You won" : "You lost") : `${winner === "white" ? "White" : "Black"} wins`;
  return {
    tone: versus && winner !== user ? "loss" : "win",
    title,
    detail: [how ? capitalize(how) : null, score].filter(Boolean).join(" · ")
  };
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Winner of the finale: the result's winner, else (puzzle) the side that just moved. */
function finaleWinner(fen: string, finale: Finale, result: string | undefined): Color | null {
  const outcome = result ?? statusForFen(fen).result;
  if (outcome === "1-0") return "white";
  if (outcome === "0-1") return "black";
  // Puzzles have no result: the solver is the side that made the last move.
  return finale.title === "Puzzle solved" ? (statusForFen(fen).turn === "white" ? "black" : "white") : null;
}

/** The king square(s) the finale glows on: the winner's king, or both kings for a draw. */
function finaleKingSquares(fen: string, winner: Color | null): Key[] {
  const squares: Key[] = [];
  const rows = fen.split(" ")[0]?.split("/") ?? [];
  rows.forEach((row, index) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) {
        file += Number(char);
        continue;
      }
      const isKing = char === "K" || char === "k";
      const color: Color = char === "K" ? "white" : "black";
      if (isKing && (!winner || winner === color)) squares.push(`${"abcdefgh"[file]}${8 - index}` as Key);
      file += 1;
    }
  });
  return squares;
}

function lastMoveOf(node: Pick<MoveNode, "uci"> | undefined): Key[] | undefined {
  return node?.uci ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as Key[]) : undefined;
}

const NO_SHAPES: DrawShape[] = [];
const NO_ARROWS: BoardArrow[] = [];
const NO_HIGHLIGHTS: BoardHighlight[] = [];

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
    const orig = asSquare(shape.orig);
    if (!orig) continue;
    const dest = shape.dest ? asSquare(shape.dest) : null;
    if (dest) arrows.push({ orig, dest, color });
    else if (!shape.dest) highlights.push({ square: orig, color });
  }
  return { arrows, highlights };
}
