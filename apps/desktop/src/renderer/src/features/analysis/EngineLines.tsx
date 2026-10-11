/**
 * An engine's principal variations, as Lichess shows them (EngineStatusPanel.tsx places them): the
 * score as a pill and the line in SAN with figurines, one row each, unfolding to the whole line,
 * and the position after a hovered move.
 */
import { Fragment, memo, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { formatScore } from "../game-review/review-score";
import { MoveLink, type GoToLine } from "../game-review/MoveLinks";
import { ReviewBoard } from "../game-review/ReviewBoard";
import { numberedLine, uciLineSteps } from "../game-review/review-utils";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineInfo, EngineScore } from "@chaturanga/shared/types/engine";
import { scoreFromWhitePerspective } from "@chaturanga/shared/chess/review";
import { cgWrapPieceSetClass, pieceSizesClass } from "@chaturanga/shared/types/settings";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import type { PreviewPieceRole } from "../settings/piece-style-preview";
import { Figurine } from "../board/Figurine";
import { useBoardAppearance } from "../board/useBoardAppearance";
import { ENGINE_LINE_PREVIEW } from "../game/move-list-model";
import { usePreviewBoardSize } from "../game/usePreviewBoardSize";

/** The position the lines belong to, and what picking one of their moves does. */
export type LinesPosition = {
  fen: string;
  /** The node the lines start from (a picked move is a line from here). */
  nodeId: string;
  /** The way the line preview's board faces. */
  orientation: Color;
  /** A move of a line was picked: the line up to it, from `nodeId`. Unset, the moves only show. */
  onGoToLine?: GoToLine;
  /** What picking a move does, for assistive tech (default: going to its position). */
  goToLineLabel?: (san: string) => string;
};

/**
 * As many rows as lines asked for, from the first line on (arriving lines never push content down).
 */
function linesWithPlaceholders(
  lines: readonly EngineInfo[],
  reserved: number
): Array<EngineInfo | null> {
  const shown: Array<EngineInfo | null> = lines.slice(0, Math.max(reserved, 1));
  while (shown.length < reserved) shown.push(null);
  return shown;
}

/** The most moves of a line shown (and searched for previews) when it's unfolded. */
const MAX_LINE_MOVES = 60;

/** `12.` before White's moves, `12…` before Black's first one, nothing before Black's others. */
function moveNumberBefore(fen: string, index: number): string | null {
  const [, turn = "w", , , , fullmove = "1"] = fen.split(" ");
  const whiteFirst = turn === "w";
  const whiteMoves = whiteFirst ? index % 2 === 0 : index % 2 === 1;
  const number = (Number(fullmove) || 1) + Math.floor((index + (whiteFirst ? 0 : 1)) / 2);
  if (whiteMoves) return `${number}.`;
  return index === 0 ? `${number}…` : null;
}

/** SAN piece letters → the board's piece (figurine notation, as Lichess shows lines). */
const FIGURINE_ROLES: Partial<Record<string, PreviewPieceRole>> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight"
};

/** A SAN move with its piece drawn as the board's piece (`♘f3`, `exd5`, `O-O`, `e8=♕`). */
export function FigurineSan({ san }: { san: string }) {
  const role = FIGURINE_ROLES[san.charAt(0)];
  const body = role ? san.slice(1) : san;
  const promotion = /=([QRBN])/.exec(body);
  const promoted = promotion ? FIGURINE_ROLES[promotion[1]] : undefined;
  if (!promotion || !promoted) {
    return (
      <>
        {role ? <Figurine role={role} /> : null}
        {body}
      </>
    );
  }
  return (
    <>
      {role ? <Figurine role={role} /> : null}
      {body.slice(0, promotion.index + 1)}
      <Figurine role={promoted} />
      {body.slice(promotion.index + 2)}
    </>
  );
}

/**
 * An engine score (from the side to move, as UCI reports it) from White's side, as the bar and
 * Lichess show it.
 */
export function whiteScore(score: EngineScore, fen: string): EngineScore {
  return scoreFromWhitePerspective(score, fen.split(" ")[1] === "b" ? "black" : "white");
}

/**
 * The line's score (White's side) as a pill: light while White is better, dark while Black is (like
 * the bar). `className` sizes it elsewhere (the review's evaluation change).
 */
export function ScorePill({ score, className }: { score: EngineScore | null; className?: string }) {
  const blackBetter = Boolean(score && score.value < 0);
  const label = score ? formatScore(score, 2) : null;
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-14 items-center justify-center rounded-md px-2 font-mono text-[0.78125rem] font-semibold tabular-nums",
        label === null
          ? "bg-control text-fg-subtle"
          : blackBetter
            ? "bg-side-black text-fg inset-ring inset-ring-line-strong"
            : "bg-piece-white text-side-white-fg",
        className
      )}
    >
      {label ?? "–"}
    </span>
  );
}

/**
 * One principal variation, as Lichess shows them: the score as a pill, then the line in SAN with
 * move numbers and figurines — on one row (truncated, no reflow as it updates), or unfolded (the
 * chevron) to the whole line. Each move jumps the board there when `onGoToLine` is set, and
 * hovering one shows its position below the lines. A line that doesn't fit the position yet
 * shows as a dash. In the Moves tab's engine block (not `compact`) the row lights up under the
 * pointer and the line's first move stands out.
 */
const EngineLineRow = memo(function EngineLineRow({
  index,
  line,
  fen,
  nodeId,
  expanded,
  compact,
  onToggle,
  onGoToLine,
  goToLineLabel,
  onPreview
}: {
  index: number;
  line: EngineInfo | null;
  fen: string;
  nodeId: string;
  expanded: boolean;
  /** Study's tighter row (see EngineAnalysisPanel). */
  compact: boolean;
  onToggle: (multipv: number) => void;
  onGoToLine?: GoToLine;
  goToLineLabel?: (san: string) => string;
  /** A move of this line is hovered or focused (its position shows below the lines). */
  onPreview?: (target: PreviewTarget) => void;
}) {
  const steps = useMemo(
    () => (line?.pv?.length ? uciLineSteps(fen, line.pv.slice(0, MAX_LINE_MOVES)) : []),
    [fen, line]
  );
  const sans = useMemo(() => steps.map((step) => step.san), [steps]);
  const score = line?.score ? whiteScore(line.score, fen) : null;
  const multipv = line?.multipv ?? index + 1;
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_1.75rem] gap-x-2.5 text-[0.8125rem] leading-6",
        compact
          ? "py-1"
          : "group/line rounded-lg py-1 pr-1 pl-1.5 transition-colors duration-micro hover:bg-control",
        expanded ? "items-start" : compact ? "min-h-8 items-center" : "min-h-8.5 items-center"
      )}
    >
      <ScorePill score={score} />
      <span
        className={cn(
          "min-w-0 text-fg-secondary",
          expanded ? "whitespace-normal break-words" : "truncate"
        )}
      >
        {steps.length
          ? steps.map((step, moveIndex) => {
              const number = moveNumberBefore(fen, moveIndex);
              return (
                <Fragment key={`${moveIndex}-${step.san}`}>
                  {moveIndex ? " " : null}
                  {/* A move number never wraps away from its move. */}
                  <span
                    className={cn(
                      number && "whitespace-nowrap",
                      !compact && moveIndex === 0 && "font-semibold text-fg"
                    )}
                    onPointerEnter={() => onPreview?.({ multipv, moveIndex })}
                    onFocus={() => onPreview?.({ multipv, moveIndex })}
                  >
                    {number ? <span className="text-fg-subtle tabular-nums">{number} </span> : null}
                    {onGoToLine ? (
                      <MoveLink
                        san={step.san}
                        nativeTitle={false}
                        label={goToLineLabel?.(step.san)}
                        className="text-current hover:text-accent"
                        onActivate={() =>
                          onGoToLine({ startNodeId: nodeId, moves: sans.slice(0, moveIndex + 1) })
                        }
                      >
                        <FigurineSan san={step.san} />
                      </MoveLink>
                    ) : (
                      // The figurine is decorative: the move is read out as its SAN (Nf6, not f6).
                      <span
                        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a move that isn't a link is still reachable by keyboard, read out as its SAN
                        tabIndex={0}
                        aria-label={step.san}
                        className="rounded-[3px] outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        <FigurineSan san={step.san} />
                      </span>
                    )}
                  </span>
                </Fragment>
              );
            })
          : "–"}
      </span>
      {steps.length > 1 ? (
        <IconButton
          label={expanded ? "Fold the line" : "Show the whole line"}
          icon={
            <ChevronDown
              className={cn("transition-transform duration-micro", expanded && "rotate-180")}
            />
          }
          size="icon-xs"
          aria-expanded={expanded}
          onClick={() => onToggle(multipv)}
          className={cn(
            expanded && "mt-0.5 self-start",
            // Dimmed until the row is hovered (it always keeps its place).
            !compact && "opacity-60 group-hover/line:opacity-100 focus-visible:opacity-100"
          )}
        />
      ) : (
        <span />
      )}
    </li>
  );
});

/**
 * The move of an engine line being hovered or focused: the position after it, shown below the
 * lines.
 */
type LinePreview = { fenAfter: string; uci: string; label: string };
/**
 * Which move is hovered: line (MultiPV number) and move index, so an updated line updates the
 * preview.
 */
type PreviewTarget = { multipv: number; moveIndex: number };

/** The preview for `target` from the lines as they are now; null once that move is gone. */
function previewFor(
  fen: string,
  lines: readonly EngineInfo[],
  target: PreviewTarget
): LinePreview | null {
  const line = lines.find((candidate) => (candidate.multipv ?? 1) === target.multipv);
  if (!line?.pv?.length) return null;
  const steps = uciLineSteps(fen, line.pv.slice(0, MAX_LINE_MOVES));
  const step = steps.at(target.moveIndex);
  if (!step) return null;
  return {
    fenAfter: step.fenAfter,
    uci: step.uci,
    label: numberedLine(
      fen,
      steps.slice(0, target.moveIndex + 1).map((item) => item.san)
    )
  };
}

/**
 * A roomy board under the lines with the position after the move being hovered (or focused): just
 * the board, since the line is read above it (its move highlighted there). Below the lines, it
 * never covers the moves being read. Compact, see FloatingLinePreview.
 */
function LinePreviewCard({
  preview,
  orientation,
  compact
}: {
  preview: LinePreview;
  orientation: Color;
  compact: boolean;
}) {
  // Under the lines it keeps an engine line preview's bounds (about three quarters of a BEST
  // line's), so a wide panel never shows a board that crowds the lines and the moves out; the
  // floating (compact) one has its own width.
  const slotRef = useRef<HTMLDivElement>(null);
  const size = usePreviewBoardSize(slotRef, ENGINE_LINE_PREVIEW);
  return (
    // Named only for assistive tech: the line is read above it.
    <div
      ref={slotRef}
      role="group"
      aria-label={`Position after ${preview.label}`}
      className={cn("grid animate-fade-in", compact && "rounded-md shadow-popover")}
    >
      <div
        className={cn("w-full justify-self-center", compact && "max-w-48")}
        style={
          compact
            ? undefined
            : {
                maxWidth: size ?? ENGINE_LINE_PREVIEW.min,
                visibility: size === null ? "hidden" : undefined
              }
        }
      >
        <ReviewBoard
          fen={preview.fenAfter}
          orientation={orientation}
          lastMove={[preview.uci.slice(0, 2), preview.uci.slice(2, 4)]}
          className="aspect-square w-full"
        />
      </div>
    </div>
  );
}

/** The floating preview's width (its 192px board) and its gap from the panel. */
const FLOATING_PREVIEW_WIDTH = 192;
const FLOATING_PREVIEW_GAP = 20;

/**
 * The compact panel's preview (Study): beside the side panel, over the board's edge, level with
 * the lines, like a tooltip of the hovered move. Never in the panel, where it would grow it or
 * cover the moves and the edit buttons under it. In a portal: the panel clips its content and is
 * a containing block for fixed boxes.
 */
function FloatingLinePreview({
  anchor,
  preview,
  orientation
}: {
  /** The lines' list, which it is placed beside. */
  anchor: HTMLElement;
  preview: LinePreview;
  orientation: Color;
}) {
  const box = anchor.getBoundingClientRect();
  const panelLeft = anchor.closest("aside")?.getBoundingClientRect().left ?? box.left;
  return createPortal(
    <div
      className="fixed z-50"
      style={{
        top: Math.max(8, Math.min(box.top, window.innerHeight - FLOATING_PREVIEW_WIDTH - 8)),
        left: Math.max(8, panelLeft - FLOATING_PREVIEW_GAP - FLOATING_PREVIEW_WIDTH),
        width: FLOATING_PREVIEW_WIDTH
      }}
    >
      <LinePreviewCard preview={preview} orientation={orientation} compact />
    </div>,
    document.body
  );
}

/**
 * The lines' hover and fold state: the hovered line move, for the position it was hovered in (a
 * new position drops it; the card reads that line as it is now, so a line the engine updates under
 * the pointer updates too), and the unfolded lines (by MultiPV number). Held by the panel, so the
 * lines coming and going with the search keep them.
 */
export function useLineInteractions(fen: string) {
  const [hovered, setHovered] = useState<{ fen: string; target: PreviewTarget } | null>(null);
  const setPreview = useCallback((target: PreviewTarget) => setHovered({ fen, target }), [fen]);
  const clearPreview = useCallback(() => setHovered(null), []);
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<number>>(() => new Set());
  const toggleLine = useCallback(
    (multipv: number) =>
      setExpandedLines((current) => {
        const next = new Set(current);
        if (!next.delete(multipv)) next.add(multipv);
        return next;
      }),
    []
  );
  return { hovered, setPreview, clearPreview, expandedLines, toggleLine };
}

/**
 * The engine's lines, as many rows as asked for (arriving lines never push content down), and the
 * hovered move's preview: under the lines, or (compact) floating beside the panel.
 */
export function EngineLines({
  position,
  lines,
  reserved,
  compact,
  interactions
}: {
  position: LinesPosition;
  lines: readonly EngineInfo[];
  reserved: number;
  compact: boolean;
  interactions: ReturnType<typeof useLineInteractions>;
}) {
  const { fen, nodeId, orientation, onGoToLine, goToLineLabel } = position;
  const { hovered, setPreview, clearPreview, expandedLines, toggleLine } = interactions;
  /** The lines' list, which a compact panel's floating preview is placed beside. */
  const [linesList, setLinesList] = useState<HTMLOListElement | null>(null);
  const pieceSet = usePieceSetClass();
  const preview = useMemo(
    () => (hovered && hovered.fen === fen ? previewFor(fen, lines, hovered.target) : null),
    [hovered, fen, lines]
  );
  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- leaving the list (pointer or focus) ends the move preview */}
      <ol
        ref={setLinesList}
        // The board's piece set, so the lines' figurines are the board's pieces.
        className={cn(pieceSet, compact && "divide-y divide-line-subtle")}
        style={FIGURINE_BLOCK_STYLE}
        onPointerLeave={clearPreview}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) clearPreview();
        }}
      >
        {linesWithPlaceholders(lines, reserved).map((line, index) => (
          <EngineLineRow
            key={line?.multipv ?? `empty-${index}`}
            index={index}
            line={line}
            fen={fen}
            nodeId={nodeId}
            expanded={expandedLines.has(line?.multipv ?? index + 1)}
            compact={compact}
            onToggle={toggleLine}
            onGoToLine={onGoToLine}
            goToLineLabel={goToLineLabel}
            onPreview={setPreview}
          />
        ))}
      </ol>
      {preview && compact && linesList ? (
        <FloatingLinePreview anchor={linesList} preview={preview} orientation={orientation} />
      ) : preview && !compact ? (
        <LinePreviewCard preview={preview} orientation={orientation} compact={false} />
      ) : null}
    </>
  );
}

/** The board's piece set around figurines (`.cg-wrap` and its piece-set classes). */
export function usePieceSetClass(): string {
  const { appearance } = useBoardAppearance();
  return cn(
    "cg-wrap",
    cgWrapPieceSetClass(appearance.pieceStyle),
    pieceSizesClass(appearance.pieceSizes)
  );
}
/** Unlayered `.cg-wrap` rules (board.css inline-size containment) would size a figurine block. */
const FIGURINE_BLOCK_STYLE = { display: "block", containerType: "normal" } as const;
