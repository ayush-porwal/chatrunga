import type { ReactNode } from "react";
import { Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { card, titlebarIconButton } from "@/lib/ui";
import { cn } from "@/lib/utils";

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
 * every mode: mode · game title · result … mode actions · Flip.
 */

export function BoardWorkspace({
  board,
  tabs,
  summary,
  notices,
  footer,
  children,
  panelLabel,
  showPanel = true
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
  /** Focus mode hides the panel; the board cell keeps the same sizing rule. */
  showPanel?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid h-full min-h-0 min-w-0 gap-3 p-3",
        showPanel ? "grid-cols-[minmax(0,1fr)_clamp(320px,26vw,420px)]" : "grid-cols-[minmax(0,1fr)]"
      )}
    >
      <section className="grid min-h-0 min-w-0 place-items-center p-3 [container-type:size]" aria-label="Board">
        {board}
      </section>
      {showPanel ? (
        <aside
          className={cn(card, "@container/panel flex min-h-0 flex-col overflow-hidden")}
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
      ) : null}
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
 * Titlebar content for every board mode: quiet mode name, game title, result badge and transient
 * status on the left; mode actions (primary first, all size="sm") then Flip on the right.
 */
export function WorkspaceTitlebar({
  mode,
  title,
  result,
  status,
  statusIsError = false,
  actions,
  onFlip
}: {
  mode: string;
  title?: ReactNode;
  result?: string | null;
  status?: ReactNode;
  statusIsError?: boolean;
  actions?: ReactNode;
  onFlip: () => void;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="shrink-0 text-fg-muted">{mode}</span>
        {title ? (
          <>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
            {title}
          </>
        ) : null}
        {result ? <Badge className="shrink-0 font-mono">{result}</Badge> : null}
        <span
          className={cn("ml-2 min-w-0 truncate", statusIsError ? "text-danger" : "text-fg-muted")}
          role="status"
        >
          {status}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
        {actions}
        <IconButton label="Flip board" icon={<Repeat2 />} className={titlebarIconButton} onClick={onFlip} />
      </div>
    </>
  );
}
