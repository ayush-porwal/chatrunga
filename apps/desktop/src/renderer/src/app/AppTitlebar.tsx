import { useMemo, type ReactNode } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PlayersTitle, WorkspaceTitlebar } from "../features/board/BoardWorkspace";
import { EngineMatchActions } from "../features/analysis/EngineMatchActions";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { SidebarToggle } from "./AppSidebar";
import { decidedResult, gameModeLabel, gamePlayerNames } from "./game-title";

/**
 * The one titlebar row across the full window width (window drag region, chrome colour):
 *
 *   [traffic-light reserve][sidebar toggle] │ title ……………………………… actions
 *
 * - macOS: the native traffic lights sit at x 18–78, y 20–34 (trafficLightPosition + Tahoe-size
 *   buttons). The 54px row centres its controls on them (y 27) and the toggle starts at 90px —
 *   the same breathing room the macOS reference apps use.
 *   Elsewhere (web preview, Windows/Linux frames) the toggle sits right over the sidebar's icons.
 * - Both sidebar states: toggle │ title stay grouped right after the traffic lights (the macOS
 *   toolbar pattern), so the title never jumps when the sidebar is toggled.
 * - The title is the section name for every view: the page name for page views, the workspace
 *   title (mode · players · result) for board views. Pages do not repeat it as a big heading.
 */
export function AppTitlebar({
  windowControlsInset,
  sidebarExpanded,
  onToggleSidebar,
  children
}: {
  /** Reserve room for the macOS traffic lights. */
  windowControlsInset: boolean;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  children: ReactNode;
}) {
  return (
    <header
      className="col-[1/-1] row-start-1 flex h-[var(--titlebar-height)] min-w-0 items-center pr-3 text-sm text-fg-muted [-webkit-app-region:drag]"
      aria-label="Titlebar"
      data-chrome
    >
      <div className={cn("flex h-full shrink-0 items-center", windowControlsInset ? "pl-[90px]" : "pl-3")}>
        <SidebarToggle expanded={sidebarExpanded} onClick={onToggleSidebar} />
      </div>
      <span aria-hidden="true" className="mx-3 h-4 w-px shrink-0 bg-line" />
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </header>
  );
}

/** Titlebar title for page views (Home, Settings, …). */
export function PageTitle({ children }: { children: ReactNode }) {
  return <span className="truncate font-medium text-fg">{children}</span>;
}

/** Titlebar for the game view: mode · players · result · transient status … Analyze/Stop · match actions · Flip. */
export function GameTitlebar({
  engines,
  showAnalysisError,
  canAnalyze,
  onAnalyze,
  onStopAnalysis
}: {
  engines: readonly EngineConfig[] | undefined;
  /** Engine errors show here unless the Engine tab (which shows them itself) is visible. */
  showAnalysisError: boolean;
  canAnalyze: boolean;
  onAnalyze: () => void;
  onStopAnalysis: (() => void) | null;
}) {
  const game = useGameStore();
  const analysisError = useAnalysisStore((state) => state.error);
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  const status = useMemo(() => statusForFen(game.currentFen), [game.currentFen]);
  const engineName = engines?.find((engine) => engine.id === activeEngineId)?.name ?? null;

  const error = game.lastError || (showAnalysisError ? analysisError : null);
  const players = gamePlayerNames(game, engineName);
  const title =
    game.mode === "puzzle" && activePuzzle ? (
      <span className="truncate font-medium text-fg">Puzzle #{activePuzzle.id}</span>
    ) : players ? (
      <PlayersTitle white={players.white} black={players.black} />
    ) : null;

  return (
    <WorkspaceTitlebar
      mode={gameModeLabel(game)}
      title={title}
      result={game.gameOutcome?.result ?? (status.isEnd ? status.result : decidedResult(game.headers.result))}
      status={game.matchFeedback || error || null}
      statusIsError={!game.matchFeedback && Boolean(error)}
      onFlip={game.flip}
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
          <EngineMatchActions />
        </>
      }
    />
  );
}

/** Titlebar for Game review: players · result … Analyze / Stop / Analyze again · Flip. */
export function ReviewTitlebar({
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
  const flip = useGameStore((state) => state.flip);
  const running = useReviewStore((state) => state.status === "running");
  const hasReview = useReviewStore((state) => Boolean(state.review));

  return (
    <WorkspaceTitlebar
      mode="Game review"
      title={<PlayersTitle white={headers.white || "White"} black={headers.black || "Black"} />}
      result={decidedResult(headers.result)}
      onFlip={flip}
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
}
