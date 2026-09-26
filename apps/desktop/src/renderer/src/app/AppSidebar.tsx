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
  RotateCcw,
  Settings,
  Swords,
  Upload
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Eyebrow } from "@/components/ui/page";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { titlebarIconButton } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * Left navigation, below the titlebar on the window chrome (no border — the inset content panel
 * next to it provides the edge). Expanded: labelled items. Collapsed: an icon rail with tooltips.
 * Both states use the same 36px rows and the same icon x-position (18px), so toggling never moves
 * an icon; every command stays one click away in both states.
 */
export function AppSidebar({
  expanded,
  active,
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
  onSettings: () => void;
}) {
  const item = (icon: LucideIcon, label: string, onClick: () => void, isActive = false) => (
    <SidebarCommand expanded={expanded} icon={icon} label={label} active={isActive} onClick={onClick} />
  );

  return (
    <nav
      className="scroll-area col-start-1 row-start-2 flex min-h-0 w-[var(--sidebar-width)] flex-col justify-between gap-3 overflow-y-auto overflow-x-hidden px-2 pb-2"
      aria-label="Application actions"
    >
      <div className="grid min-w-0 content-start gap-0.5">
        {item(Home, "Home", onHome, active.home)}
        {/* Same height in both states: the "Game" label expanded, a hairline collapsed. */}
        <div className="flex h-8 items-center px-2.5">
          {expanded ? <Eyebrow className="truncate">Game</Eyebrow> : <Separator className="bg-line-subtle" />}
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

      <div className="grid min-w-0 gap-0.5">
        {item(focusMode ? Minimize2 : Maximize2, focusMode ? "Show panels" : "Focus board", onFocusToggle, focusMode)}
        {item(Settings, "Settings", onSettings, active.settings)}
      </div>
    </nav>
  );
}

/** Nav item: ghost button, 16px icon, active = control fill. */
const navItem =
  "text-fg-secondary [-webkit-app-region:no-drag] hover:bg-control hover:text-fg aria-pressed:bg-control aria-pressed:text-fg";

function SidebarCommand({
  active = false,
  expanded,
  icon: Icon,
  label,
  onClick
}: {
  active?: boolean;
  expanded: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={expanded ? "default" : "icon"}
      // Expanded: 1px border + 9px padding puts the icon at the same x as the centred 36px rail button.
      className={cn(navItem, expanded && "w-full justify-start gap-3 px-[9px]")}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active || undefined}
    >
      <Icon />
      {expanded ? <span className="truncate">{label}</span> : null}
    </Button>
  );

  if (expanded) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Titlebar button that shows/hides the sidebar: one static sidebar glyph (like SF Symbols
 * `sidebar.left`) in both states; only the label and the pressed/expanded state change.
 */
export function SidebarToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <IconButton
      label={expanded ? "Hide sidebar" : "Show sidebar"}
      icon={<PanelLeft />}
      className={titlebarIconButton}
      onClick={onClick}
      aria-expanded={expanded}
    />
  );
}
