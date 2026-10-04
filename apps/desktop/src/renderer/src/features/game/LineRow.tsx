import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Figurine } from "../board/Figurine";
import { bareSan, sanPiece } from "./move-list-model";

/**
 * A move clicked in the move list doesn't take focus: the board and the list's highlight show where
 * the game is, and the ← → that follow (global shortcuts) would otherwise draw a focus ring on the
 * clicked move while another one is current. Tab still focuses moves, with their ring.
 * Whatever had focus still gives it up, as a click would make it: a tab bar clicked just before
 * would otherwise keep the ← → for its own tabs.
 */
export function keepFocusOnPress(event: MouseEvent) {
  event.preventDefault();
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
}

/** A move of a line drawn with the board's piece, as the move list draws moves (`♘d2`, `♙a4`). */
export function FigureSan({ san }: { san: string }) {
  return (
    <>
      <Figurine role={sanPiece(san)} />
      {bareSan(san)}
    </>
  );
}

/** Nested variation rows indent one step per level, up to this many (deeper ones line up). */
export const MAX_LINE_INDENT = 4;
const INDENT_REM = 0.875;

/**
 * A line move's look: semibold, the current one on the selection's colour, a marked one in its
 * mark's colour (`toneClassName`) unless it is current, the previewed one lit.
 */
export function lineMoveClassName({
  current,
  toneClassName,
  previewed = false
}: {
  current: boolean;
  toneClassName?: string;
  previewed?: boolean;
}): string {
  return cn(
    "rounded-[4px] px-1 font-semibold whitespace-nowrap outline-none",
    "transition-colors duration-micro ease-standard focus-visible:ring-2 focus-visible:ring-accent/50",
    toneClassName && !current ? toneClassName : current ? "text-fg" : "text-fg-secondary",
    current ? "bg-accent-soft" : previewed ? "bg-fg/10" : "hover:bg-fg/10"
  );
}

/** One entry of a line: its number (`9.`, `9…` or none) and its move, which never wrap apart. */
export type LineEntry = { key: string; number: string | null; move: ReactNode };

/**
 * One line of moves under the move list's pair it belongs to, from the move column to the end,
 * ruled on the left: a marked error's BEST line (`label` "Best", the rule in the mark's colour) or a
 * variation of the game (no label, a neutral rule, indented by its nesting `depth`). Its moves flow
 * inline with muted numbers and wrap; a line longer than one row starts folded to its first row,
 * fading at the right, with a chevron at the row's end that shows it whole (and folds it back).
 * Moving the current move into the line unfolds it. `actions` show at the row's end on hover or
 * focus, before the chevron.
 */
export function LineRow({
  id,
  ariaLabel,
  gridClassName,
  depth = 0,
  ruleColor,
  label,
  entries,
  currentKey = null,
  actions,
  after,
  onPointerLeave,
  onBlur
}: {
  id?: string;
  ariaLabel: string;
  /** The list's column template, so the row starts at the move column. */
  gridClassName: string;
  depth?: number;
  /** The rule's colour (a mark's); unset, the rule is neutral. */
  ruleColor?: string;
  label?: string;
  entries: readonly LineEntry[];
  /** The current move's entry key when the current move is in this line. */
  currentKey?: string | null;
  actions?: ReactNode;
  /** Drawn after the ruled row, inside the same column (a floating preview). */
  after?: ReactNode;
  onPointerLeave?: () => void;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  // The current move in the line shows it whole (also when it enters it), so it is never clipped
  // out of sight.
  const [expanded, setExpanded] = useState(currentKey !== null);
  const [overflows, setOverflows] = useState(false);
  const [shownCurrent, setShownCurrent] = useState(currentKey);
  if (currentKey !== shownCurrent) {
    setShownCurrent(currentKey);
    if (currentKey !== null) setExpanded(true);
  }

  const entriesKey = entries.map((entry) => entry.key).join(" ");
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // Folded, the line is one unwrapped row: it overflows when it is wider than the row. Unfolded,
    // it wraps: it overflows when it takes more than one row.
    const measure = () => {
      if (!expanded) {
        setOverflows(content.scrollWidth > content.clientWidth + 1);
        return;
      }
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
      setOverflows(Number.isFinite(lineHeight) && content.scrollHeight > lineHeight * 1.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, entriesKey]);

  const folded = !expanded;
  const indent = Math.min(depth, MAX_LINE_INDENT) * INDENT_REM;

  return (
    <div
      id={id}
      className={cn("group/line grid", gridClassName)}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="relative col-[2/-1] min-w-0"
        style={indent ? { marginInlineStart: `${indent}rem` } : undefined}
      >
        <div
          className={cn(
            "mb-1.5 flex min-w-0 items-start gap-1 rounded-r-md border-l-2 bg-fg/[0.03] py-1.5 pr-1.5 pl-2.5 text-[0.8125rem] leading-[1.75]",
            ruleColor === undefined && "border-line-strong"
          )}
          style={ruleColor === undefined ? undefined : { borderLeftColor: ruleColor }}
          onPointerLeave={onPointerLeave}
          onBlur={onBlur}
        >
          <div
            ref={contentRef}
            className={cn("min-w-0 flex-1", folded && "overflow-hidden whitespace-nowrap")}
            style={
              folded && overflows
                ? {
                    maskImage: "linear-gradient(to right, #000 calc(100% - 2rem), transparent)"
                  }
                : undefined
            }
          >
            {label ? (
              <span className="mr-0.5 font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-fg-subtle uppercase">
                {label}
              </span>
            ) : null}
            {entries.map((entry, index) => (
              <Fragment key={entry.key}>
                {/* Unfolded, lines wrap between moves, never between a number and its move. Folded,
                    there is no break at all: Chromium breaks at a <wbr> even under nowrap. */}
                {index && !folded ? <wbr /> : null}
                <span className="whitespace-nowrap">
                  {entry.number ? (
                    <span
                      className={cn(
                        "mr-[3px] font-mono text-xs text-fg-subtle tabular-nums",
                        index === 0 ? (label ? "ml-2.5" : "") : "ml-1.5"
                      )}
                    >
                      {entry.number}
                    </span>
                  ) : null}
                  {entry.move}
                </span>
              </Fragment>
            ))}
          </div>
          {actions ? (
            <div className="flex h-[1.75em] shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-micro ease-standard group-focus-within/line:opacity-100 group-hover/line:opacity-100">
              {actions}
            </div>
          ) : null}
          {overflows ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Fold the line" : "Show the whole line"}
              title={expanded ? "Fold the line" : "Show the whole line"}
              className="flex h-[1.75em] shrink-0 cursor-pointer items-center rounded-sm px-0.5 text-fg-subtle outline-none transition-colors duration-micro ease-standard hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
              onMouseDown={keepFocusOnPress}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          ) : null}
        </div>
        {after}
      </div>
    </div>
  );
}
