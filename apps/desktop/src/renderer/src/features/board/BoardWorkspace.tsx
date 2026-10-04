import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { useSettingsQuery } from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { card, motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useBoardFocused } from "./board-focus";
import { BoardResizeContext, BoardResizeGrip } from "./BoardResizeGrip";
import { BoardSplitter } from "./BoardSplitter";
import { resizeShift } from "./board-frame";
import { useBoardEdgeStore } from "./useBoardEdge";
import { useFocusCentring, useSnappedBoardFrame } from "./useBoardFrame";

/*
 * The board workspace: ONE layout for every board screen (free board, Analysis, Game review,
 * Engine game, Puzzle). The board column and the panel have fixed geometry; modes only change
 * what goes into the slots, so the board never moves or resizes when switching modes.
 *
 *   ┌ board cell (container) ──────────────┬ panel (card, fixed width) ─┐
 *   │   <BoardStage top board bottom>      │ tabs                       │
 *   │                                      │ summary strip (fixed h)    │
 *   │                                      │ notices + body (scrolls)   │
 *   │                                      │ footer (graph + move nav)  │
 *   └──────────────────────────────────────┴────────────────────────────┘
 *
 * The titlebar above it (App's drag region) uses <WorkspaceTitlebar> for the same anatomy in
 * every mode: game title · result … mode actions. Board commands (Focus board, Flip board) live in
 * the sidebar, shown only on board views.
 *
 * Focus mode (board-focus.ts): the panel column eases to 0 and the panel slides out with it —
 * it keeps its own width while the column clips it, so its text never re-wraps mid-animation.
 * The board cell grows into the space frame by frame (the board is sized from the cell). The board
 * square is centred on the window itself, with the sidebar rail and titlebar still showing: the
 * workspace pads itself to a window-centred box (the rail's width across, a measured inset down —
 * useFocusCentring) and evens out the eval column.
 *
 * Sizing (the `--workspace-*` variables in app.css, fluid from the 980px minimum to ultra-wide):
 * the panel grows with the window (320px → 34rem); padding and gap scale together; the board is
 * as large as the height allows (`--workspace-board`), and its block (player rows + board) is
 * centred down its cell. The grid is capped at exactly board + gap +
 * panel and centred, so on a wide window the spare width goes to both outer margins and the board
 * stays next to its panel. On a narrow window the cap is not reached and the board takes the
 * width left beside the panel.
 *
 * Resizing (while the panel shows): the board fills its space by default. Two affordances set a
 * smaller (or larger) edge, shared by every board workspace and remembered (useBoardEdge): the grip
 * in the board's bottom-right corner (BoardResizeGrip), dragged as a square, and the splitter in
 * the gap between the board and the panel (BoardSplitter), dragged across or stepped with the
 * keys. The panel then takes all the width beside it, down to its minimum (`.board-resized` in
 * app.css): the board column is exactly the board's width at the content's left edge and the
 * panel reaches the right edge, so no width is left over; blocks that read badly wide keep their
 * own measure, centred in the panel. A double-click on either (or Enter on the splitter) fills the
 * space again. Focus mode always fills, with neither shown.
 */

export function BoardWorkspace({
  board,
  header,
  bodyCollapsed = false,
  bodyId,
  tabs,
  summary,
  notices,
  footer,
  children,
  panelLabel,
  showPanel,
  tabPanel
}: {
  /** The board column content — always a <BoardStage>. */
  board: ReactNode;
  /**
   * A heading row above the tabs (Game review's "⌄ Review" with its controls), whose toggle folds
   * the tabs and everything under them away: `bodyCollapsed`, with `bodyId` the folded block's id
   * (the toggle's aria-controls). The footer then takes the panel's height.
   */
  header?: ReactNode;
  bodyCollapsed?: boolean;
  bodyId?: string;
  /** Panel tabs (one SegmentedControl role="tablist"). */
  tabs?: ReactNode;
  /**
   * One-line summary strip under the tabs (fixed height, rendered even when empty: pass null for
   * an empty strip); omitted, the panel has no strip.
   */
  summary?: ReactNode;
  /** Errors/warnings shown at the top of the panel body (never above the board). */
  notices?: ReactNode;
  /** Panel footer: optional eval graph + move navigation. */
  footer?: ReactNode;
  /** Panel body for the active tab. Children should fill it (`h-full`) and scroll themselves. */
  children?: ReactNode;
  panelLabel?: string;
  /** Overrides focus mode (hidden while the app is in focus mode); the board keeps the same sizing rule. */
  showPanel?: boolean;
  /** Tab panel props for the body (`tabPanelProps`), linking it to the tabs that switch it. */
  tabPanel?: { id: string; role: "tabpanel"; "aria-labelledby": string };
}) {
  const focused = useBoardFocused();
  const panelVisible = showPanel ?? !focused;
  const easing = useToggleEasing(panelVisible);
  const { shown: evalBarShown, right: evalBarRight } = useEvalBarPlacement();
  // Focus mode centres the board square on the window (not on the content panel).
  const centred = focused && !panelVisible;
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusCentring(rootRef, centred);
  // The edge the board was resized to (null: it fills); only beside the panel.
  const storedEdge = useBoardEdgeStore((state) => state.edge);
  const resizedEdge = panelVisible ? storedEdge : null;
  const maxRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // How far left the board moves as a drag switches it to the resized layout (resizeShift): the
  // grip and the splitter make it up, so they stay under the pointer.
  const measureShift = useCallback(() => {
    const grid = gridRef.current?.getBoundingClientRect();
    const root = rootRef.current?.getBoundingClientRect();
    return grid && root ? resizeShift(grid.left, root.left) : 0;
  }, []);
  const resizable = useMemo(
    () => (panelVisible ? { maxRef, shift: measureShift } : null),
    [measureShift, panelVisible]
  );
  const rootStyle = useMemo<CSSProperties | undefined>(() => {
    if (evalBarShown && resizedEdge === null) return undefined;
    return {
      ...(evalBarShown ? null : NO_EVAL_COLUMN),
      ...(resizedEdge === null ? null : { "--workspace-board-user": `${resizedEdge}px` })
    };
  }, [evalBarShown, resizedEdge]);
  return (
    // Size container: the grid's width cap is computed from this box's height (cqh). With the eval
    // bar off, its column is gone from that cap too (and from the stage below).
    <div
      ref={rootRef}
      className={cn(
        "board-workspace h-full min-h-0 min-w-0 [container-type:size]",
        resizedEdge !== null && "board-resized",
        easing && "transition-[padding] duration-emphasis ease-standard",
        // Centred across: the content panel starts after the sidebar rail but ends only 0.5rem (its
        // mr-2) short of the window's edge, so the difference pads the right; the eval column's width
        // pads the side away from the bar, so the square itself (not square + bar) is centred. From
        // the rail's own variable, not a measurement: it is already the rail's width while the sidebar
        // eases shut, so this eases once to its final value with everything else.
        centred &&
          (evalBarRight
            ? "pr-[calc(var(--sidebar-width)-0.5rem)] pl-(--workspace-eval)"
            : "pr-[calc(var(--sidebar-width)-0.5rem+var(--workspace-eval))]")
      )}
      style={rootStyle}
    >
      {/* Measures the largest edge a resize can reach (the grip's limit). */}
      <div
        ref={maxRef}
        className="invisible pointer-events-none absolute h-0 w-(--workspace-board-max)"
        aria-hidden="true"
      />
      {/* Measures the board's current edge (the splitter's start and value): filled, or resized. */}
      <div
        ref={edgeRef}
        className={cn(
          "invisible pointer-events-none absolute h-0",
          resizedEdge === null ? "w-(--workspace-board-fill)" : "w-(--workspace-board)"
        )}
        aria-hidden="true"
      />
      <div
        ref={gridRef}
        className={cn(
          "mx-auto grid h-full min-h-0 w-full min-w-0 p-(--workspace-pad)",
          // Same track count in both states, so the column, the gap and the cap ease together — like the
          // sidebar. Only while the panel is toggling: these sizes follow the window, and a transition
          // left on would make the board trail a live window resize.
          easing &&
            "transition-[grid-template-columns,column-gap,max-width,padding] duration-emphasis ease-standard",
          // Centred down (useFocusCentring): here rather than on the size container above, whose
          // height the width cap is computed from — changing it mid-ease would restart that transition.
          centred &&
            "pt-[calc(var(--workspace-pad)+var(--centre-inset-top,0px))] pb-[calc(var(--workspace-pad)+var(--centre-inset-bottom,0px))]",
          panelVisible
            ? "max-w-[calc(var(--workspace-board)+var(--workspace-eval)+3*var(--workspace-pad)+var(--workspace-panel))] grid-cols-[minmax(0,1fr)_var(--workspace-panel)] gap-(--workspace-pad)"
            : "max-w-[calc(var(--workspace-board)+var(--workspace-eval)+2*var(--workspace-pad))] grid-cols-[minmax(0,1fr)_0px] gap-0"
        )}
      >
        {/* The board block (player rows + board) is centred down its cell, so a board shorter than
            the space splits the spare height above and below. A resized board's cell is exactly its
            width (app.css), anchored at the content's left edge. Over the splitter beside it, so the
            move mark's badge on an edge square overhangs whole (the badge lets the pointer through to
            the splitter). */}
        <section
          className={cn(
            "relative z-[1] col-start-1 row-start-1 grid min-h-0 min-w-0 items-center [container-type:size]",
            resizedEdge === null ? "justify-items-center" : "justify-items-start"
          )}
          aria-label="Board"
        >
          <BoardResizeContext.Provider value={resizable}>{board}</BoardResizeContext.Provider>
        </section>
        {/* The splitter, centred in the gap before the panel's cell (its hit area stays inside the
            gap, which is never narrower than 0.75rem). Not while the panel eases in or out. */}
        {panelVisible && !easing ? (
          <BoardSplitter
            edgeRef={edgeRef}
            maxRef={maxRef}
            shift={measureShift}
            className="col-start-2 row-start-1 ml-[calc(-0.5*var(--workspace-pad)_-_0.3125rem)] justify-self-start"
          />
        ) : null}
        {/* The cell clips; the panel keeps its full width and slides out with the column's left edge. */}
        <div
          className="col-start-2 row-start-1 flex min-h-0 min-w-0 overflow-hidden"
          inert={!panelVisible}
          aria-hidden={!panelVisible || undefined}
        >
          <aside
            className={cn(
              card,
              "@container/panel flex min-h-0 w-(--workspace-panel) shrink-0 flex-col overflow-hidden",
              panelVisible
                ? "opacity-100 transition-opacity duration-emphasis ease-enter"
                : "opacity-0 transition-opacity duration-standard ease-exit"
            )}
            aria-label={panelLabel}
          >
            {/* The tabs and the summary strip span the panel at any width (as its controls do);
                only reading text keeps `--workspace-panel-measure` (the notices, by
                `.workspace-panel-body` in app.css). */}
            {header ? <div className="shrink-0 px-3">{header}</div> : null}
            <div
              id={bodyId}
              hidden={bodyCollapsed}
              className={cn("flex min-h-0 flex-col", bodyCollapsed ? "hidden" : "flex-1")}
            >
              {tabs ? (
                <div className={cn("shrink-0 px-3", header ? "pt-1" : "pt-3")}>{tabs}</div>
              ) : null}
              {summary === undefined ? null : (
                <div className="flex h-14 shrink-0 items-center border-b border-line-subtle px-3">
                  <div className="flex h-full w-full min-w-0 items-center">{summary}</div>
                </div>
              )}
              <div className="workspace-panel-body flex min-h-0 flex-1 flex-col gap-3 p-3">
                {notices}
                <div className="min-h-0 flex-1" {...tabPanel}>
                  {children}
                </div>
              </div>
            </div>
            {footer ? (
              <div
                className={cn(
                  "border-t border-line-subtle",
                  // With the body folded the footer takes the panel; its last row (the move
                  // navigation) stays pinned to the panel's bottom, whatever else is folded.
                  bodyCollapsed
                    ? "flex min-h-0 flex-1 flex-col [&>:last-child]:mt-auto"
                    : "shrink-0"
                )}
              >
                {footer}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * True for one emphasis duration after `visible` changes: the window in which the workspace
 * geometry eases (focus mode in/out). Outside it, size changes (window resize) apply at once.
 */
function useToggleEasing(visible: boolean): boolean {
  const [last, setLast] = useState(visible);
  const [easing, setEasing] = useState(false);
  if (last !== visible) {
    setLast(visible);
    setEasing(true);
  }
  useEffect(() => {
    if (!easing) return;
    const timer = window.setTimeout(() => setEasing(false), motion.ms.emphasis + 60);
    return () => window.clearTimeout(timer);
  }, [easing, visible]);
  return easing;
}

/**
 * Board + the two player rows as one unit, with the eval bar's column on the side the user chose
 * (none while the bar is off). The square is
 * computed once from the board cell (a size container): as large as fits after the two 2rem rows
 * and gaps (the same 5rem that `--workspace-board` subtracts) and the eval column, with a 100rem
 * ceiling, then rounded down to whole-pixel squares (useSnappedBoardFrame) so Chessground's board
 * fills the frame exactly. The column is always reserved, so the board never moves when the bar
 * comes and goes.
 */
/** The eval column's width, zeroed while the bar is off. */
const NO_EVAL_COLUMN: CSSProperties = { "--workspace-eval": "0px" };

/** Whether the evaluation bar is shown, and on which side of the board. */
function useEvalBarPlacement(): { shown: boolean; right: boolean } {
  const settings = useSettingsQuery();
  return {
    shown: settings.data?.analysisEvalBar ?? defaultSettings.analysisEvalBar,
    right: (settings.data?.analysisEvalBarSide ?? defaultSettings.analysisEvalBarSide) === "right"
  };
}

export function BoardStage({
  top,
  bottom,
  evalBar,
  children
}: {
  top: ReactNode;
  bottom: ReactNode;
  /** The eval bar (renders nothing while there is no evaluation). */
  evalBar?: ReactNode;
  children: ReactNode;
}) {
  // The bar's column is on the side the user chose, or gone (and the board wider) with the bar off.
  const { shown, right } = useEvalBarPlacement();
  const probeRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  useSnappedBoardFrame(probeRef, frameRef);
  const boardColumn = right ? "col-start-1" : "col-start-2";
  return (
    // `--board-avail`: the frame's largest edge in the cell (beside the eval column, under the rows).
    // The board column is as wide as the frame, which is that edge snapped to whole-pixel squares, so
    // the player rows and the eval bar line up with the board's own edges.
    <div
      className={cn(
        "relative grid min-w-0 gap-y-2 [--board-avail:min(100cqw_-_var(--workspace-eval),100cqh_-_5rem,100rem)]",
        right ? "grid-cols-[auto_var(--workspace-eval)]" : "grid-cols-[var(--workspace-eval)_auto]"
      )}
      style={shown ? undefined : NO_EVAL_COLUMN}
    >
      <div ref={probeRef} className="invisible absolute h-0 w-(--board-avail)" aria-hidden="true" />
      {/* The rows take the board's width and never widen it (no intrinsic width of their own). */}
      <div className={cn("min-w-0 contain-inline-size", boardColumn)}>{top}</div>
      {shown ? (
        <div className={cn("row-start-2", right ? "col-start-2 pl-1.5" : "col-start-1 pr-1.5")}>
          {evalBar}
        </div>
      ) : null}
      {/* The one board frame: hairline border + radius, no shadow, no card around it. Its content box
          is the board (the fallback edge is only for the first layout, before it's measured). The
          resize grip sits in its bottom-right corner, over the board. It doesn't clip: the board
          inside rounds its own corners (board.css), so the move mark's badge can overhang an edge
          square into the row above or the column beside it. */}
      <div
        ref={frameRef}
        className={cn(
          "board-frame relative row-start-2 box-content size-[var(--board-size,calc(var(--board-avail)_-_2px))] rounded-lg border border-line",
          boardColumn
        )}
      >
        {children}
        <BoardResizeGrip availRef={probeRef} />
      </div>
      <div className={cn("min-w-0 contain-inline-size", boardColumn)}>{bottom}</div>
    </div>
  );
}

/**
 * Tabs for the workspace panel: text-only segments sized to their labels, sharing the full width;
 * tighter padding when the panel is at its minimum width so four labels still fit.
 */
export const workspaceTabsClass =
  "[&>button]:flex-auto [&>button]:px-2.5 @max-[360px]/panel:[&>button]:px-1.5";

/** "White vs Black" game title for the titlebar. */
export function PlayersTitle({ white, black }: { white: string; black: string }) {
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 font-medium text-fg"
      title={`${white} vs ${black}`}
    >
      <span className="truncate">{white}</span>
      <span className="shrink-0 font-normal text-fg-subtle">vs</span>
      <span className="truncate">{black}</span>
    </span>
  );
}

/**
 * Titlebar content for every board mode: game title, result badge and transient status on the
 * left; the mode's own actions (primary first, all size="sm") on the right. No mode name — the
 * sidebar's active item already says where you are — and no board commands (sidebar).
 */
export function WorkspaceTitlebar({
  title,
  meta,
  result,
  status,
  statusIsError = false,
  actions
}: {
  title?: ReactNode;
  /** Quiet facts about the game after the title (a Lichess game: `Rated · Rapid · 10+5`). */
  meta?: ReactNode;
  result?: string | null;
  status?: ReactNode;
  statusIsError?: boolean;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {title}
        {meta ? <span className="shrink-0 text-xs text-fg-muted">{meta}</span> : null}
        {result ? <Badge className="shrink-0 font-mono">{result}</Badge> : null}
        <span
          className={cn("ml-2 min-w-0 truncate", statusIsError ? "text-danger" : "text-fg-muted")}
          role="status"
        >
          {status}
        </span>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
          {actions}
        </div>
      ) : null}
    </>
  );
}
