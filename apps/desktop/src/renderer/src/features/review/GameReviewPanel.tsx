import { useMemo, useRef, useEffect } from "react";
import { LineChart as LineChartIcon, Search, StopCircle, Target } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  reviewLabel,
  scoreToCentipawns,
  formatEngineScore
} from "@chaturanga/shared/chess/review";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  AnalysisLine,
  GameReview,
  MoveReview,
  ReviewProgress
} from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { useEnginesQuery } from "../../queries/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classificationClass, panel, tagClass, stripClass, error as errorClass } from "@/lib/ui";

const evalLimit = 1000;
type PercentageStep =
  | "0"
  | "5"
  | "10"
  | "15"
  | "20"
  | "25"
  | "30"
  | "35"
  | "40"
  | "45"
  | "50"
  | "55"
  | "60"
  | "65"
  | "70"
  | "75"
  | "80"
  | "85"
  | "90"
  | "95"
  | "100";

const widthByPercent: Record<PercentageStep, string> = {
  "0": "w-[0%]",
  "5": "w-[5%]",
  "10": "w-[10%]",
  "15": "w-[15%]",
  "20": "w-[20%]",
  "25": "w-[25%]",
  "30": "w-[30%]",
  "35": "w-[35%]",
  "40": "w-[40%]",
  "45": "w-[45%]",
  "50": "w-[50%]",
  "55": "w-[55%]",
  "60": "w-[60%]",
  "65": "w-[65%]",
  "70": "w-[70%]",
  "75": "w-[75%]",
  "80": "w-[80%]",
  "85": "w-[85%]",
  "90": "w-[90%]",
  "95": "w-[95%]",
  "100": "w-full"
};

const heightByPercent: Record<PercentageStep, string> = {
  "0": "h-[0%]",
  "5": "h-[5%]",
  "10": "h-[10%]",
  "15": "h-[15%]",
  "20": "h-[20%]",
  "25": "h-[25%]",
  "30": "h-[30%]",
  "35": "h-[35%]",
  "40": "h-[40%]",
  "45": "h-[45%]",
  "50": "h-[50%]",
  "55": "h-[55%]",
  "60": "h-[60%]",
  "65": "h-[65%]",
  "70": "h-[70%]",
  "75": "h-[75%]",
  "80": "h-[80%]",
  "85": "h-[85%]",
  "90": "h-[90%]",
  "95": "h-[95%]",
  "100": "h-full"
};

function percentStep(value: number): PercentageStep {
  const normalized = Math.max(0, Math.min(100, value));
  return String(Math.round(normalized / 5) * 5) as PercentageStep;
}

export function GameReviewPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const engines = useEnginesQuery();
  const moveTree = useGameStore((state) => state.moveTree);
  const rootFen = useGameStore((state) => state.rootFen);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const selectedNodeId = useReviewStore((state) => state.selectedNodeId);
  const status = useReviewStore((state) => state.status);
  const review = useReviewStore((state) => state.review);
  const partialMoves = useReviewStore((state) => state.partialMoves);
  const progress = useReviewStore((state) => state.progress);
  const reviewError = useReviewStore((state) => state.error);
  const reviewMoves = useMemo(() => mainlineReviewInput(moveTree), [moveTree]);
  const defaultEngine = useMemo(
    () => engines.data?.find((engine) => engine.isDefault) ?? engines.data?.[0] ?? null,
    [engines.data]
  );

  const liveReview = useMemo<GameReview | null>(() => {
    if (review) return review;
    if (partialMoves.length === 0) return null;
    return {
      engineId: "",
      depth: null,
      moveTimeMs: null,
      createdAt: 0,
      summary: {
        totalMoves: partialMoves.length,
        best: 0,
        excellent: 0,
        good: 0,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
        missedTactics: 0,
        averageCentipawnLoss: null
      },
      moves: partialMoves
    };
  }, [review, partialMoves]);

  const selectedMove =
    liveReview?.moves.find((move) => move.nodeId === currentNodeId) ??
    liveReview?.moves.find((move) => move.nodeId === selectedNodeId) ??
    liveReview?.moves.find((move) =>
      ["missed_tactic", "blunder", "mistake"].includes(move.classification)
    ) ??
    liveReview?.moves[0] ??
    null;

  async function runReview() {
    if (!window.chaturanga) {
      useReviewStore.getState().setError("Game review requires the desktop app.");
      return;
    }
    const engineId = useAnalysisStore.getState().activeEngineId ?? defaultEngine?.id;
    if (!engineId) {
      onOpenSettings();
      return;
    }
    if (!reviewMoves.length) return;
    const reviewId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `review-${Date.now()}`;
    useReviewStore.getState().startReview(reviewId);
    try {
      await window.chaturanga.engines.reviewGame({
        reviewId,
        engineId,
        rootFen,
        moves: reviewMoves,
        multipv: 3
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "Review cancelled") {
        useReviewStore.getState().setError(message);
      }
    }
  }

  async function stopReview() {
    const reviewId = useReviewStore.getState().reviewId;
    if (!reviewId || !window.chaturanga) return;
    await window.chaturanga.engines.cancelReview(reviewId);
  }

  return (
    <div className={cn(panel, "grid w-full min-w-0 gap-2.5 p-[13px]")}>
      <div className="flex min-h-[34px] items-center justify-between gap-2.5">
        <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Review</h2>
        {status === "running" ? (
          <Button type="button" variant="outline" size="sm" onClick={stopReview} title="Stop review">
            <StopCircle size={16} />
            Stop
          </Button>
        ) : reviewMoves.length ? (
          <Button type="button" variant="outline" size="sm" onClick={runReview}>
            <Search size={16} />
            {status === "ready" ? "Review Again" : "Review Game"}
          </Button>
        ) : null}
      </div>

      {status === "running" ? (
        <RunningReview
          progress={progress}
          partialMoves={partialMoves}
          totalMoves={reviewMoves.length}
        />
      ) : null}

      {liveReview ? (
        <>
          <ReviewSummary review={liveReview} partial={!review} />
          <MoveQualityStrip review={liveReview} />
          <EvaluationChart review={liveReview} />
          <AdvantageTimeline review={liveReview} />
          <TimeUsageChart review={liveReview} />
          <ReviewMoveDetails move={selectedMove} />
          <TacticsList review={liveReview} />
        </>
      ) : status === "idle" || status === "cancelled" ? (
        <ReviewEmptyState status={status} onRun={runReview} disabled={!reviewMoves.length} />
      ) : null}

      {reviewError ? <p className={errorClass} aria-live="polite">{reviewError}</p> : null}
    </div>
  );
}

function useNavigateToNode() {
  const goToNode = useGameStore((state) => state.goToNode);
  return (nodeId: string) => {
    useReviewStore.getState().setSelectedNode(nodeId);
    goToNode(nodeId);
  };
}

function ReviewEmptyState({
  status,
  onRun,
  disabled
}: {
  status: "idle" | "cancelled";
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-[#303030] bg-[#202020] bg-gradient-to-br from-[#5c8bd6]/10 to-transparent p-3.5">
      <strong className="text-[15px] text-[#f3f3f3]">{status === "cancelled" ? "Review Cancelled" : "No Game To Review Yet"}</strong>
      <p className="m-0 text-[12.5px] leading-snug text-[#a9a9a9]">
        {status === "cancelled"
          ? "Run it again when you want a complete chart and critical-move list."
          : "Make a move or import a PGN, then review will surface the critical moments and engine ideas."}
      </p>
      {!disabled ? (
        <Button type="button" variant="secondary" className="justify-self-start" onClick={onRun}>
          <Search size={16} />
          Start Review
        </Button>
      ) : null}
    </div>
  );
}

function RunningReview({
  progress,
  partialMoves,
  totalMoves
}: {
  progress: ReviewProgress | null;
  partialMoves: MoveReview[];
  totalMoves: number;
}) {
  const completed = partialMoves.length;
  const current = progress
    ? Math.min(progress.moveIndex + 1, progress.totalMoves || totalMoves || 1)
    : Math.max(completed, 0);
  const total = progress?.totalMoves || totalMoves || 1;
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const score = progress?.lines[0]?.scoreWhite ?? null;
  return (
    <div className="grid gap-2 rounded-lg border border-[#3a4a5a] bg-gradient-to-b from-[#1f2731] to-[#1a1f27] p-3" aria-live="polite">
      <div className="flex items-center justify-between text-[13px] text-[#cbd5e1]">
        <span>
          Analyzing <strong>{current}</strong> / {total}
          {progress ? (
            <em className="ml-2 text-[11px] not-italic text-[#93a4b8]">
              {progress.phase === "before" ? "best reply" : "after move"} · depth{" "}
              {progress.depth || "-"}
            </em>
          ) : null}
        </span>
        <strong className="text-base text-[#f3f6fb]">{formatEngineScore(score)}</strong>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded bg-[#2a323d]" aria-hidden>
        <div className={cn("h-full bg-gradient-to-r from-[#5c8bd6] to-[#6cd1a5] transition-[width]", widthByPercent[percentStep(percent)])} />
      </div>
      {progress?.san ? (
        <div className="flex items-baseline gap-2 text-xs text-[#bfcad6]">
          <span>Move</span>
          <strong className="text-sm text-white">{moveNumberPrefix(progress.ply)}{progress.san}</strong>
          <em className="text-[11px] not-italic text-[#8b97a4]">{progress.mover === "white" ? "white to move" : "black to move"}</em>
        </div>
      ) : null}
      {progress?.lines.length ? (
        <ol className="grid gap-1">
          {progress.lines.slice(0, 3).map((line, index) => (
            <li key={`${line.multipv}-${index}`} className="grid grid-cols-[18px_56px_1fr] items-baseline gap-1.5 font-mono text-xs text-[#d9e0e8]">
              <span className={cn("inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#2a313b] text-[10px] font-bold text-[#c5cdd6]", index === 0 && "bg-[#2b6a44] text-[#e7fff1]", index === 1 && "bg-[#2c4f7a] text-[#e2efff]", index === 2 && "bg-[#6f5a26] text-[#fff3cb]")}>{line.multipv}</span>
              <strong className="text-white">{formatEngineScore(line.scoreWhite)}</strong>
              <p className="m-0 truncate text-[#aab4be]">
                {progress.fen
                  ? toSanLine(progress.fen, line.pv.slice(0, 8)).join(" ") || "-"
                  : line.pv.slice(0, 8).join(" ") || "-"}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ReviewSummary({ review, partial }: { review: GameReview; partial: boolean }) {
  const summary = useMemo(() => computeSummary(review.moves), [review.moves]);
  const insights = useMemo(() => computeInsights(review.moves), [review.moves]);
  const navigate = useNavigateToNode();
  return (
    <div className="grid gap-2">
      <div className="grid min-h-[92px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-3 rounded-lg border border-white/10 bg-[#171a1d] bg-gradient-to-br from-[#8fb66f]/20 to-transparent p-3.5">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[#bfc8d0]">{partial ? "Live Accuracy" : "Game Accuracy"}</span>
        <strong className="row-span-2 text-[42px] leading-none text-[#fbfff5] tabular-nums">{formatAccuracy(insights.accuracy)}</strong>
        <em className="text-xs not-italic text-[#9facba]">{summary.totalMoves} moves reviewed{partial ? " so far" : ""}</em>
        <small className="col-start-2 justify-self-end text-xs text-[#9eb4a9]">/100</small>
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-[#171a1d]" aria-label="Accuracy by side">
        <span className="flex items-center justify-between gap-2 px-3 py-2">
          <em className="text-[11.5px] not-italic text-[#9f9f9f]">White</em>
        <strong className="text-lg text-[#f0f0f0] tabular-nums">{formatAccuracy(insights.whiteAccuracy)}</strong>
        </span>
        <span className="flex items-center justify-between gap-2 border-l border-white/10 px-3 py-2">
          <em className="text-[11.5px] not-italic text-[#9f9f9f]">Black</em>
        <strong className="text-lg text-[#f0f0f0] tabular-nums">{formatAccuracy(insights.blackAccuracy)}</strong>
        </span>
      </div>
      <button
        type="button"
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-lg border border-white/10 bg-[#171a1d] px-3 py-2 text-left disabled:opacity-60 enabled:hover:border-[#4b6385] enabled:hover:bg-[#222936]"
        disabled={!insights.turningPoint}
        onClick={() => {
          if (insights.turningPoint) navigate(insights.turningPoint.nodeId);
        }}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[#bfc8d0]">Turning Point</span>
        <strong className="col-start-1 text-sm text-[#f0f0f0]">
          {insights.turningPoint
            ? `${moveNumberPrefix(insights.turningPoint.ply)}${insights.turningPoint.san}`
            : "-"}
        </strong>
        <em className="row-span-2 max-w-[140px] self-center text-right text-[11.5px] not-italic text-[#9f9f9f]">
          {insights.turningPoint?.evalLoss !== null && insights.turningPoint
            ? `${reviewLabel(insights.turningPoint.classification)} · ${insights.turningPoint.evalLoss} cp`
            : "No clear swing yet"}
        </em>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <span className="flex min-w-0 flex-col gap-0.5 rounded-[7px] border border-white/10 bg-[#171a1d] p-2 text-[11px] text-[#a8a8a8]">
          <strong className="text-[17px] text-[#ff9c91]">{summary.missedTactics}</strong>
          Missed Tactics
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 rounded-[7px] border border-white/10 bg-[#171a1d] p-2 text-[11px] text-[#a8a8a8]">
          <strong className="text-[17px] text-[#ff9c91]">{summary.blunders}</strong>
          Blunders
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 rounded-[7px] border border-white/10 bg-[#171a1d] p-2 text-[11px] text-[#a8a8a8]">
          <strong className="text-[17px] text-[#ffba85]">{summary.mistakes}</strong>
          Mistakes
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 rounded-[7px] border border-white/10 bg-[#171a1d] p-2 text-[11px] text-[#a8a8a8]">
          <strong className="text-[17px] text-[#ffe082]">{summary.inaccuracies}</strong>
          Inaccuracies
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 rounded-[7px] border border-white/10 bg-[#171a1d] p-2 text-[11px] text-[#a8a8a8]">
          <strong className="text-[17px] text-[#8fe1b6]">{summary.best + summary.excellent}</strong>
          Best Moves
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 rounded-[7px] border border-white/10 bg-[#171a1d] p-2 text-[11px] text-[#a8a8a8]">
          <strong className="text-[17px] text-[#f1f1f1]">{summary.averageCentipawnLoss ?? "-"}</strong>
          Avg Loss
        </span>
      </div>
    </div>
  );
}

function MoveQualityStrip({ review }: { review: GameReview }) {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const navigate = useNavigateToNode();
  if (!review.moves.length) return null;
  return (
    <div className="grid gap-2 rounded-lg border border-white/10 bg-[#171a1d] p-2.5" aria-label="Move quality timeline">
      <div className="flex items-center justify-between text-xs text-[#cfcfcf]">
        <span>Move Quality</span>
        <em className="text-[11.5px] not-italic text-[#9f9f9f]">{review.moves.length} moves</em>
      </div>
      <div className="grid min-h-[34px] grid-flow-col auto-cols-fr gap-0.5">
        {review.moves.map((move) => (
          <button
            key={move.nodeId}
            type="button"
            className={cn("min-w-0 rounded-[3px] border-0 p-0", stripClass(move.classification), move.nodeId === currentNodeId && "z-10 shadow-[0_0_0_2px_#fff,0_0_0_4px_rgb(255_255_255/0.15)]")}
            aria-label={`${moveNumberPrefix(move.ply)}${move.san}: ${reviewLabel(move.classification)}`}
            title={`${moveNumberPrefix(move.ply)}${move.san}: ${reviewLabel(move.classification)}`}
            onClick={() => navigate(move.nodeId)}
          />
        ))}
      </div>
    </div>
  );
}

function EvaluationChart({ review }: { review: GameReview }) {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const navigate = useNavigateToNode();
  const chartData = useMemo(() => {
    return review.moves.map((move, index) => {
      const cp = move.evalAfter ? clamp(scoreToCentipawns(move.evalAfter), -evalLimit, evalLimit) : 0;
      return {
        index,
        cp,
        nodeId: move.nodeId,
        san: move.san,
        ply: move.ply,
        classification: move.classification,
        evalAfter: move.evalAfter,
        evalLoss: move.evalLoss
      };
    });
  }, [review.moves]);

  const selectedIndex = chartData.find((point) => point.nodeId === currentNodeId)?.index ?? null;
  const latest = chartData.at(-1) ?? null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-[#bdbdbd]">
        <span className="inline-flex items-center gap-1">
          <LineChartIcon size={14} /> Evaluation
        </span>
        <strong>{latest ? formatEngineScore(latest.evalAfter) : "—"}</strong>
      </div>
      <div className="relative h-[168px] overflow-hidden rounded-[7px] border border-white/10 bg-[linear-gradient(#18251b_0_49.5%,#3a3f45_49.5%_50.5%,#241d1d_50.5%_100%)]" role="img" aria-label="Evaluation graph">
        <ResponsiveContainer width="100%" height={168}>
          <RechartsLineChart
            data={chartData}
            margin={{ top: 12, right: 12, bottom: 4, left: -18 }}
            onClick={(event) => {
              const payload = (event as { activePayload?: Array<{ payload: EvalChartDatum }> })
                .activePayload?.[0]?.payload;
              if (payload) navigate(payload.nodeId);
            }}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
            <XAxis dataKey="index" hide />
            <YAxis
              domain={[-evalLimit, evalLimit]}
              ticks={[-1000, 0, 1000]}
              tickFormatter={(value) =>
                value === 0 ? "0" : value > 0 ? `+${Number(value) / 100}` : `${Number(value) / 100}`
              }
              stroke="rgba(255,255,255,0.36)"
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
              width={44}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.28)" strokeDasharray="4 4" />
            {selectedIndex !== null ? (
              <ReferenceLine
                x={selectedIndex}
                stroke="rgba(183,214,132,0.72)"
                strokeWidth={2}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.28)", strokeDasharray: "4 4" }}
              content={<EvaluationTooltip />}
            />
            <Line
              type="monotone"
              dataKey="cp"
              stroke="#8bd7b2"
              strokeWidth={2.4}
              dot={{ r: 3, strokeWidth: 1.5, fill: "#151719", stroke: "#8bd7b2" }}
              activeDot={{ r: 5, strokeWidth: 2, fill: "#b7d684", stroke: "#101113" }}
              isAnimationActive={false}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type EvalChartDatum = {
  index: number;
  cp: number;
  nodeId: string;
  san: string;
  ply: number;
  classification: MoveReview["classification"];
  evalAfter: MoveReview["evalAfter"];
  evalLoss: MoveReview["evalLoss"];
};

function EvaluationTooltip({
  active,
  payload
}: {
  active?: boolean;
  payload?: Array<{ payload: EvalChartDatum }>;
}) {
  const point = active ? payload?.[0]?.payload : null;
  if (!point) return null;
  return (
    <div className="relative z-10 flex flex-wrap items-center gap-1.5 whitespace-nowrap rounded-md border border-[#3b3b3b] bg-[#141414]/95 px-2.5 py-1.5 text-xs text-[#f3f3f3] shadow-xl" role="status">
      <strong>
        {moveNumberPrefix(point.ply)}
        {point.san}
      </strong>
      <span className={tagClass(point.classification)}>
        {reviewLabel(point.classification)}
      </span>
      <em className="font-mono not-italic text-[#d0d8e2]">{formatEngineScore(point.evalAfter)}</em>
      {point.evalLoss !== null && point.evalLoss > 0 ? (
        <small className="text-[#ff9c91]">-{point.evalLoss} cp</small>
      ) : null}
    </div>
  );
}

function AdvantageTimeline({ review }: { review: GameReview }) {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const navigate = useNavigateToNode();
  return (
    <div className="grid h-6 grid-flow-col auto-cols-fr overflow-hidden rounded-[7px] border border-[#303030] bg-[#202020]" aria-label="Advantage timeline">
      {review.moves.map((move) => {
        const cp = move.evalAfter ? scoreToCentipawns(move.evalAfter) : 0;
        const side = cp > 80 ? "white" : cp < -80 ? "black" : "equal";
        return (
          <button
            key={move.nodeId}
            className={cn(
              "relative min-w-0 rounded-none border-0 p-0",
              side === "white" ? "bg-[#d7d3c5]" : side === "black" ? "bg-[#262626]" : "bg-[#777]",
              ["missed_tactic", "blunder", "mistake"].includes(move.classification) &&
                "after:absolute after:inset-x-px after:bottom-0 after:h-1 after:rounded-sm",
              ["missed_tactic", "blunder"].includes(move.classification) && "after:bg-[#ff7368]",
              move.classification === "mistake" && "after:bg-[#ffa066]",
              move.nodeId === currentNodeId && "z-10 shadow-[inset_0_0_0_2px_#fff]"
            )}
            aria-label={`${moveNumberPrefix(move.ply)}${move.san}: ${formatEngineScore(move.evalAfter)}`}
            title={`${moveNumberPrefix(move.ply)}${move.san} ${formatEngineScore(move.evalAfter)}`}
            onClick={() => navigate(move.nodeId)}
          />
        );
      })}
    </div>
  );
}

function TimeUsageChart({ review }: { review: GameReview }) {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const navigate = useNavigateToNode();
  const timedMoves = review.moves.filter((move) => typeof move.timeSpentMs === "number");
  const maxTime = Math.max(1, ...timedMoves.map((move) => move.timeSpentMs ?? 0));

  if (!timedMoves.length) {
    return (
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-[7px] border border-white/10 bg-[#171a1d] p-2.5 text-xs text-[#a9a9a9]">
        <span>Clock Usage</span>
        <strong className="text-[#d2d2d2]">No Clock Data</strong>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-[7px] border border-white/10 bg-[#171a1d] p-2.5 text-xs text-[#a9a9a9]">
      <div className="flex items-center justify-between">
        <span>Clock Usage</span>
        <strong className="text-[#d2d2d2]">{timedMoves.length} timed moves</strong>
      </div>
      <div className="flex h-[58px] items-end gap-0.5 border-t border-[#303030] pt-1" aria-label="Time usage chart">
        {timedMoves.map((move) => {
          const spent = move.timeSpentMs ?? 0;
          const height = Math.max(10, Math.round((spent / maxTime) * 100));
          return (
            <button
              key={move.nodeId}
              type="button"
              className={cn(
                "min-w-[3px] flex-1 rounded-t border-0 p-0",
                heightByPercent[percentStep(height)],
                move.ply % 2 === 1 ? "bg-[#c9c4b4]" : "bg-[#59606c]",
                move.nodeId === currentNodeId && "z-10 shadow-[0_0_0_2px_#fff]"
              )}
              aria-label={`${moveNumberPrefix(move.ply)}${move.san}: ${formatMillisecondsClock(spent)}`}
              title={`${moveNumberPrefix(move.ply)}${move.san}: ${formatMillisecondsClock(spent)}`}
              onClick={() => navigate(move.nodeId)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReviewMoveDetails({ move }: { move: MoveReview | null }) {
  if (!move) return null;
  const playedSan = uciToSan(move.fenBefore, move.playedMove) ?? move.playedMove;
  const bestSan = move.bestMove ? uciToSan(move.fenBefore, move.bestMove) ?? move.bestMove : "-";
  return (
    <div className="grid gap-2">
      <div className={cn("flex items-center justify-between rounded-lg border bg-[#171a1d] px-2.5 py-2", classificationClass(move.classification))}>
        <strong>
          {moveNumberPrefix(move.ply)}
          {move.san} · {reviewLabel(move.classification)}
        </strong>
        <span className="text-xs">{move.evalLoss === null ? "No loss" : `${move.evalLoss} cp loss`}</span>
      </div>
      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-white/10 bg-[#171a1d]">
        <span className="grid min-w-0 gap-1 px-2.5 py-2">
          <em className="text-[11px] not-italic text-[#9f9f9f]">Played</em>
          <strong className="truncate text-[13px] text-[#f0f0f0]">{playedSan}</strong>
        </span>
        <span className="grid min-w-0 gap-1 border-l border-white/10 px-2.5 py-2">
          <em className="text-[11px] not-italic text-[#9f9f9f]">Best</em>
          <strong className="truncate text-[13px] text-[#f0f0f0]">{bestSan}</strong>
        </span>
        <span className="grid min-w-0 gap-1 border-l border-white/10 px-2.5 py-2">
          <em className="text-[11px] not-italic text-[#9f9f9f]">Eval After</em>
          <strong className="truncate text-[13px] text-[#f0f0f0]">{formatEngineScore(move.evalAfter)}</strong>
        </span>
      </div>
      <p className={cn("m-0 rounded-lg border bg-[#171a1d] px-3 py-2.5 text-[12.5px] leading-snug text-[#cfcfcf]", classificationClass(move.classification))}>
        {coachTextForMove(move, playedSan, bestSan)}
      </p>
      <div className="grid gap-1 rounded-lg border border-white/10 bg-[#171a1d] px-2.5 py-2">
        <span className="text-xs text-[#a9a9a9]">Best continuation</span>
        <strong>{bestSan}</strong>
        <p className="m-0 grid grid-cols-[18px_56px_1fr] gap-1.5 font-mono text-xs leading-snug text-[#d4d4d4] [overflow-wrap:anywhere]">
          {move.bestLine.length
            ? toSanLine(move.fenBefore, move.bestLine.slice(0, 8)).join(" ")
            : "-"}
        </p>
      </div>
      {move.topLines.length ? (
        <div className="grid gap-1 rounded-lg border border-white/10 bg-[#171a1d] px-2.5 py-2">
          <span className="text-xs text-[#a9a9a9]">Engine's top lines</span>
          {move.topLines.map((line) => (
            <LineRow key={line.multipv} line={line} fenBefore={move.fenBefore} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LineRow({ line, fenBefore }: { line: AnalysisLine; fenBefore: string }) {
  const sans = useMemo(
    () => toSanLine(fenBefore, line.pv.slice(0, 6)).join(" "),
    [fenBefore, line.pv]
  );
  return (
    <p className="m-0 grid grid-cols-[18px_56px_1fr] items-baseline gap-1.5 font-mono text-xs leading-snug text-[#d4d4d4]">
      <span className={cn("inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#2a313b] text-[10px] font-bold text-[#c5cdd6]", line.multipv === 1 && "bg-[#2b6a44] text-[#e7fff1]", line.multipv === 2 && "bg-[#2c4f7a] text-[#e2efff]", line.multipv === 3 && "bg-[#6f5a26] text-[#fff3cb]")}>{line.multipv}</span>
      <strong>{formatEngineScore(line.scoreWhite)}</strong>
      <em className="not-italic text-[#aab4be]">{sans}</em>
    </p>
  );
}

function TacticsList({ review }: { review: GameReview }) {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const navigate = useNavigateToNode();
  const tactics = useMemo(
    () =>
      review.moves.filter(
        (move) =>
          move.classification === "missed_tactic" ||
          move.classification === "blunder" ||
          move.classification === "mistake"
      ),
    [review.moves]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector(".tactic-item--active") as HTMLElement | null;
    if (!active) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < containerRect.top || activeRect.bottom > containerRect.bottom) {
      container.scrollTop +=
        activeRect.top - containerRect.top - container.clientHeight / 2 + active.clientHeight / 2;
    }
  }, [currentNodeId, tactics.length]);

  if (!tactics.length) return null;

  return (
    <div className="grid gap-2 rounded-lg border border-white/10 bg-[#171a1d] p-3">
      <div className="flex items-center justify-between text-[12.5px] text-[#cfcfcf]">
        <span className="inline-flex items-center gap-1.5">
          <Target size={13} /> Critical Moments
        </span>
        <em className="rounded-full bg-[#2a2a2a] px-2 py-0.5 text-[11px] not-italic text-[#c8c8c8]">{tactics.length}</em>
      </div>
      <div ref={containerRef} className="grid max-h-[220px] gap-2 overflow-y-auto pr-1">
        {tactics.map((move) => (
          <button
            key={move.nodeId}
            type="button"
            className={cn(
              "grid gap-1.5 rounded-[7px] border border-[#2f2f2f] bg-[#242424] px-2.5 py-2 text-left transition-colors hover:bg-[#2c2c2c]",
              ["missed_tactic", "blunder"].includes(move.classification) && "border-l-[3px] border-l-[#ff7368]",
              move.classification === "mistake" && "border-l-[3px] border-l-[#ffa066]",
              move.nodeId === currentNodeId && "tactic-item--active border-[#5c8bd6] bg-[#2a3346]"
            )}
            onClick={() => navigate(move.nodeId)}
          >
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <strong>
                {moveNumberPrefix(move.ply)}
                {move.san}
              </strong>
              <span className={tagClass(move.classification)}>
                {reviewLabel(move.classification)}
              </span>
              {move.evalLoss !== null ? <em className="font-mono text-[11.5px] not-italic text-[#ff9c91]">-{move.evalLoss} cp</em> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#b5b5b5]">
              <span>
                Played <code className="rounded bg-[#1a1a1a] px-1 text-[11.5px] text-[#e0e6ee]">{uciToSan(move.fenBefore, move.playedMove) ?? move.playedMove}</code>
              </span>
              {move.bestMove && move.bestMove !== move.playedMove ? (
                <span>
                  Best <code className="rounded bg-[#1a1a1a] px-1 text-[11.5px] text-[#e0e6ee]">{uciToSan(move.fenBefore, move.bestMove) ?? move.bestMove}</code>{" "}
                  {move.bestLine.length > 1 ? (
                    <em className="font-mono not-italic text-[#8e98a3]">{toSanLine(move.fenBefore, move.bestLine.slice(0, 4)).join(" ")}</em>
                  ) : null}
                </span>
              ) : null}
            </div>
            {move.motifs.length ? (
              <div className="flex flex-wrap gap-1">
                {move.motifs.map((motif) => (
                  <span key={motif} className="rounded-full bg-[#1d2a23] px-2 py-0.5 text-[10.5px] tracking-[0.02em] text-[#aed5b6]">
                    {motif}
                  </span>
                ))}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function mainlineReviewInput(moveTree: MoveNode[]) {
  const moves: {
    nodeId: string;
    ply: number;
    san: string;
    uci: string;
    fenBefore: string;
    fenAfter: string;
  }[] = [];
  let node = moveTree.find((item) => item.id === "root");
  while (node?.children[0]) {
    const next = moveTree.find((item) => item.id === node?.children[0]);
    if (!next?.uci || !next.san) break;
    moves.push({
      nodeId: next.id,
      ply: next.ply,
      san: next.san,
      uci: next.uci,
      fenBefore: next.fenBefore,
      fenAfter: next.fenAfter
    });
    node = next;
  }
  return moves;
}

function moveNumberPrefix(ply: number): string {
  const moveNumber = Math.floor((ply + 1) / 2);
  return ply % 2 === 1 ? `${moveNumber}. ` : `${moveNumber}… `;
}

function computeSummary(moves: MoveReview[]) {
  let best = 0;
  let excellent = 0;
  let good = 0;
  let inaccuracies = 0;
  let mistakes = 0;
  let blunders = 0;
  let missedTactics = 0;
  let evalLossSum = 0;
  let evalLossCount = 0;

  for (const move of moves) {
    if (move.classification === "best") best += 1;
    else if (move.classification === "excellent") excellent += 1;
    else if (move.classification === "good") good += 1;
    else if (move.classification === "inaccuracy") inaccuracies += 1;
    else if (move.classification === "mistake") mistakes += 1;
    else if (move.classification === "blunder") blunders += 1;
    else if (move.classification === "missed_tactic") missedTactics += 1;

    if (move.evalLoss !== null) {
      evalLossSum += move.evalLoss;
      evalLossCount += 1;
    }
  }

  return {
    totalMoves: moves.length,
    best,
    excellent,
    good,
    inaccuracies,
    mistakes,
    blunders,
    missedTactics,
    averageCentipawnLoss: evalLossCount ? Math.round(evalLossSum / evalLossCount) : null
  };
}

function computeInsights(moves: MoveReview[]) {
  let whiteLoss = 0;
  let whiteCount = 0;
  let blackLoss = 0;
  let blackCount = 0;
  let totalLoss = 0;
  let totalCount = 0;
  let turningPoint: MoveReview | null = null;

  for (const move of moves) {
    if (move.evalLoss !== null) {
      totalLoss += move.evalLoss;
      totalCount += 1;
      if (move.ply % 2 === 1) {
        whiteLoss += move.evalLoss;
        whiteCount += 1;
      } else {
        blackLoss += move.evalLoss;
        blackCount += 1;
      }
      if (!turningPoint || (turningPoint.evalLoss ?? -1) < move.evalLoss) {
        turningPoint = move;
      }
    }
  }

  return {
    accuracy: totalCount ? accuracyFromAverageLoss(totalLoss / totalCount) : null,
    whiteAccuracy: whiteCount ? accuracyFromAverageLoss(whiteLoss / whiteCount) : null,
    blackAccuracy: blackCount ? accuracyFromAverageLoss(blackLoss / blackCount) : null,
    turningPoint
  };
}

function accuracyFromAverageLoss(averageLoss: number): number {
  return Math.round(clamp(100 - averageLoss / 8, 0, 100));
}

function formatAccuracy(value: number | null): string {
  return value === null ? "-" : `${value}`;
}

function coachTextForMove(move: MoveReview, playedSan: string, bestSan: string): string {
  if (move.classification === "best" || move.classification === "excellent") {
    return `${playedSan} matched the engine's main idea. Keep following the forcing line before switching plans.`;
  }
  if (move.classification === "missed_tactic") {
    return `The tactic was ${bestSan}. Compare the played move with the best continuation and replay the top line on the board.`;
  }
  if (move.classification === "blunder") {
    return `${playedSan} changed the evaluation sharply. The practical repair is to study why ${bestSan} stabilizes the position.`;
  }
  if (move.classification === "mistake") {
    return `${bestSan} was the cleaner idea. Use the continuation below to see the threat or resource that mattered.`;
  }
  if (move.classification === "inaccuracy") {
    return `${playedSan} was playable, but ${bestSan} kept more of the advantage.`;
  }
  return `${playedSan} was reasonable. Check the candidate lines for alternative plans.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const pos = positionFromFen(fen);
    const parsed = parseUci(uci);
    if (!parsed || !pos.isLegal(parsed)) return null;
    return makeSanAndPlay(pos, parsed);
  } catch {
    return null;
  }
}

function toSanLine(startFen: string, ucis: string[]): string[] {
  if (!ucis.length) return [];
  try {
    const pos = positionFromFen(startFen);
    const sans: string[] = [];
    for (const uci of ucis) {
      const parsed = parseUci(uci);
      if (!parsed || !pos.isLegal(parsed)) {
        sans.push(uci);
        continue;
      }
      sans.push(makeSanAndPlay(pos, parsed));
    }
    return sans;
  } catch {
    return ucis;
  }
}
