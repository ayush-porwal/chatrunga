import {
  BarChart3,
  Database,
  Download,
  FileSearch,
  Home,
  Maximize2,
  Minimize2,
  PanelLeft,
  Puzzle,
  Repeat2,
  RotateCcw,
  Settings,
  Swords,
  Upload
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Eyebrow } from "@/components/ui/page";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { titlebarIconButton } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { UpdateButton } from "../features/updates/UpdateButton";
import { BOARD_SHORTCUTS } from "./useBoardShortcuts";

/**
 * Left navigation, below the titlebar on the window chrome (no border — the inset content panel
 * next to it provides the edge). Expanded: labelled items. Collapsed: an icon rail with tooltips.
 * Both states use the same 36px rows and the same icon x-position (18px), so toggling never moves
 * an icon; every command stays one click away in both states.
 *
 * Board commands (Focus board, Flip board) sit in the bottom group, above Settings, and only on
 * views with a board; their keys (F, X) show as a hint in the row and in the rail's tooltip.
 * The update button shares the Settings row: click checks for updates; once one exists it turns
 * accent and its hover card shows the changelog (features/updates/UpdateButton.tsx).
 *
 * Motion: the app frame eases the sidebar column's width (App.tsx); the nav fills that column and
 * clips, so labels are never re-wrapped — they fade out quickly on collapse and fade in just behind
 * the opening edge on expand. Items are the same element in both states (no remount), which is what
 * lets their label, hover and pressed states transition.
 */
export const AppSidebar = memo(function AppSidebar({
  expanded,
  active,
  boardView,
  focusMode,
  onHome,
  onNewGame,
  onAnalyze,
  onReview,
  onEngineGame,
  onPuzzles,
  onDatabases,
  onImport,
  onExport,
  onFocusToggle,
  onFlip,
  onSettings
}: {
  expanded: boolean;
  active: {
    home: boolean;
    analyze: boolean;
    review: boolean;
    engineGame: boolean;
    puzzles: boolean;
    databases: boolean;
    settings: boolean;
  };
  /** The current view has a board: offer Focus board (it has nothing to focus elsewhere). */
  boardView: boolean;
  focusMode: boolean;
  onHome: () => void;
  onNewGame: () => void;
  onAnalyze: () => void;
  onReview: () => void;
  onEngineGame: () => void;
  onPuzzles: () => void;
  onDatabases: () => void;
  onImport: () => void;
  onExport: () => void;
  onFocusToggle: () => void;
  onFlip: () => void;
  onSettings: () => void;
}) {
  const item = (icon: LucideIcon, label: string, onClick: () => void, isActive = false, shortcut?: string) => (
    <SidebarCommand expanded={expanded} icon={icon} label={label} active={isActive} shortcut={shortcut} onClick={onClick} />
  );

  return (
    <nav
      className="scroll-area col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col justify-between gap-3 overflow-y-auto overflow-x-hidden px-2 pb-2"
      aria-label="Application actions"
      data-chrome
    >
      {/* minmax(0,1fr): the track never grows past the rail — a wider item (the "Game" label) would
          make the collapsed nav scrollable and a click would scroll every icon 8px left. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-0.5">
        {item(Home, "Home", onHome, active.home)}
        {/* Same height in both states: the "Game" label expanded, a hairline collapsed. */}
        <div className="relative flex h-8 min-w-0 items-center overflow-hidden px-2.5">
          <Eyebrow className={cn("whitespace-nowrap", labelFade(expanded))} aria-hidden={!expanded || undefined}>
            Game
          </Eyebrow>
          <Separator
            className={cn(
              "absolute inset-x-2.5 top-1/2 w-auto bg-line-subtle transition-opacity duration-micro",
              expanded ? "opacity-0" : "opacity-100 delay-100"
            )}
          />
        </div>
        {item(RotateCcw, "New game", onNewGame)}
        {item(FileSearch, "Analyze", onAnalyze, active.analyze)}
        {item(BarChart3, "Game review", onReview, active.review)}
        {item(Swords, "Engine game", onEngineGame, active.engineGame)}
        {item(Puzzle, "Puzzles", onPuzzles, active.puzzles)}
        {item(Database, "Databases", onDatabases, active.databases)}
        {item(Upload, "Import PGN", onImport)}
        {item(Download, "Export PGN", onExport)}
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
        {boardView ? (
          <>
            {item(
              focusMode ? Minimize2 : Maximize2,
              focusMode ? "Exit focus" : "Focus board",
              onFocusToggle,
              focusMode,
              BOARD_SHORTCUTS.focus
            )}
            {item(Repeat2, "Flip board", onFlip, false, BOARD_SHORTCUTS.flip)}
          </>
        ) : null}
        {/* Settings with the update button on its row (expanded) or directly above it (rail), so
            Settings itself never moves. */}
        <div className={cn("grid min-w-0 gap-0.5", expanded ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)]")}>
          <div className={cn("min-w-0", expanded ? "col-start-1 row-start-1" : "row-start-2")}>
            {item(Settings, "Settings", onSettings, active.settings)}
          </div>
          <UpdateButton tooltipSide={expanded ? "top" : "right"} className={expanded ? "col-start-2 row-start-1" : "row-start-1"} />
        </div>
      </div>
    </nav>
  );
});

/** Nav item: ghost button, 16px icon, active = control fill. */
const navItem =
  "text-fg-secondary [-webkit-app-region:no-drag] hover:bg-control hover:text-fg aria-pressed:bg-control aria-pressed:text-fg";

/**
 * Label visibility while the column animates: collapsing, the label is gone in one micro step
 * (before the edge reaches it); expanding, it fades in behind the opening edge.
 */
function labelFade(expanded: boolean) {
  return expanded
    ? "opacity-100 transition-opacity duration-standard ease-enter delay-75"
    : "opacity-0 transition-opacity duration-micro ease-standard";
}

const SidebarCommand = memo(function SidebarCommand({
  active = false,
  expanded,
  icon: Icon,
  label,
  shortcut,
  onClick
}: {
  active?: boolean;
  expanded: boolean;
  icon: LucideIcon;
  label: string;
  /** Single-key shortcut: a quiet hint at the row's end (expanded) and in the tooltip (collapsed). */
  shortcut?: string;
  onClick: () => void;
}) {
  // One element in both states: 36px tall, full column width (36px when collapsed), icon at 9px +
  // 1px border — the same x as the centred rail button. Only the label and the tooltip change.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(navItem, "w-full justify-start gap-3 overflow-hidden px-[9px] active:scale-[0.97]")}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active || undefined}
          aria-keyshortcuts={shortcut}
        >
          <Icon />
          <span className={cn("min-w-0 whitespace-nowrap", expanded && "truncate", labelFade(expanded))} aria-hidden="true">
            {label}
          </span>
          {shortcut ? <ShortcutHint className={cn("ml-auto", labelFade(expanded))}>{shortcut}</ShortcutHint> : null}
        </Button>
      </TooltipTrigger>
      {expanded ? null : (
        <TooltipContent side="right">
          {shortcut ? (
            <span className="flex items-center gap-2">
              {label}
              <ShortcutHint>{shortcut}</ShortcutHint>
            </span>
          ) : (
            label
          )}
        </TooltipContent>
      )}
    </Tooltip>
  );
});

/** A key cap for a single-key shortcut (quiet: it must not compete with the label). */
function ShortcutHint({ className, children }: { className?: string; children: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "grid h-5 min-w-5 shrink-0 place-items-center rounded border border-line px-1 font-sans text-2xs font-medium leading-none text-fg-subtle",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Titlebar button that shows/hides the sidebar: one static sidebar glyph (like SF Symbols
 * `sidebar.left`) in both states; only the label and the pressed/expanded state change.
 */
export const SidebarToggle = memo(function SidebarToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <IconButton
      label={expanded ? "Hide sidebar" : "Show sidebar"}
      icon={<PanelLeft />}
      className={titlebarIconButton}
      onClick={onClick}
      aria-expanded={expanded}
    />
  );
});
