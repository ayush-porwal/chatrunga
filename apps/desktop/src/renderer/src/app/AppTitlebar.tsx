import { memo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { positionStatus } from "@/lib/position-status";
import { titlebarIconButton } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { PlayersTitle, WorkspaceTitlebar } from "../features/board/BoardWorkspace";
import { MatchActions } from "../features/analysis/MatchActions";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { selectCanGoBack, selectCanGoForward, useHistoryStore } from "../stores/history-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { useSaveStatusStore } from "../stores/save-status-store";
import { SidebarToggle } from "./AppSidebar";
import { historyShortcutLabels } from "./useHistoryShortcuts";
import { decidedResult, gameModeLabel, gamePlayerNames } from "./game-title";

/**
 * The one titlebar row across the full window width (window drag region, chrome colour):
 *
 *   [traffic-light reserve][sidebar toggle] │ title ……………………………… actions
 *
 * - macOS: the native traffic lights sit at x 18–78, y 20–34 (trafficLightPosition + Tahoe-size
 *   buttons). The 54px row centres its controls on them (y 27) and the toggle starts at 90px —
 *   the same breathing room the macOS reference apps use. Both are divided by the page zoom so they
 *   stay on the (unzoomed) traffic lights. Elsewhere (web preview, Windows/Linux frames) the toggle
 *   sits right over the sidebar's icons.
 * - Sidebar expanded: the title starts exactly at the content panel's left edge (the lead is as
 *   wide as the sidebar column), so title and panel line up; the divider is not needed there.
 *   Collapsed: toggle │ title stay grouped right after the traffic lights (the macOS toolbar
 *   pattern). The lead's width eases with the sidebar column (same duration and curve), so the
 *   title glides between the two positions and never passes the panel edge.
 * - The title is the section name for page views and the game title (players · result) for board
 *   views — never the mode name, which the sidebar's active item already shows. Pages do not
 *   repeat it as a big heading.
 */
export function AppTitlebar({
  windowControlsInset,
  sidebarExpanded,
  onToggleSidebar,
  onBack,
  onForward,
  children
}: {
  /** Reserve room for the macOS traffic lights. */
  windowControlsInset: boolean;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  onBack: () => void;
  onForward: () => void;
  children: ReactNode;
}) {
  return (
    <header
      className="col-[1/-1] row-start-1 flex h-[var(--titlebar-height)] min-w-0 items-center pr-3 text-sm text-fg-muted [-webkit-app-region:drag]"
      aria-label="Titlebar"
      data-chrome
    >
      {/* Lead = inset + toggle (1.75rem) + divider (0.75rem · 1px · 0.75rem), or the sidebar width if
          wider. In rem like the toggle, so it still fits when the type steps up on big monitors
          (53px at the base size). `--sidebar-width` comes from the app frame and switches with the
          sidebar state. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center transition-[width] duration-emphasis ease-standard",
          windowControlsInset
            ? "w-[max(calc(90px/var(--window-zoom,1)_+_7rem_+_1px),var(--sidebar-width))] pl-[calc(90px/var(--window-zoom,1))]"
            : "w-[max(calc(7.75rem_+_1px),var(--sidebar-width))] pl-3"
        )}
      >
        <SidebarToggle expanded={sidebarExpanded} onClick={onToggleSidebar} />
        <HistoryButtons onBack={onBack} onForward={onForward} />
        <span
          aria-hidden="true"
          className={cn(
            "mx-3 h-4 w-px shrink-0 bg-line transition-opacity duration-micro ease-standard",
            sidebarExpanded ? "opacity-0" : "opacity-100"
          )}
        />
      </div>
      {/* Named for the view transition: the title cross-fades when the view changes (app.css). */}
      <div className="flex min-w-0 flex-1 items-center gap-2 [view-transition-name:app-title]" data-titlebar-title>
        {children}
      </div>
      <SaveFailedButton />
    </header>
  );
}

/** On a page while a Lichess game is on: the way back to the board (the clock keeps running there). */
export function LiveGameButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="xs" className="ml-auto [-webkit-app-region:no-drag]" onClick={onClick}>
      <span className="size-1.5 rounded-full bg-danger motion-safe:animate-pulse" aria-hidden="true" />
      Lichess game in progress
    </Button>
  );
}

/**
 * A game's last save failed: says so on every screen (with the latest error) until every such game
 * saves; click to retry them all.
 */
const SaveFailedButton = memo(function SaveFailedButton() {
  const error = useSaveStatusStore((state) => state.error);
  const retry = useSaveStatusStore((state) => state.retry);
  if (!error) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-2 shrink-0 text-danger [-webkit-app-region:no-drag]"
          onClick={retry}
        >
          Not saved · Retry
        </Button>
      </TooltipTrigger>
      <TooltipContent>{error}</TooltipContent>
    </Tooltip>
  );
});

/** Back / Forward between screens (like a browser's), right of the sidebar toggle. */
const HistoryButtons = memo(function HistoryButtons({ onBack, onForward }: { onBack: () => void; onForward: () => void }) {
  const canGoBack = useHistoryStore(selectCanGoBack);
  const canGoForward = useHistoryStore(selectCanGoForward);
  const keys = historyShortcutLabels();
  return (
    <div className="ml-2 flex items-center gap-0.5">
      <IconButton
        label={`Back (${keys.back})`}
        icon={<ChevronLeft />}
        className={titlebarIconButton}
        disabled={!canGoBack}
        onClick={onBack}
      />
      <IconButton
        label={`Forward (${keys.forward})`}
        icon={<ChevronRight />}
        className={titlebarIconButton}
        disabled={!canGoForward}
        onClick={onForward}
      />
    </div>
  );
});

/** Titlebar title for page views (Home, Settings, …). */
export function PageTitle({ children }: { children: ReactNode }) {
  return <span className="truncate font-medium text-fg">{children}</span>;
}

/**
 * Titlebar for the game view: players (or the puzzle, or the mode name while both sides are
 * unnamed) · result · transient status … Analyze/Stop · match actions (Offer draw, Resign).
 */
export const GameTitlebar = memo(function GameTitlebar({
  engines,
  showAnalysisError,
  canAnalyze,
  onAnalyze,
  onStopAnalysis,
  onReviewGame,
  onPlayAgain
}: {
  engines: readonly EngineConfig[] | undefined;
  /** Engine errors show here unless the Engine tab (which shows them itself) is visible. */
  showAnalysisError: boolean;
  canAnalyze: boolean;
  onAnalyze: () => void;
  onStopAnalysis: (() => void) | null;
  /** A finished online game: open it in Game review / find another game. */
  onReviewGame: () => void;
  onPlayAgain: () => void;
}) {
  // Only what the title shows: stepping through moves must not re-render the titlebar.
  const game = useGameStore(
    useShallow((state) => {
      const position = positionStatus(state.currentFen);
      return {
        mode: state.mode,
        source: state.source,
        headers: state.headers,
        engineSide: state.engineSide,
        lastError: state.lastError,
        matchFeedback: state.matchFeedback,
        outcomeResult: state.gameOutcome?.result ?? null,
        positionResult: position.isEnd ? position.result : null
      };
    })
  );
  const analysisError = useAnalysisStore((state) => state.error);
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  const engineName = engines?.find((engine) => engine.id === activeEngineId)?.name ?? null;

  const error = game.lastError || (showAnalysisError ? analysisError : null);
  const players = gamePlayerNames(game, engineName);
  const title =
    game.mode === "puzzle" && activePuzzle ? (
      <span className="truncate font-medium text-fg">Puzzle #{activePuzzle.id}</span>
    ) : players ? (
      <PlayersTitle white={players.white} black={players.black} />
    ) : (
      // Nothing more specific to show (a fresh board): the mode name keeps the titlebar from going blank.
      <span className="truncate font-medium text-fg">{gameModeLabel(game)}</span>
    );

  return (
    <WorkspaceTitlebar
      title={title}
      result={game.outcomeResult ?? game.positionResult ?? decidedResult(game.headers.result)}
      status={game.matchFeedback || error || null}
      statusIsError={!game.matchFeedback && Boolean(error)}
      actions={
        <>
          {onStopAnalysis ? (
            <Button type="button" variant="outline" size="sm" onClick={onStopAnalysis}>
              Stop analysis
            </Button>
          ) : canAnalyze ? (
            <Button type="button" variant="primary" size="sm" onClick={onAnalyze}>
              Analyze
            </Button>
          ) : null}
          <MatchActions onReview={onReviewGame} onPlayAgain={onPlayAgain} />
        </>
      }
    />
  );
});

/** Titlebar for Game review: players · result … Analyze / Stop / Analyze again. */
export const ReviewTitlebar = memo(function ReviewTitlebar({
  gameLoading,
  hasMoves,
  onAnalyze,
  onStop
}: {
  gameLoading: boolean;
  /** The game has main-line moves to review. */
  hasMoves: boolean;
  onAnalyze: () => void;
  onStop: () => void;
}) {
  const headers = useGameStore((state) => state.headers);
  const running = useReviewStore((state) => state.status === "running");
  const hasReview = useReviewStore((state) => Boolean(state.review));

  return (
    <WorkspaceTitlebar
      title={<PlayersTitle white={headers.white || "White"} black={headers.black || "Black"} />}
      result={decidedResult(headers.result)}
      actions={
        running || hasMoves ? (
          <Button
            type="button"
            variant={running ? "outline" : "primary"}
            size="sm"
            disabled={!running && gameLoading}
            onClick={running ? onStop : onAnalyze}
          >
            {running ? "Stop" : hasReview ? "Analyze again" : "Analyze"}
          </Button>
        ) : (
          // A disabled button gets no pointer events, so the tooltip hangs off a focusable wrapper.
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                <Button type="button" variant="primary" size="sm" disabled>
                  Analyze
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Add or import moves to review</TooltipContent>
          </Tooltip>
        )
      }
    />
  );
});
