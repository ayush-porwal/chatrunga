import { Fragment, memo, useCallback, useMemo, useState } from "react";
import { Cpu, Lock, Play, Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { formatScore } from "../game-review/review-score";
import { MoveLink, type GoToLine } from "../game-review/MoveLinks";
import { ReviewBoard } from "../game-review/ReviewBoard";
import { numberedLine, uciLineSteps, uciLineToSan } from "../game-review/review-utils";
import { useGameStore } from "../../stores/game-store";
import type { EngineInfo, EngineStatus } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useEnginesQuery } from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { analysisEngineFor } from "./analysis-engine";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
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
  onGoToLine,
  onPreview
}: {
  index: number;
  line: EngineInfo | null;
  fen: string;
  nodeId: string;
  onGoToLine?: GoToLine;
  /** A move of this line is hovered or focused (its position shows below the lines). */
  onPreview?: (target: PreviewTarget) => void;
}) {
  const steps = useMemo(() => (line?.pv?.length ? uciLineSteps(fen, line.pv.slice(0, 10)) : []), [fen, line]);
  const sans = useMemo(() => steps.map((step) => step.san), [steps]);
  const score = line?.score ? formatScore(line.score, 2) : null;
  const multipv = line?.multipv ?? index + 1;
  return (
    <li className="grid h-8 grid-cols-[1rem_3.5rem_minmax(0,1fr)] items-center gap-2 font-mono text-xs tabular-nums">
      <span className="text-2xs text-fg-subtle">{line?.multipv ?? index + 1}</span>
      <span className="font-medium text-fg">{score ?? "–"}</span>
      <span className="min-w-0 truncate text-fg-muted">
        {steps.length
          ? steps.map((step, moveIndex) => (
              <Fragment key={`${moveIndex}-${step.san}`}>
                {moveIndex ? " " : null}
                <span
                  onPointerEnter={() => onPreview?.({ multipv, moveIndex })}
                  onFocus={() => onPreview?.({ multipv, moveIndex })}
                >
                  {onGoToLine ? (
                    <MoveLink
                      san={step.san}
                      className="text-current hover:text-accent"
                      onActivate={() => onGoToLine({ startNodeId: nodeId, moves: sans.slice(0, moveIndex + 1) })}
                    />
                  ) : (
                    <span tabIndex={0} className="rounded-[3px] outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50">
                      {step.san}
                    </span>
                  )}
                </span>
              </Fragment>
            ))
          : "–"}
      </span>
    </li>
  );
});

/**
 * Which engine live analysis uses (every installed, usable engine; Maia ones say so). Changing it
 * while analysing restarts the search with the new engine; the choice is kept for later boards.
 */
function AnalysisEngineSelect({ className }: { className?: string }) {
  const engines = useEnginesQuery();
  const chosen = useAnalysisStore((state) => state.analysisEngineId);
  const choose = useAnalysisStore((state) => state.chooseAnalysisEngine);
  const usable = (engines.data ?? []).filter((engine) => engine.isAvailable);
  const value = analysisEngineFor(usable, chosen);
  if (!usable.length || !value) return null;
  return (
    <Select
      aria-label="Analysis engine"
      value={value}
      onChange={(event) => choose(event.target.value)}
      className={cn("h-8 text-xs", className)}
    >
      {usable.map((engine) => (
        <option key={engine.id} value={engine.id}>
          {engine.name}
          {engine.isHumanPrediction ? " · human-like" : ""}
        </option>
      ))}
    </Select>
  );
}

/** The move of an engine line being hovered or focused: the position after it, shown below the lines. */
type LinePreview = { fenAfter: string; uci: string; label: string; score: string | null };
/** Which move is hovered: line (MultiPV number) and move index, so an updated line updates the preview. */
type PreviewTarget = { multipv: number; moveIndex: number };

/** The preview for `target` from the lines as they are now; null once that move is gone. */
function previewFor(fen: string, lines: readonly EngineInfo[], target: PreviewTarget): LinePreview | null {
  const line = lines.find((candidate) => (candidate.multipv ?? 1) === target.multipv);
  if (!line?.pv?.length) return null;
  const steps = uciLineSteps(fen, line.pv.slice(0, 10));
  const step = steps[target.moveIndex];
  if (!step) return null;
  return {
    fenAfter: step.fenAfter,
    uci: step.uci,
    label: numberedLine(fen, steps.slice(0, target.moveIndex + 1).map((item) => item.san)),
    score: line.score ? formatScore(line.score, 2) : null
  };
}

/**
 * A roomy board under the lines with the position after the move being hovered (or focused), the
 * line up to it and the line's score. Below the lines, it never covers the moves being read.
 */
function LinePreviewCard({ preview }: { preview: LinePreview }) {
  const orientation = useGameStore((state) => state.orientation);
  return (
    <div className="grid animate-fade-in gap-3 rounded-xl border border-line-subtle bg-surface-raised/40 p-3" aria-live="polite">
      <ReviewBoard
        fen={preview.fenAfter}
        orientation={orientation}
        lastMove={[preview.uci.slice(0, 2), preview.uci.slice(2, 4)]}
        className="aspect-square w-full max-w-md justify-self-center"
      />
      <div className="grid gap-1">
        <p className="font-mono text-sm leading-6 text-fg">{preview.label}</p>
        {preview.score ? (
          <p className="text-xs text-fg-muted">
            Line score <span className="font-mono text-fg-secondary">{preview.score}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

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
  // Live analysis (not an engine game's opponent): the engine can be switched from the header.
  const analysing = useGameStore((state) => state.mode === "analysis");
  // The hovered line move, for the position it was hovered in (a new position drops it). The card
  // reads that line as it is now, so a line the engine updates under the pointer updates too.
  const [hovered, setHovered] = useState<{ fen: string; target: PreviewTarget } | null>(null);
  const setPreview = useCallback((target: PreviewTarget) => setHovered({ fen, target }), [fen]);
  const clearPreview = useCallback(() => setHovered(null), []);
  const preview = useMemo(
    () => (hovered && hovered.fen === fen ? previewFor(fen, topLines, hovered.target) : null),
    [hovered, fen, topLines]
  );
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
          {analysing ? (
            <AnalysisEngineSelect className="w-56 max-w-full" />
          ) : (
            <span className="truncate text-xs text-fg-muted">{engineName}</span>
          )}
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
              <ol
                className="divide-y divide-line-subtle"
                onPointerLeave={clearPreview}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearPreview();
                }}
              >
                {linesWithPlaceholders(topLines).map((line, index) => (
                  <EngineLineRow
                    key={line?.multipv ?? `empty-${index}`}
                    index={index}
                    line={line}
                    fen={fen}
                    nodeId={nodeId}
                    onGoToLine={linesNavigable ? goToLine : undefined}
                    onPreview={setPreview}
                  />
                ))}
              </ol>
              {preview ? <LinePreviewCard preview={preview} /> : null}
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
          description={onStartAnalysis ? "Choose an engine and analyze the current position." : undefined}
          action={
            onStartAnalysis ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <AnalysisEngineSelect className="w-56" />
                <Button type="button" variant="primary" size="sm" onClick={onStartAnalysis}>
                  <Play />
                  Start analysis
                </Button>
              </div>
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
