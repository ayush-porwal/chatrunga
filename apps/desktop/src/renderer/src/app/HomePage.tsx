import { BarChart3, Database, FileSearch, Puzzle, RotateCcw, Swords, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { listRowInteractive } from "@/lib/ui";

type HomeEntry = {
  icon: LucideIcon;
  /** Same label as the sidebar item it mirrors. */
  title: string;
  description: string;
  onClick: () => void;
  desktopOnly: boolean;
};

export function HomePage({
  desktopApiAvailable,
  onAnalyze,
  onDatabases,
  onEngineGame,
  onImportPgn,
  onNewGame,
  onPuzzles,
  onReview
}: {
  desktopApiAvailable: boolean;
  onAnalyze: () => void;
  onDatabases: () => void;
  onEngineGame: () => void;
  onImportPgn: () => void;
  onNewGame: () => void;
  onPuzzles: () => void;
  onReview: () => void;
}) {
  const entries: HomeEntry[] = [
    { icon: RotateCcw, title: "New game", description: "Empty board, free play", onClick: onNewGame, desktopOnly: false },
    { icon: FileSearch, title: "Analyze", description: "Live engine lines for any position", onClick: onAnalyze, desktopOnly: true },
    { icon: BarChart3, title: "Game review", description: "Classify every move of a game", onClick: onReview, desktopOnly: true },
    { icon: Swords, title: "Engine game", description: "Play a game against an engine", onClick: onEngineGame, desktopOnly: true },
    { icon: Puzzle, title: "Puzzles", description: "Tactics from a puzzle database", onClick: onPuzzles, desktopOnly: true },
    { icon: Database, title: "Databases", description: "Download puzzle and position data", onClick: onDatabases, desktopOnly: true }
  ];

  return (
    <Page>
      <PageHeader
        title="Home"
        actions={
          <Button type="button" variant="outline" onClick={onImportPgn} disabled={!desktopApiAvailable}>
            <Upload />
            Import PGN
          </Button>
        }
      />
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => {
          const Icon = entry.icon;
          const disabled = entry.desktopOnly && !desktopApiAvailable;
          return (
            <button
              key={entry.title}
              type="button"
              className={cn(listRowInteractive, "min-h-16 gap-3 px-4 disabled:pointer-events-none disabled:opacity-50")}
              disabled={disabled}
              onClick={entry.onClick}
            >
              <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-medium text-fg">{entry.title}</span>
                <span className="truncate text-xs text-fg-muted">
                  {disabled ? "Desktop app required" : entry.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Page>
  );
}
