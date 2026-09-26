import { memo, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { Color } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { ReviewBoard } from "./ReviewBoard";
import { moveLabel } from "./review-utils";
import { CHART_SCORE_LIMIT, formatMoveEval, whiteChartScore } from "./review-score";
import { QualityBadge } from "@/components/ui/quality-badge";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/page";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ChartPoint = {
  ply: number;
  label: string;
  score: number;
  move: MoveReview | null;
};

/** White-perspective graph value of a non-terminal score (e.g. the first move's `evalBefore`). */
function chartScore(score: MoveReview["evalBefore"]): number {
  if (!score) return 0;
  if (score.type === "mate") return score.value >= 0 ? CHART_SCORE_LIMIT : -CHART_SCORE_LIMIT;
  return Math.max(-CHART_SCORE_LIMIT, Math.min(CHART_SCORE_LIMIT, score.value));
}

function resolveDataIndex(value: unknown, data: readonly ChartPoint[]): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < data.length) return value;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const index = Number(value);
      if (index >= 0 && index < data.length) return index;
    }
    const matchingIndex = data.findIndex((point) => point.label === value || String(point.ply) === value);
    if (matchingIndex >= 0) return matchingIndex;
  }
  return null;
}

/**
 * Memoised: during a review pass the parent re-renders on progress ticks, but the graph only
 * needs to redraw when a move is added or the selection changes (pass stable callbacks).
 */
export const ReviewTape = memo(function ReviewTape({
  moves,
  selectedNodeId,
  onSelectNode,
  orientation,
  variationSelected = false,
  totalPlies
}: {
  moves: readonly MoveReview[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  orientation: Color;
  /** The selected node is off the main line, so no point on the graph is highlighted. */
  variationSelected?: boolean;
  /**
   * Fix the x-axis to the whole game (used while the review is still running) so the line grows
   * left to right instead of re-scaling on every new move.
   */
  totalPlies?: number;
}) {
  const data = useMemo<ChartPoint[]>(() => {
    const first = moves[0];
    return [
      {
        ply: 0,
        label: "Start",
        score: first ? chartScore(first.evalBefore) : 0,
        move: null
      },
      ...moves.map((move) => ({
        ply: move.ply,
        label: moveLabel(move),
        score: whiteChartScore(move),
        move
      }))
    ];
  }, [moves]);

  const selectedPoint = data.find((point) => point.move?.nodeId === selectedNodeId) ?? null;
  const chartDomain = useMemo<[number, number]>(() => {
    let maxAbs = 50;
    for (const point of data) maxAbs = Math.max(maxAbs, Math.abs(point.score));
    const bound = Math.min(CHART_SCORE_LIMIT, Math.ceil((maxAbs * 1.2) / 50) * 50);
    return [-bound, bound];
  }, [data]);

  const lastPly = data[data.length - 1]?.ply ?? 0;
  const xDomain: [number, number] | [string, string] = totalPlies ? [0, Math.max(totalPlies, lastPly)] : ["dataMin", "dataMax"];

  const selectPoint = (point: ChartPoint | undefined) => {
    if (point?.move) onSelectNode(point.move.nodeId);
  };

  return (
    <section className="min-w-0" aria-label="Game evaluation graph">
      <SectionHeader
        as="h3"
        title="Evaluation"
        className="min-h-6"
        actions={
          <>
            {variationSelected ? <Badge tone="warn">Variation</Badge> : null}
            <UiTooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label="About the graph" className="grid size-6 place-items-center rounded-md text-fg-subtle outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50">
                  <Info className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-60">
                White&apos;s perspective: above zero means White is better. Click a point to jump to that move.
              </TooltipContent>
            </UiTooltip>
          </>
        }
      />
      <div className="h-28 min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 112 }}>
          <LineChart
            data={data}
            margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            onClick={(state) => {
              const index = resolveDataIndex(state?.activeTooltipIndex, data);
              if (index !== null) selectPoint(data[index]);
            }}
          >
            <CartesianGrid stroke="var(--color-line-subtle)" vertical={false} />
            <XAxis
              dataKey="ply"
              type="number"
              domain={xDomain}
              tick={{ fill: "var(--color-fg-subtle)", fontSize: 11 }}
              stroke="var(--color-line)"
              tickFormatter={(value) => String(value)}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={chartDomain}
              ticks={[-chartDomain[1], 0, chartDomain[1]]}
              tickFormatter={(value) => (value === 0 ? "0" : `${value > 0 ? "+" : ""}${(value / 100).toFixed(0)}`)}
              tick={{ fill: "var(--color-fg-subtle)", fontSize: 11 }}
              stroke="var(--color-line)"
              width={32}
            />
            <ReferenceLine y={0} stroke="var(--color-line-strong)" />
            {selectedPoint ? <ReferenceLine x={selectedPoint.ply} stroke="var(--color-accent)" strokeDasharray="4 4" /> : null}
            <Tooltip
              cursor={{ stroke: "var(--color-line-strong)" }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as ChartPoint | undefined;
                if (!active || !point) return null;
                if (!point.move) {
                  return <div className="pointer-events-none rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs text-fg shadow-popover">Starting position</div>;
                }
                const move = point.move;
                return (
                  <div className="pointer-events-none flex gap-3 rounded-lg border border-line bg-surface-raised p-2 text-xs shadow-popover">
                    <ReviewBoard fen={move.fenAfter} orientation={orientation} className="size-24 shrink-0" />
                    <div className="grid min-w-0 content-start gap-1 py-0.5">
                      <p className="font-mono font-semibold text-fg">{moveLabel(move)}</p>
                      <QualityBadge classification={move.classification} className="justify-self-start" />
                      <p className="font-mono text-fg-muted">{formatMoveEval(move)} · {move.evalLoss ?? "—"}cp</p>
                    </div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--color-info)"
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={(props) => {
                const point = props.payload as ChartPoint | undefined;
                const selected = point?.move?.nodeId === selectedNodeId;
                const interactive = Boolean(point?.move);
                const label = point?.move
                  ? `${moveLabel(point.move)}, after ${formatMoveEval(point.move)}`
                  : "Starting position";
                return (
                  <circle
                    key={`dot-${point?.ply ?? props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={selected ? 4.5 : 2.5}
                    className="cursor-pointer outline-none"
                    fill={selected ? "var(--color-accent)" : point?.move ? "var(--color-info)" : "var(--color-fg-subtle)"}
                    stroke={selected ? "var(--color-accent-fg)" : "var(--color-surface)"}
                    strokeWidth={selected ? 1.5 : 1}
                    tabIndex={interactive ? 0 : -1}
                    role={interactive ? "button" : undefined}
                    aria-label={label}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectPoint(point);
                    }}
                    onKeyDown={(event) => {
                      if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      selectPoint(point);
                    }}
                  />
                );
              }}
              activeDot={{ r: 4.5, fill: "var(--color-accent)", stroke: "var(--color-accent-fg)", strokeWidth: 1.5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
});
