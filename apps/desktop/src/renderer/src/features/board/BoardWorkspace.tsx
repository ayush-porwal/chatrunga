import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { card } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useBoardFocused } from "./board-focus";

/*
 * The board workspace: ONE layout for every board screen (New game, Analysis, Game review,
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
 */

export function BoardWorkspace({
  board,
  tabs,
  summary,
  notices,
  footer,
  children,
  panelLabel,
  showPanel
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
}) {
  const focused = useBoardFocused();
  const panelVisible = showPanel ?? !focused;
  return (
    <div
      className={cn(
        "grid h-full min-h-0 min-w-0 p-3",
        // Same track count in both states, so the column (and the gap) can ease — like the sidebar.
        "transition-[grid-template-columns,column-gap] duration-emphasis ease-standard",
        panelVisible ? "grid-cols-[minmax(0,1fr)_clamp(320px,26vw,420px)] gap-3" : "grid-cols-[minmax(0,1fr)_0px] gap-0"
      )}
    >
      <section className="grid min-h-0 min-w-0 place-items-center p-3 [container-type:size]" aria-label="Board">
        {board}
      </section>
      {/* The cell clips; the panel keeps its full width and slides out with the column's left edge. */}
      <div className="flex min-h-0 min-w-0 overflow-hidden" inert={!panelVisible} aria-hidden={!panelVisible || undefined}>
        <aside
          className={cn(
            card,
            "@container/panel flex min-h-0 w-[clamp(320px,26vw,420px)] shrink-0 flex-col overflow-hidden",
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
            <div className="min-h-0 flex-1">{children}</div>
          </div>
          {footer ? <div className="shrink-0 border-t border-line-subtle">{footer}</div> : null}
        </aside>
      </div>
    </div>
  );
}

/**
 * Board + the two player rows as one unit. The square is computed once from the board cell
 * (a size container): as large as fits after the two 2rem rows and gaps, capped at 1120px.
 */
export function BoardStage({ top, bottom, children }: { top: ReactNode; bottom: ReactNode; children: ReactNode }) {
  return (
    <div className="grid w-[min(100cqw,calc(100cqh_-_5rem),1120px)] min-w-0 gap-2">
      {top}
      {/* The one board frame: hairline border + radius, no shadow, no card around it. */}
      <div className="aspect-square w-full overflow-hidden rounded-lg border border-line">{children}</div>
      {bottom}
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
