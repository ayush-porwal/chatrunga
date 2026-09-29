import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { card, motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useBoardFocused } from "./board-focus";

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
 * The board cell grows into the space frame by frame (the board is sized from the cell).
 *
 * Sizing (the `--workspace-*` variables in app.css, fluid from the 980px minimum to ultra-wide):
 * the panel grows with the window (320px → 34rem); padding and gap scale together; the board is
 * as large as the height allows (`--workspace-board`). The grid is capped at exactly board + gap +
 * panel and centred, so on a wide window the spare width goes to both outer margins and the board
 * stays next to its panel. On a narrow window the cap is not reached and the board takes the
 * width left beside the panel.
 */

export function BoardWorkspace({
  board,
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
  /** Panel tabs (one SegmentedControl role="tablist"). */
  tabs?: ReactNode;
  /** One-line summary strip under the tabs (fixed height, rendered even when empty). */
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
  return (
    // Size container: the grid's width cap is computed from this box's height (cqh).
    <div className="h-full min-h-0 min-w-0 [container-type:size]">
      <div
        className={cn(
          "mx-auto grid h-full min-h-0 w-full min-w-0 p-(--workspace-pad)",
          // Same track count in both states, so the column, the gap and the cap ease together — like the
          // sidebar. Only while the panel is toggling: these sizes follow the window, and a transition
          // left on would make the board trail a live window resize.
          easing && "transition-[grid-template-columns,column-gap,max-width] duration-emphasis ease-standard",
          panelVisible
            ? "max-w-[calc(var(--workspace-board)+var(--workspace-eval)+3*var(--workspace-pad)+var(--workspace-panel))] grid-cols-[minmax(0,1fr)_var(--workspace-panel)] gap-(--workspace-pad)"
            : "max-w-[calc(var(--workspace-board)+var(--workspace-eval)+2*var(--workspace-pad))] grid-cols-[minmax(0,1fr)_0px] gap-0"
        )}
      >
        <section className="grid min-h-0 min-w-0 place-items-center [container-type:size]" aria-label="Board">
          {board}
        </section>
        {/* The cell clips; the panel keeps its full width and slides out with the column's left edge. */}
        <div className="flex min-h-0 min-w-0 overflow-hidden" inert={!panelVisible} aria-hidden={!panelVisible || undefined}>
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
            {tabs ? <div className="shrink-0 px-3 pt-3">{tabs}</div> : null}
            <div className="flex h-14 shrink-0 items-center border-b border-line-subtle px-3">{summary}</div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              {notices}
              <div className="min-h-0 flex-1" {...tabPanel}>
                {children}
              </div>
            </div>
            {footer ? <div className="shrink-0 border-t border-line-subtle">{footer}</div> : null}
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
 * Board + the two player rows as one unit, with the eval bar's column on the left. The square is
 * computed once from the board cell (a size container): as large as fits after the two 2rem rows
 * and gaps (the same 5rem that `--workspace-board` subtracts) and the eval column, with a 100rem
 * ceiling. The column is always reserved, so the board never moves when the bar comes and goes.
 */
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
  return (
    <div className="grid w-[min(100cqw,calc(100cqh_-_5rem_+_var(--workspace-eval)),calc(100rem_+_var(--workspace-eval)))] min-w-0 grid-cols-[var(--workspace-eval)_minmax(0,1fr)] gap-y-2">
      <div className="col-start-2 min-w-0">{top}</div>
      <div className="col-start-1 row-start-2 pr-1.5">{evalBar}</div>
      {/* The one board frame: hairline border + radius, no shadow, no card around it. */}
      <div className="col-start-2 row-start-2 aspect-square w-full overflow-hidden rounded-lg border border-line">{children}</div>
      <div className="col-start-2 min-w-0">{bottom}</div>
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
    <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg" title={`${white} vs ${black}`}>
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
  result,
  status,
  statusIsError = false,
  actions
}: {
  title?: ReactNode;
  result?: string | null;
  status?: ReactNode;
  statusIsError?: boolean;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {title}
        {result ? <Badge className="shrink-0 font-mono">{result}</Badge> : null}
        <span
          className={cn("ml-2 min-w-0 truncate", statusIsError ? "text-danger" : "text-fg-muted")}
          role="status"
        >
          {status}
        </span>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">{actions}</div> : null}
    </>
  );
}
