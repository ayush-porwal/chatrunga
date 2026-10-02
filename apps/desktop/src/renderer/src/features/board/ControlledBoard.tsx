import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import { isPromotionMove, statusForFen } from "@chaturanga/shared/chess/position";
import type { BoardArrow, BoardHighlight, Color, UserMove } from "@chaturanga/shared/types/chess";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useEventCallback } from "@/lib/use-event-callback";
import { isTyping, OVERLAY_SELECTOR } from "../../app/useBoardShortcuts";
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
import {
  parseTypedMove,
  resolveBoardMove,
  typedMoveTrigger,
  type ResolvedMove
} from "./board-move-input";
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
  /**
   * Lets the user type moves (SAN or square to square): `/` or a move's first character opens a
   * small entry over the board's bottom edge.
   */
  keyboardInput?: boolean;
  /** With `keyboardInput`: a quiet keyboard icon under the board's corner (`icon`, the default) or nothing. */
  keyboardInputAffordance?: "icon" | "none";
  className?: string;
};

type PendingPromotion = { from: Key; to: Key };
/** An open typed-move entry: its starting text, and a key that remounts it on every opening. */
type TypedEntry = { seed: string; key: number };

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
  keyboardInputAffordance = "icon",
  className
}: ControlledBoardProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [typedEntry, setTypedEntry] = useState<TypedEntry | null>(null);
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

  // A new position from the parent drops a promotion or a typed move begun on the old one.
  useEffect(() => {
    setPendingPromotion(null);
    setTypedEntry(null);
  }, [fen]);

  // Typing a move: only while the side to move may move and no promotion is being chosen.
  const canType = keyboardInput && sideToMoveIsMovable(fen, movable) && !pendingPromotion;
  const entryOpen = canType && typedEntry !== null;

  /** Opens the typed-move entry, seeded with the key that opened it. */
  const openEntry = useCallback((seed: string) => {
    setTypedEntry({ seed, key: performance.now() });
  }, []);

  /** Closes the entry; `refocus` hands focus back to the board so `/` works again at once. */
  const closeEntry = useCallback((refocus: boolean) => {
    setTypedEntry(null);
    if (refocus) wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  /** A typed move: played (and the entry closed) or refused with the reason to show. */
  const playTypedMove = useEventCallback((move: ResolvedMove): boolean => {
    if (!commitMove(move)) return false;
    closeEntry(true);
    return true;
  });

  // `/` or a move's first character opens the entry, when focus is on the board or nowhere in
  // particular and no text field, dialog or menu owns the keyboard. Captured before the app's own
  // board shortcuts so the opening key doesn't also do something else.
  const handleTriggerKey = useEventCallback((event: KeyboardEvent) => {
    const active = document.activeElement;
    const inScope =
      !active || active === document.body || Boolean(wrapperRef.current?.contains(active));
    const seed = typedMoveTrigger(event, {
      typing: isTyping(event.target) || isTyping(active),
      blocked: Boolean(document.querySelector(OVERLAY_SELECTOR)),
      inScope
    });
    if (seed === null) return;
    event.preventDefault();
    event.stopPropagation();
    openEntry(seed);
  });
  useEffect(() => {
    if (!canType || entryOpen) return;
    window.addEventListener("keydown", handleTriggerKey, { capture: true });
    return () => window.removeEventListener("keydown", handleTriggerKey, { capture: true });
  }, [canType, entryOpen, handleTriggerKey]);

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
    // Focusable (not tabbable) so a click on the board gives it focus: `/` then opens the entry.
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className={cn("group/board flex min-h-0 min-w-0 flex-col gap-1 outline-none", className)}
      onMouseDownCapture={(event) => {
        if (keyboardInput && elementRef.current?.contains(event.target as Node)) {
          wrapperRef.current?.focus({ preventScroll: true });
        }
      }}
    >
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
        {entryOpen && typedEntry ? (
          <TypedMoveEntry
            key={typedEntry.key}
            fen={fen}
            seed={typedEntry.seed}
            onMove={playTypedMove}
            onClose={closeEntry}
          />
        ) : null}
      </div>
      {keyboardInput && keyboardInputAffordance === "icon" ? (
        // A fixed-height row outside the squares, so the icon never covers a piece and hiding it
        // (while the entry is open) never shifts the layout.
        <div className="flex h-7 items-center justify-end">
          <IconButton
            label="Type a move (/)"
            icon={KEYBOARD_ICON}
            size="icon-xs"
            tooltipSide="left"
            aria-expanded={entryOpen}
            disabled={!canType}
            onClick={() => openEntry("")}
            className={cn(
              "text-fg-subtle opacity-50 hover:opacity-100 focus-visible:opacity-100 group-focus-within/board:opacity-100 group-hover/board:opacity-100",
              entryOpen && "invisible"
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

const KEYBOARD_ICON = <Keyboard />;

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
 * The on-demand move entry floating over the board's bottom edge. A plain input (no dialog role),
 * so the global F / X / arrow shortcuts stand down while it has focus. Enter plays the move; a wrong
 * move keeps the text and says why. Escape, or leaving it empty, closes it.
 */
function TypedMoveEntry({
  fen,
  seed,
  onMove,
  onClose
}: {
  fen: string;
  seed: string;
  onMove: (move: ResolvedMove) => boolean;
  onClose: (refocus: boolean) => void;
}) {
  const [text, setText] = useState(seed);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = parseTypedMove(fen, text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!onMove(result.move)) setError(`${result.move.san} isn't accepted here.`);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose(true);
  };

  return (
    <form
      className="absolute bottom-3 left-1/2 z-10 grid w-56 max-w-[calc(100%-1.5rem)] -translate-x-1/2 gap-1 rounded-md border border-line bg-surface-raised/95 p-1.5 shadow-popover backdrop-blur"
      onSubmit={handleSubmit}
    >
      <input
        type="text"
        value={text}
        autoFocus
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!text.trim()) onClose(false);
        }}
        placeholder="Nf3, e2e4, O-O"
        aria-label="Type a move"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          "h-7 w-full min-w-0 rounded border border-line bg-surface px-2 font-mono text-xs text-fg placeholder:text-fg-subtle",
          focusRing
        )}
      />
      {error ? (
        <span id={errorId} role="alert" className="px-0.5 text-xs text-danger">
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
