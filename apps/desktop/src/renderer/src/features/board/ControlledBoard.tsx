import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import { isPromotionMove, statusForFen } from "@chaturanga/shared/chess/position";
import type { BoardArrow, BoardHighlight, Color, UserMove } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useEventCallback } from "@/lib/use-event-callback";
import { useBoardAppearance, useCgBoardBackground } from "./useBoardAppearance";
import { useBoardPolish } from "./useBoardPolish";
import {
  PIECE_MOVE_MS,
  RAPID_STEP_MS,
  fadeInSquares,
  isOneMoveApart,
  isRapidNavigation,
  usePrefersReducedMotion
} from "./board-motion";
import {
  annotationsFromShapes,
  chessgroundMovableColor,
  movableDests,
  shapesFromAnnotations,
  sideToMoveIsMovable,
  type BoardMovable
} from "./board-shapes";
import { parseTypedMove, resolveBoardMove, type ResolvedMove } from "./board-move-input";
import "./board.css";

export type ControlledBoardProps = {
  fen: string;
  orientation: Color;
  /** Which side(s) may move. `none` (the default) makes the board view only. */
  movable?: BoardMovable;
  lastMove?: readonly [string, string] | null;
  arrows?: readonly BoardArrow[];
  highlights?: readonly BoardHighlight[];
  /** Enables right-click drawing; called with every change. Omit to disable drawing. */
  onShapesChange?: (arrows: BoardArrow[], highlights: BoardHighlight[]) => void;
  /**
   * Called with a legal move (full UCI with any promotion letter, castling as `e1g1`), its SAN and
   * the FEN after it. The move is not applied: the parent updates `fen`. Returning `false` refuses
   * it and the piece goes back to where it came from.
   */
  onMove: (uci: string, san: string, fenAfter: string) => boolean | void;
  /** Refuses some legal moves before `onMove` is called (the piece goes back). */
  allowMove?: (uci: string) => boolean;
  /** Highlights the king in check; defaults to whether the side to move in `fen` is in check. */
  check?: boolean;
  /** Shows a field under the board for typing moves (SAN or square to square). */
  keyboardInput?: boolean;
  /** Which edge of the board the typed-move field sits under (default `start`). */
  keyboardInputAlign?: "start" | "end";
  className?: string;
};

type PendingPromotion = { from: Key; to: Key };

const NO_ARROWS: readonly BoardArrow[] = [];
const NO_HIGHLIGHTS: readonly BoardHighlight[] = [];

const PROMOTION_PIECES = [
  ["queen", "Queen"],
  ["rook", "Rook"],
  ["bishop", "Bishop"],
  ["knight", "Knight"]
] as const;

/**
 * An interactive Chessground board driven entirely by props: it shows `fen`, lets the movable side
 * play legal moves and reports them through `onMove` without applying them. No store access, so it
 * suits any feature that owns its own position (repertoire study and practice). Looks and moves like
 * the main board (same appearance settings, motion and polish).
 */
export function ControlledBoard({
  fen,
  orientation,
  movable = "none",
  lastMove = null,
  arrows = NO_ARROWS,
  highlights = NO_HIGHLIGHTS,
  onShapesChange,
  onMove,
  allowMove,
  check,
  keyboardInput = false,
  keyboardInputAlign = "start",
  className
}: ControlledBoardProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const groundRef = useRef<Api | null>(null);
  const lastPositionRef = useRef({ fen: "", at: 0 });
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const { appearance, squareBackground, squareColors, pieceClassName } = useBoardAppearance();
  const reducedMotion = usePrefersReducedMotion();
  const animationEnabled = appearance.boardAnimation && !reducedMotion;
  const status = useMemo(() => safeStatus(fen), [fen]);
  const dests = useMemo(() => movableDests(fen, movable), [fen, movable]);
  const lastFrom = lastMove?.[0];
  const lastTo = lastMove?.[1];
  const shapes = useMemo(() => shapesFromAnnotations(arrows, highlights), [arrows, highlights]);
  const drawingEnabled = Boolean(onShapesChange);
  const interactive = movable !== "none";

  // Built once per mount; every prop change below goes through `set`.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const ground = Chessground(element, {
      disableContextMenu: true,
      coordinates: false,
      ranksPosition: "left",
      highlight: { lastMove: true, check: true },
      animation: { enabled: false, duration: PIECE_MOVE_MS },
      draggable: { enabled: true, showGhost: true, distance: 3 },
      drawable: { enabled: false, visible: true, defaultSnapToValidMove: true },
      movable: { free: false, rookCastle: true },
      premovable: { enabled: false }
    });
    groundRef.current = ground;
    // Chessground caches the board's screen position; re-read it on every press so a board that
    // moved without resizing (a sidebar collapsing) still takes clicks on the right square.
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

  useEffect(() => {
    const ground = groundRef.current;
    if (!ground || ground.state.coordinates === appearance.showCoordinates) return;
    ground.set({ coordinates: appearance.showCoordinates });
    ground.redrawAll();
  }, [appearance.showCoordinates]);

  useCgBoardBackground(elementRef, squareBackground, squareColors);
  useBoardPolish(elementRef);

  const showsCheck = check ?? status.isCheck;

  /** Puts Chessground back on the props' position (after a refused or abandoned move). */
  const restorePosition = useEventCallback(() => {
    const ground = groundRef.current;
    if (!ground) return;
    ground.cancelMove();
    ground.selectSquare(null);
    ground.set({
      fen,
      orientation,
      turnColor: status.turn,
      check: showsCheck,
      lastMove: lastFrom && lastTo ? [lastFrom as Key, lastTo as Key] : undefined,
      animation: { enabled: animationEnabled, duration: PIECE_MOVE_MS },
      movable: { color: chessgroundMovableColor(movable), dests }
    });
  });

  /** Puts the board back once Chessground has finished its own update for the move it just made. */
  const restoreSoon = useCallback(() => {
    queueMicrotask(restorePosition);
    window.requestAnimationFrame(restorePosition);
  }, [restorePosition]);

  /** Hands a legal move to the parent, or puts the piece back when it is refused. */
  const commitMove = useEventCallback((move: ResolvedMove | null): boolean => {
    if (
      !move ||
      (allowMove && !allowMove(move.uci)) ||
      onMove(move.uci, move.san, move.fenAfter) === false
    ) {
      restoreSoon();
      return false;
    }
    return true;
  });

  const handleBoardMove = useEventCallback((orig: Key, dest: Key) => {
    if (safeIsPromotion(fen, orig, dest)) {
      setPendingPromotion({ from: orig, to: dest });
      return;
    }
    commitMove(resolveBoardMove(fen, orig, dest));
  });

  const choosePromotion = useCallback(
    (promotion: NonNullable<UserMove["promotion"]> | null) => {
      const pending = pendingPromotion;
      setPendingPromotion(null);
      if (!pending) return;
      if (!promotion) {
        restoreSoon();
        return;
      }
      commitMove(resolveBoardMove(fen, pending.from, pending.to, promotion));
    },
    [commitMove, fen, pendingPromotion, restoreSoon]
  );

  // A new position from the parent drops a promotion that was waiting on the old one.
  useEffect(() => {
    setPendingPromotion(null);
  }, [fen]);

  // Position: slide pieces for a single move at a calm pace; snap for jumps and while scrubbing.
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
    const now = performance.now();
    const previous = lastPositionRef.current;
    const changed = previous.fen !== fen;
    const animate =
      animationEnabled &&
      changed &&
      now - previous.at > RAPID_STEP_MS &&
      !isRapidNavigation(now) &&
      isOneMoveApart(previous.fen, fen);
    if (changed) lastPositionRef.current = { fen, at: now };
    // Snapping mid-slide: drop the running slide so pieces land on the new position at once.
    if (!animate) ground.state.animation.current = undefined;
    ground.set({
      fen,
      orientation,
      animation: { enabled: animate, duration: PIECE_MOVE_MS },
      turnColor: status.turn,
      check: showsCheck,
      lastMove: lastFrom && lastTo ? [lastFrom as Key, lastTo as Key] : undefined
    });
    if (changed && !isRapidNavigation(now)) {
      window.requestAnimationFrame(() =>
        fadeInSquares(elementRef.current, "square.last-move, square.check")
      );
    }
  }, [animationEnabled, fen, lastFrom, lastTo, orientation, showsCheck, status.turn]);

  // Interaction: who may move and where.
  useEffect(() => {
    groundRef.current?.set({
      movable: {
        color: chessgroundMovableColor(movable),
        dests,
        showDests: appearance.showLegalMoves,
        free: false,
        rookCastle: true,
        events: { after: (orig, dest) => handleBoardMove(orig, dest) }
      }
    });
  }, [appearance.showLegalMoves, dests, handleBoardMove, movable]);

  // Drawn shapes: controlled by `arrows` / `highlights`; drawing only when the parent listens.
  const handleShapesChange = useEventCallback(
    (next: Parameters<typeof annotationsFromShapes>[0]) => {
      const annotations = annotationsFromShapes(next);
      onShapesChange?.(annotations.arrows, annotations.highlights);
    }
  );
  useEffect(() => {
    groundRef.current?.set({
      drawable: {
        enabled: drawingEnabled,
        visible: true,
        defaultSnapToValidMove: true,
        shapes,
        onChange: handleShapesChange
      }
    });
  }, [drawingEnabled, handleShapesChange, shapes]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col gap-2", className)}>
      <div className="relative aspect-square w-full min-w-0">
        {/* Chessground's classes stay in className so React reconciliation never strips them. */}
        <div
          ref={elementRef}
          className={cn(
            "cg-wrap board-surface h-full w-full overflow-hidden rounded-lg",
            interactive && "manipulable",
            pieceClassName,
            orientation === "white" ? "orientation-white" : "orientation-black"
          )}
        />
        {pendingPromotion ? <PromotionPicker onChoose={choosePromotion} /> : null}
      </div>
      {keyboardInput ? (
        <TypedMoveField
          fen={fen}
          disabled={!sideToMoveIsMovable(fen, movable) || Boolean(pendingPromotion)}
          align={keyboardInputAlign}
          onMove={commitMove}
        />
      ) : null}
    </div>
  );
}

/**
 * Promotion choice shown over the board. It is a dialog, so the global board shortcuts stand down
 * while it is open; Escape or a click on the dimmed board cancels and the pawn goes back.
 */
function PromotionPicker({
  onChoose
}: {
  onChoose: (promotion: NonNullable<UserMove["promotion"]> | null) => void;
}) {
  const titleId = useId();
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onChoose(null);
  };
  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center rounded-lg bg-black/45 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onChoose(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="grid gap-2 rounded-xl border border-line bg-surface-raised p-3 shadow-popover"
        onKeyDown={handleKeyDown}
      >
        <span id={titleId} className="text-sm font-medium text-fg">
          Promote pawn
        </span>
        <div className="grid grid-cols-2 gap-2">
          {PROMOTION_PIECES.map(([value, pieceLabel]) => (
            <Button
              type="button"
              key={value}
              variant={value === "queen" ? "primary" : "outline"}
              autoFocus={value === "queen"}
              onClick={() => onChoose(value)}
            >
              {pieceLabel}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A text field for typing moves. A plain input, so the global F / X / arrow shortcuts already stand
 * down while it has focus (they skip text entry). A wrong move keeps the text and shows why.
 */
function TypedMoveField({
  fen,
  disabled,
  align,
  onMove
}: {
  fen: string;
  disabled: boolean;
  align: "start" | "end";
  onMove: (move: ResolvedMove | null) => boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // A new position makes an old error meaningless.
  useEffect(() => {
    setError(null);
  }, [fen]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    const result = parseTypedMove(fen, text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!onMove(result.move)) {
      setError(`${result.move.san} isn't accepted here.`);
      return;
    }
    setText("");
    setError(null);
  };

  // One compact row: the error sits beside the field (truncated, full text on hover), so showing
  // or clearing it never moves the layout.
  return (
    <form
      className={cn("flex h-7 min-w-0 items-center gap-2", align === "end" && "flex-row-reverse")}
      onSubmit={handleSubmit}
    >
      <input
        type="text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError(null);
        }}
        disabled={disabled}
        placeholder="Move…"
        title="Type a move: Nf3, exd5, O-O, e8=Q or e2e4. Enter plays it."
        aria-label="Type a move"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          "h-7 w-44 shrink-0 rounded-md border border-line bg-surface px-2 font-mono text-xs text-fg placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50",
          focusRing
        )}
      />
      {error ? (
        <span
          id={errorId}
          role="alert"
          title={error}
          className="min-w-0 truncate text-xs text-danger"
        >
          {error}
        </span>
      ) : null}
    </form>
  );
}

/** The position's status, or a neutral one (white to move, no check) for an unreadable FEN. */
function safeStatus(fen: string): { turn: Color; isCheck: boolean } {
  try {
    const status = statusForFen(fen);
    return { turn: status.turn, isCheck: status.isCheck };
  } catch {
    return { turn: "white", isCheck: false };
  }
}

/** Whether a move is a pawn promotion, false for an unreadable FEN. */
function safeIsPromotion(fen: string, from: string, to: string): boolean {
  try {
    return isPromotionMove(fen, from, to);
  } catch {
    return false;
  }
}
