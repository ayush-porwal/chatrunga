import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { useMemo, type ReactNode } from "react";
import { CircleAlert, Cpu, Download, Lock, RotateCcw, Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { formatScore } from "../game-review/review-score";
import type { GoToLine } from "../game-review/MoveLinks";
import { uciLineToSan } from "../game-review/review-utils";
import { useGameStore } from "../../stores/game-store";
import type { EngineConfig, EngineInfo, EngineStatus } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { analysisLimitLabel, rowEngine } from "./analysis-engine";
import {
  engineHolder,
  onPausedPosition,
  pausedStatusLabel,
  type PausedAnalysis
} from "./live-analysis";
import { EngineAvatar } from "./EngineAvatar";
import {
  EngineLines,
  FigurineSan,
  useLineInteractions,
  usePieceSetClass,
  whiteScore,
  type LinesPosition
} from "./EngineLines";
import { Notice } from "@/components/ui/notice";
import { IconButton } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { StatCell, StatStrip } from "@/components/ui/stat-strip";
import { cn } from "@/lib/utils";

const goToLine: GoToLine = (target) => {
  useGameStore.getState().goToLine(target.startNodeId, target.moves);
};

/** The position an engine panel's lines belong to, and what the panel may do with them. */
export type EnginePanelPosition = LinesPosition & {
  /** Live analysis runs (not an engine game's opponent): Restart is offered. */
  analysing: boolean;
  /** An engine game's opponent: its one line is shown once the game is decided. */
  engineGame: boolean;
};

/** The game board's position for the Moves tab's engine: picking a line's move walks the board there. */
function useBoardEnginePosition(): EnginePanelPosition {
  const fen = useGameStore((state) => state.currentFen);
  const nodeId = useGameStore((state) => state.currentNodeId);
  const orientation = useGameStore((state) => state.orientation);
  // During a live engine match lines are read-only (the game store refuses new branches then).
  const linesNavigable = useGameStore(
    (state) => state.mode !== "engine" || !state.engineSide || Boolean(state.gameOutcome)
  );
  // Live analysis (not an engine game's opponent): the engine can be switched from the header.
  const analysing = useGameStore((state) => state.mode === "analysis");
  const engineGame = useGameStore((state) => state.mode === "engine");
  return useMemo(
    () => ({
      fen,
      nodeId,
      orientation,
      analysing,
      engineGame,
      onGoToLine: linesNavigable ? goToLine : undefined
    }),
    [fen, nodeId, orientation, analysing, engineGame, linesNavigable]
  );
}

/** How Study fits the engine panel in beside its moves (see StudyEnginePanel). */
type EnginePanelLayout = {
  /** Offered when no engine is installed (the way to get one). */
  onOpenSettings?: () => void;
  /** A control at the end of the header (e.g. Close); the header then always shows. */
  headerAction?: ReactNode;
  /** One line above the lines saying what picking a move does. */
  linesHint?: ReactNode;
};

/** Only what an engine panel shows of the analysis (engine info arrives throttled, ~6 updates a second at most). */
function useEngineReadout() {
  return useAnalysisStore(
    useShallow((state) => ({
      status: state.status,
      latestInfo: state.latestInfo,
      topLines: state.topLines,
      bestMove: state.bestMove,
      error: state.error
    }))
  );
}

/** The principal line (with MultiPV the latest info can be line 2/3) and its best move in SAN. */
function usePrincipalLine(
  fen: string,
  readout: Pick<ReturnType<typeof useEngineReadout>, "topLines" | "latestInfo" | "bestMove">
) {
  const { topLines, latestInfo, bestMove } = readout;
  const primary = topLines.find((line) => (line.multipv ?? 1) === 1) ?? latestInfo;
  const best = bestMove ?? primary?.pv?.[0] ?? null;
  const bestSan = useMemo(
    () => (best ? (uciLineToSan(fen, [best])[0] ?? null) : null),
    [best, fen]
  );
  return { primary, best, bestSan };
}

/**
 * Study's engine panel: one row of header with the depth in it, the lines (no Depth / Score /
 * Best row: the first line's score and move say them) and the hovered move's preview floating
 * beside the side panel. Locked while a Lichess game is being played (outside help is against
 * Lichess's fair-play rules).
 */
export function EngineAnalysisPanel(props: EnginePanelLayout & { position: EnginePanelPosition }) {
  const onlineGame = useLichessStore(selectLiveGameInProgress);
  if (onlineGame) {
    return (
      <Notice tone="info" icon={<Lock />} title={LICHESS_LOCK_TITLE}>
        {LICHESS_LOCK_TEXT}
      </Notice>
    );
  }
  return <EngineStatusPanelContent {...props} />;
}

const LICHESS_LOCK_TITLE = "Engine off during your Lichess game";
const LICHESS_LOCK_TEXT =
  "Lichess doesn’t allow outside help while a game is on. The engine, Maia and the coach are back for the review once it ends.";
const NO_ENGINE_TITLE = "No engine installed";
const NO_ENGINE_TEXT = "Download Stockfish or add a UCI engine you already have.";

/** The analysis settings as they apply (the defaults until the saved ones load). */
function useAnalysisSettings(): AppSettings {
  const settings = useSettingsQuery();
  return { ...defaultSettings, ...settings.data };
}

/** Whether no engine can analyse (Maia too can, when it's the only one installed). */
function useNoEngines(): boolean {
  const engines = useEnginesQuery();
  return engines.isSuccess && !engines.data.some((engine) => engine.isAvailable);
}

/** What the engine is doing, in Study's header: in full (its title), and the short form shown. */
function studyEngineStatus({
  status,
  analysing,
  searchLimit,
  depth
}: {
  status: EngineStatus;
  analysing: boolean;
  searchLimit: string | null;
  /** The depth the principal line reached. */
  depth: number | undefined;
}): { label: string; short: string } {
  if (status === "error") {
    const label = "The engine stopped with an error";
    return { label, short: label };
  }
  if (analysing) {
    if (status === "ready") {
      const label = `Finished at depth ${depth ?? "–"}`;
      return { label, short: label };
    }
    const label = searchLimit ? `Analysing to ${searchLimit}` : "Analysing until stopped";
    // The depth reached while searching (there's no Depth stat), else the status.
    return { label, short: depth ? `Depth ${depth}` : label };
  }
  const label = ENGINE_STATUS_WORDS[status];
  return { label, short: label };
}

/** A search starting or running, in words; any other status is "Stopped". */
const ENGINE_STATUS_WORDS: Record<Exclude<EngineStatus, "error">, string> = {
  idle: "Stopped",
  ready: "Stopped",
  starting: "Starting…",
  thinking: "Thinking…"
};

function EngineStatusPanelContent({
  position,
  onOpenSettings,
  headerAction,
  linesHint
}: EnginePanelLayout & { position: EnginePanelPosition }) {
  const readout = useEngineReadout();
  const { status, latestInfo, topLines, error } = readout;
  const { fen, analysing, engineGame } = position;
  const analysisSettings = useAnalysisSettings();
  // An engine game asks for one line; live analysis (running or stopped) for as many as its settings say.
  const reservedLines = engineGame ? 1 : analysisSettings.analysisLines;
  const interactions = useLineInteractions(fen);
  const { primary, best } = usePrincipalLine(fen, readout);
  const hasData = Boolean(latestInfo || topLines.length || best);
  const idle = searchStopped(status);
  // Nothing to analyse with: say so and point to Settings instead of an error with no way out.
  const noEngines = useNoEngines();
  const engineStatus = studyEngineStatus({
    status,
    analysing,
    searchLimit: analysisLimitLabel(analysisSettings),
    depth: primary?.depth
  });

  return (
    <section className="grid content-start gap-2">
      {hasData || !idle || headerAction ? (
        <StudyEngineHeader
          engineGame={engineGame}
          status={engineStatus}
          restart={analysing ? restartLabel(status) : null}
          action={headerAction}
        />
      ) : null}
      {hasData ? (
        topLines.length ? (
          <div className="grid gap-1">
            {linesHint ? <p className="text-xs text-fg-muted">{linesHint}</p> : null}
            {/* Rows are reserved up to the MultiPV count so lines arriving never push content down. */}
            <EngineLines
              position={position}
              lines={topLines}
              reserved={reservedLines}
              compact
              interactions={interactions}
            />
          </div>
        ) : null
      ) : (
        <StudyEngineWaiting status={status} noEngines={noEngines} onOpenSettings={onOpenSettings} />
      )}
      {error && !(idle && noEngines) ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}

/**
 * Study's header row: the engine's picture and name (see useRowEngine) and what it is doing,
 * Restart (`restart`, its label) while live analysis runs, and the panel's own control (`action`).
 */
function StudyEngineHeader({
  engineGame,
  status,
  restart,
  action
}: {
  engineGame: boolean;
  status: { label: string; short: string };
  restart: string | null;
  action: ReactNode;
}) {
  const restartFresh = useAnalysisStore((state) => state.restartFresh);
  const engine = useRowEngine(engineGame);
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <EngineAvatar engine={engine} size="xs" />
        <h3 className="truncate text-sm font-semibold text-fg">
          {engine ? engineDisplayName(engine.name) : "Engine"}
        </h3>
        <p className="truncate text-xs text-fg-muted" title={status.label}>
          {status.short}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* An engine that stopped with an error runs no search: Restart is the way on. */}
        {restart ? (
          <IconButton label={restart} icon={<RotateCcw />} onClick={restartFresh} />
        ) : null}
        {action}
      </div>
    </div>
  );
}

/** No search starts or runs: the engine is idle, or stopped with an error. */
function searchStopped(status: EngineStatus): boolean {
  return status === "idle" || status === "error";
}

/**
 * Restart's label: a search that reached its depth or time limit (no search runs) searches again.
 */
function restartLabel(status: EngineStatus): string {
  return status === "ready" ? "Search again from scratch" : "Restart analysis from scratch";
}

/**
 * Study's panel before the engine has said anything: no engine to analyse with (the way to get
 * one), a search starting or running, or nothing while it is stopped.
 */
function StudyEngineWaiting({
  status,
  noEngines,
  onOpenSettings
}: {
  status: EngineStatus;
  noEngines: boolean;
  onOpenSettings?: () => void;
}) {
  if (searchStopped(status)) {
    if (!noEngines) return null;
    return (
      <EmptyState
        icon={<Cpu />}
        title={NO_ENGINE_TITLE}
        description={NO_ENGINE_TEXT}
        action={
          onOpenSettings ? (
            <Button type="button" variant="primary" size="sm" onClick={onOpenSettings}>
              <Settings />
              Open Settings
            </Button>
          ) : undefined
        }
        className="py-6"
      />
    );
  }
  return (
    <EmptyState
      compact
      title={
        status === "starting"
          ? "Starting engine…"
          : status === "thinking"
            ? "Thinking…"
            : "No analysis yet."
      }
    />
  );
}

/**
 * The Moves tab's engine block, fixed above the move tree: the engine row (its image, name and
 * status, Restart and the Analysis switch: live analysis on and off, the only Start / Stop for the
 * board's engine), then while it's on the Depth / Score / Best strip and the lines. Switched off
 * with lines found, it's paused: they stay as they were. Off, only the row shows, so the tree gets
 * the space. While an engine game is being played only the row shows (its opponent's score and
 * line would be outside help). With no engine installed, or during a Lichess game, one compact
 * row says so in the engine row's place.
 */
export function EngineStatusPanel({
  onOpenSettings,
  onStartAnalysis,
  onStopAnalysis
}: {
  onOpenSettings?: () => void;
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
}) {
  const onlineGame = useLichessStore(selectLiveGameInProgress);
  const noEngines = useNoEngines();
  return (
    <section
      aria-label="Engine"
      className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-2.5 border-b border-line-subtle px-3 pt-3 pb-2.5"
    >
      {onlineGame ? (
        <EngineNoticeRow tile={<Lock />} title={LICHESS_LOCK_TITLE} text={LICHESS_LOCK_TEXT} />
      ) : noEngines ? (
        <EngineNoticeRow
          tile={<Download />}
          dashed
          title={NO_ENGINE_TITLE}
          text={NO_ENGINE_TEXT}
          action={
            onOpenSettings ? (
              <Button type="button" variant="primary" size="sm" onClick={onOpenSettings}>
                <Settings />
                Open Settings
              </Button>
            ) : null
          }
        />
      ) : (
        <BoardEngine onStartAnalysis={onStartAnalysis} onStopAnalysis={onStopAnalysis} />
      )}
    </section>
  );
}

/** A compact row in the engine row's place: a tile, a title and the sentence saying why, and an action. */
function EngineNoticeRow({
  tile,
  dashed = false,
  title,
  text,
  action = null
}: {
  tile: ReactNode;
  /** An empty slot (nothing installed) rather than a filled tile. */
  dashed?: boolean;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[10px] text-fg-muted [&_svg]:size-4.5",
          dashed ? "border-[1.5px] border-dashed border-line-strong" : "bg-control"
        )}
      >
        {tile}
      </span>
      <div className="grid min-w-0 flex-1 gap-px">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="text-xs leading-[1.4] text-fg-subtle">{text}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * The position the engine block's lines belong to: the board's, or while paused the paused one
 * (the board may have moved on since): their moves, previews and picks are read from there.
 */
function useLinesPosition(
  board: EnginePanelPosition,
  paused: PausedAnalysis | null
): EnginePanelPosition {
  return useMemo(
    () => (paused ? { ...board, fen: paused.fen, nodeId: paused.nodeId } : board),
    [board, paused]
  );
}

/**
 * The engine an engine panel names (see rowEngine): an engine game's opponent, else the analysis
 * engine chosen now, so picking another in Analysis settings shows at once.
 */
function useRowEngine(engineGame: boolean): EngineConfig | null {
  const settings = useAnalysisSettings();
  const engines = useEnginesQuery();
  const activeEngineId = useAnalysisStore((state) => state.activeEngineId);
  return rowEngine({ engines: engines.data, settings, activeEngineId, engineGame });
}

/** The board's engine row and, while it runs or is paused, its stats and lines. */
function BoardEngine({
  onStartAnalysis,
  onStopAnalysis
}: {
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
}) {
  const board = useBoardEnginePosition();
  const readout = useEngineReadout();
  const { status, topLines, error } = readout;
  const { analysing, engineGame } = board;
  // Switched off with lines found: they stay, frozen (see the analysis store's paused).
  const paused = useAnalysisStore((state) => (analysing || engineGame ? null : state.paused));
  const position = useLinesPosition(board, paused);
  const { fen } = position;
  const analysisSettings = useAnalysisSettings();
  // The switch is off with nothing paused and no engine game holds the engine: only the row shows.
  const off = !analysing && !engineGame && !paused;
  // An engine game still being played: its opponent's search is the answer, so none of it shows.
  const gameOn = useGameStore((state) => engineHolder(state, false) === "engine-game");
  const engine = useRowEngine(engineGame);
  const interactions = useLineInteractions(fen);
  const { primary, bestSan } = usePrincipalLine(fen, readout);
  const failed = status === "error";
  // An engine game asks for one line; live analysis for as many as its settings say.
  const reservedLines = engineGame ? 1 : analysisSettings.analysisLines;
  const restart = useRestart(analysing, paused !== null, onStartAnalysis);

  return (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <EngineHeading engine={engine} failed={failed}>
          <BoardEngineStatus
            status={status}
            analysing={analysing}
            off={off}
            paused={paused ? pausedLabel(paused, board, primary) : null}
            depth={primary?.depth}
          />
        </EngineHeading>
        <div className="flex shrink-0 items-center gap-2">
          {/* An engine that stopped with an error runs no search: Restart is the way on. */}
          {restart ? (
            <IconButton
              label={restartLabel(status)}
              icon={<RotateCcw />}
              size="icon-xs"
              onClick={restart}
            />
          ) : null}
          <AnalysisSwitch onStart={onStartAnalysis} onStop={onStopAnalysis} />
        </div>
      </div>
      {error ? (
        <Notice tone="danger" title="The engine stopped with an error">
          {error}
        </Notice>
      ) : null}
      {off || gameOn ? null : (
        <div className={cn("grid gap-2.5", failed && "opacity-45")}>
          <EngineStats
            primary={primary}
            fen={fen}
            depthTarget={
              (analysing || paused) && analysisSettings.analysisLimit === "depth"
                ? analysisSettings.analysisDepth
                : null
            }
            bestSan={bestSan}
          />
          <EngineLines
            position={position}
            lines={topLines}
            reserved={reservedLines}
            compact={false}
            interactions={interactions}
          />
        </div>
      )}
    </>
  );
}

/**
 * Restart: while live analysis runs, a fresh search; while paused, the board's position searched
 * from scratch, analysis on again (null: neither, or nothing to switch analysis on with). Both
 * store updates land before the engine driver's next sync (it runs once, after the current task),
 * so it starts one fresh search whatever their order.
 */
function useRestart(
  analysing: boolean,
  paused: boolean,
  onStartAnalysis: (() => void) | undefined
): (() => void) | null {
  const restartFresh = useAnalysisStore((state) => state.restartFresh);
  if (analysing) return restartFresh;
  if (!paused || !onStartAnalysis) return null;
  return () => {
    onStartAnalysis();
    restartFresh();
  };
}

/** The engine row's image and name over its status (`children`), in red once it failed. */
function EngineHeading({
  engine,
  failed,
  children
}: {
  engine: EngineConfig | null;
  failed: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <EngineAvatar engine={engine} size="lg" />
      <div className="grid min-w-0 flex-1 gap-px">
        <h3 className="truncate text-[0.9375rem] font-semibold text-fg">
          {engine ? engineDisplayName(engine.name) : "Engine"}
        </h3>
        <p
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-xs",
            failed ? "text-danger" : "text-fg-subtle"
          )}
        >
          {children}
        </p>
      </div>
    </>
  );
}

/** The paused lines' status: where they were found, against the board's position now. */
function pausedLabel(
  paused: PausedAnalysis,
  board: EnginePanelPosition,
  primary: EngineInfo | null | undefined
): string {
  return pausedStatusLabel(
    paused,
    onPausedPosition(paused, { currentNodeId: board.nodeId, currentFen: board.fen }),
    primary?.depth
  );
}

/**
 * The engine row's status: an error, paused (`paused`, its label), off, or what the search does.
 */
function BoardEngineStatus({
  status,
  analysing,
  off,
  paused,
  depth
}: {
  status: EngineStatus;
  analysing: boolean;
  off: boolean;
  paused: string | null;
  depth: number | undefined;
}) {
  if (status === "error")
    return (
      <>
        <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">The engine stopped with an error</span>
      </>
    );
  if (paused !== null) return paused;
  if (off) return "Off";
  if (analysing && status === "ready") return `Finished at depth ${depth ?? "–"}`;
  if (analysing)
    return (
      <>
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_rgb(143_182_111/0.2)] motion-safe:animate-pulse"
        />
        Analysing
      </>
    );
  return ENGINE_STATUS_WORDS[status];
}

/**
 * The engine's Depth (and the depth it searches to) / Score / Best strip, from the principal line
 * searched in `fen`.
 */
function EngineStats({
  primary,
  fen,
  depthTarget,
  bestSan
}: {
  primary: EngineInfo | null | undefined;
  fen: string;
  depthTarget: number | null;
  bestSan: string | null;
}) {
  const pieceSet = usePieceSetClass();
  return (
    // The board's piece set, so the best move's figurine is the board's piece.
    <StatStrip className={cn("grid-cols-3", pieceSet)} style={FIGURINE_GRID_STYLE}>
      <StatCell label="Depth">
        {primary?.depth ?? "–"}
        {depthTarget ? (
          <span className="ml-0.5 text-xs font-medium text-fg-subtle">/{depthTarget}</span>
        ) : null}
      </StatCell>
      <StatCell label="Score">
        {primary?.score ? formatScore(whiteScore(primary.score, fen), 2) : "–"}
      </StatCell>
      <StatCell label="Best">
        {bestSan ? (
          // Read out (and found) as its SAN; the figurine is decorative.
          <>
            <span className="sr-only">{bestSan}</span>
            <span aria-hidden="true">
              <FigurineSan san={bestSan} />
            </span>
          </>
        ) : (
          "–"
        )}
      </StatCell>
    </StatStrip>
  );
}
const FIGURINE_GRID_STYLE = { display: "grid", containerType: "normal" } as const;

/**
 * The Analysis switch: on while live analysis runs (the game store's analysis mode, which the
 * engine driver searches), so it always says what the engine is doing. Disabled while the board
 * can't be analysed (a game being played, a finished position).
 */
function AnalysisSwitch({ onStart, onStop }: { onStart?: () => void; onStop?: () => void }) {
  const on = useGameStore((state) => state.mode === "analysis");
  return (
    <Switch
      checked={on}
      disabled={on ? !onStop : !onStart}
      aria-label="Analysis"
      onCheckedChange={(next) => (next ? onStart?.() : onStop?.())}
    />
  );
}
