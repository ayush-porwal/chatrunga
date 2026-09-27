import { memo, useMemo } from "react";
import { Cpu, Lock, Play, Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { formatScore } from "../game-review/review-score";
import { MoveLine, type GoToLine } from "../game-review/MoveLinks";
import { uciLineToSan } from "../game-review/review-utils";
import { useGameStore } from "../../stores/game-store";
import type { EngineInfo, EngineStatus } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useEnginesQuery } from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Eyebrow } from "@/components/ui/page";
import { Stat, StatGroup } from "@/components/ui/stat";

/** Live analysis asks for three lines; show that many rows from the first line on. */
const RESERVED_LINES = 3;

function linesWithPlaceholders(lines: readonly EngineInfo[]): Array<EngineInfo | null> {
  const shown: Array<EngineInfo | null> = lines.slice(0, 5);
  while (shown.length < RESERVED_LINES) shown.push(null);
  return shown;
}

/**
 * One principal variation in SAN (like every other move in the app): fixed columns, tabular digits,
 * single line — no reflow as it updates. Each move jumps the board there when `onGoToLine` is set.
 * A line that does not fit the position (the engine has not caught up with a new move yet) shows
 * as a dash rather than raw UCI.
 */
const EngineLineRow = memo(function EngineLineRow({
  index,
  line,
  fen,
  nodeId,
  onGoToLine
}: {
  index: number;
  line: EngineInfo | null;
  fen: string;
  nodeId: string;
  onGoToLine?: GoToLine;
}) {
  const sans = useMemo(() => (line?.pv?.length ? uciLineToSan(fen, line.pv.slice(0, 10)) : []), [fen, line]);
  return (
    <li className="grid h-8 grid-cols-[1rem_3.5rem_minmax(0,1fr)] items-center gap-2 font-mono text-xs tabular-nums">
      <span className="text-2xs text-fg-subtle">{line?.multipv ?? index + 1}</span>
      <span className="font-medium text-fg">{line?.score ? formatScore(line.score, 2) : "–"}</span>
      <span className="min-w-0 truncate text-fg-muted" title={sans.join(" ") || undefined}>
        <MoveLine startNodeId={nodeId} sans={sans} onGoToLine={onGoToLine} empty="–" linkClassName="text-current hover:text-accent" />
      </span>
    </li>
  );
});

const goToLine: GoToLine = (target) => {
  useGameStore.getState().goToLine(target.startNodeId, target.moves);
};

const statusLabel: Record<EngineStatus, string> = {
  idle: "Idle",
  starting: "Starting",
  ready: "Ready",
  thinking: "Thinking",
  error: "Error"
};

const statusTone: Record<EngineStatus, "neutral" | "accent" | "danger"> = {
  idle: "neutral",
  starting: "neutral",
  ready: "neutral",
  thinking: "accent",
  error: "danger"
};

/**
 * Workspace "Engine" tab: live search stats and principal variations (flat — the panel is the card).
 * Locked while a Lichess game is being played: outside help is against Lichess's fair-play rules.
 */
export function EngineStatusPanel(props: { onStartAnalysis?: () => void; onOpenSettings?: () => void }) {
  const onlineGame = useLichessStore(selectLiveGameInProgress);
  if (onlineGame) {
    return (
      <Notice tone="info" icon={<Lock />} title="Engine off during your Lichess game">
        Lichess doesn’t allow outside help while a game is on. The engine, Maia and the coach are back for the review
        once it ends.
      </Notice>
    );
  }
  return <EngineStatusPanelContent {...props} />;
}

function EngineStatusPanelContent({
  onStartAnalysis,
  onOpenSettings
}: {
  /** Shown as the idle empty-state action ("Start analysis"). Omit to hide the action. */
  onStartAnalysis?: () => void;
  /** Offered when no engine is installed (the way to get one). */
  onOpenSettings?: () => void;
}) {
  // Only what this panel shows (engine info arrives throttled, ~6 updates a second at most).
  const { status, latestInfo, topLines, bestMove, error, activeEngineId } = useAnalysisStore(
    useShallow((state) => ({
      status: state.status,
      latestInfo: state.latestInfo,
      topLines: state.topLines,
      bestMove: state.bestMove,
      error: state.error,
      activeEngineId: state.activeEngineId
    }))
  );
  const fen = useGameStore((state) => state.currentFen);
  const nodeId = useGameStore((state) => state.currentNodeId);
  // During a live engine match lines are read-only (the game store refuses new branches then).
  const linesNavigable = useGameStore((state) => state.mode !== "engine" || !state.engineSide || Boolean(state.gameOutcome));
  const engines = useEnginesQuery();
  const engineName = engines.data?.find((engine) => engine.id === activeEngineId)?.name ?? null;
  // With MultiPV the latest info can be line 2/3 — read depth/score/best from the principal line.
  const primary = topLines.find((line) => (line.multipv ?? 1) === 1) ?? latestInfo;
  const best = bestMove ?? primary?.pv?.[0] ?? null;
  const bestSan = useMemo(() => (best ? (uciLineToSan(fen, [best])[0] ?? null) : null), [best, fen]);
  const hasData = Boolean(latestInfo || topLines.length || best);
  const idle = status === "idle" || status === "error";
  // Nothing to analyse with: say so and point to Settings instead of an error with no way out.
  const noEngines = engines.isSuccess && !engines.data.some((engine) => engine.isAvailable && !engine.isHumanPrediction);

  return (
    <section className="grid content-start gap-4">
      {hasData || !idle ? (
        // The tab above already says "Engine": the header names the running engine and its state.
        <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
          <span className="truncate text-xs text-fg-muted">{engineName}</span>
          <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
        </div>
      ) : null}
      {hasData ? (
        <>
          <StatGroup>
            <Stat label="Depth" value={primary?.depth ?? "–"} mono />
            <Stat label="Score" value={primary?.score ? formatScore(primary.score, 2) : "–"} mono />
            <Stat label="Best" value={bestSan ?? "–"} mono />
          </StatGroup>
          {topLines.length ? (
            <div className="grid gap-1">
              <Eyebrow>Lines</Eyebrow>
              {/* Rows are reserved up to the MultiPV count so lines arriving never push content down. */}
              <ol className="divide-y divide-line-subtle">
                {linesWithPlaceholders(topLines).map((line, index) => (
                  <EngineLineRow
                    key={line?.multipv ?? `empty-${index}`}
                    index={index}
                    line={line}
                    fen={fen}
                    nodeId={nodeId}
                    onGoToLine={linesNavigable ? goToLine : undefined}
                  />
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : idle && noEngines ? (
        <EmptyState
          icon={<Cpu />}
          title="No engine installed"
          description="Download Stockfish or add a UCI engine you already have."
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
      ) : idle ? (
        <EmptyState
          icon={<Cpu />}
          title="Engine is idle"
          description={onStartAnalysis ? "Analyze the current position." : undefined}
          action={
            onStartAnalysis ? (
              <Button type="button" variant="primary" size="sm" onClick={onStartAnalysis}>
                <Play />
                Start analysis
              </Button>
            ) : undefined
          }
          className="py-6"
        />
      ) : (
        <EmptyState
          compact
          title={status === "starting" ? "Starting engine…" : status === "thinking" ? "Thinking…" : "No analysis yet."}
        />
      )}
      {error && !(idle && noEngines) ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}
