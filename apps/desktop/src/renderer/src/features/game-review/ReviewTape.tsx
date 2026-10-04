import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
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
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { AnnotationBadge } from "@/components/ui/annotation-badge";
import { annotationTone } from "@/lib/ui";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/page";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ChartPoint = {
  ply: number;
  label: string;
  score: number;
  move: MoveReview | null;
  /** One of the review's key moments (drawn ringed). */
  key: boolean;
};

/** White-perspective graph value of a non-terminal score (e.g. the first move's `evalBefore`). */
function chartScore(score: MoveReview["evalBefore"]): number {
  if (!score) return 0;
  if (score.type === "mate") return score.value >= 0 ? CHART_SCORE_LIMIT : -CHART_SCORE_LIMIT;
  return Math.max(-CHART_SCORE_LIMIT, Math.min(CHART_SCORE_LIMIT, score.value));
}

function resolveDataIndex(value: unknown, data: readonly ChartPoint[]): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < data.length)
    return value;
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const index = Number(value);
      if (index >= 0 && index < data.length) return index;
    }
    const matchingIndex = data.findIndex(
      (point) => point.label === value || String(point.ply) === value
    );
    if (matchingIndex >= 0) return matchingIndex;
  }
  return null;
}

/*
 * Fixed chart geometry, so the selection marker can be positioned without asking recharts for its
 * scales: the plot spans [PLOT_LEFT, width - PLOT_RIGHT] × [PLOT_TOP, PLOT_TOP + PLOT_HEIGHT].
 */
const CHART_HEIGHT = 112;
const MARGIN = { top: 6, right: 8, bottom: 0, left: 0 };
const Y_AXIS_WIDTH = 32;
const X_AXIS_HEIGHT = 22;
const PLOT_LEFT = MARGIN.left + Y_AXIS_WIDTH;
const PLOT_RIGHT = MARGIN.right;
const PLOT_TOP = MARGIN.top;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom - X_AXIS_HEIGHT;
const TICK_STYLE = { fill: "var(--color-fg-subtle)", fontSize: 11 };
const TOOLTIP_CURSOR = { stroke: "var(--color-line-strong)" };
const ACTIVE_DOT = {
  r: 4.5,
  fill: "var(--color-accent)",
  stroke: "var(--color-accent-fg)",
  strokeWidth: 1.5
};

/**
 * The review's evaluation graph. The chart itself is memoised on the data and only redraws when a
 * move is added; the selected move is a separate marker that glides between points (a CSS
 * transform transition), so stepping through the game never re-renders the chart's dots or axes.
 */
export const ReviewTape = memo(function ReviewTape({
  moves,
  selectedNodeId,
  onSelectNode,
  orientation,
  variationSelected = false,
  totalPlies,
  keyMomentIds,
  actions
}: {
  moves: readonly MoveReview[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  orientation: Color;
  /** Node ids of the review's key moments: their points are ringed. */
  keyMomentIds?: ReadonlySet<string>;
  /** Extra controls in the graph's header (key-moment navigation). */
  actions?: ReactNode;
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
        move: null,
        key: false
      },
      ...moves.map((move) => ({
        ply: move.ply,
        label: moveLabel(move),
        score: whiteChartScore(move),
        move,
        key: keyMomentIds?.has(move.nodeId) ?? false
      }))
    ];
  }, [keyMomentIds, moves]);

  const yDomain = useMemo<[number, number]>(() => {
    let maxAbs = 50;
    for (const point of data) maxAbs = Math.max(maxAbs, Math.abs(point.score));
    const bound = Math.min(CHART_SCORE_LIMIT, Math.ceil((maxAbs * 1.2) / 50) * 50);
    return [-bound, bound];
  }, [data]);
  const lastPly = data[data.length - 1]?.ply ?? 0;
  const xMax = totalPlies ? Math.max(totalPlies, lastPly) : lastPly;
  const xDomain = useMemo<[number, number]>(() => [0, xMax], [xMax]);

  const selectedPoint = variationSelected
    ? null
    : (data.find((point) => point.move?.nodeId === selectedNodeId) ?? null);

  return (
    <section className="min-w-0" aria-label="Game evaluation graph">
      <SectionHeader
        as="h3"
        title="Evaluation"
        className="min-h-6"
        actions={
          <>
            {variationSelected ? (
              <Badge tone="warn" className="animate-fade-in">
                Variation
              </Badge>
            ) : null}
            {actions}
            <GraphHelp />
          </>
        }
      />
      <div className="relative min-w-0 w-full" style={{ height: CHART_HEIGHT }}>
        <EvalChart
          data={data}
          xDomain={xDomain}
          yDomain={yDomain}
          orientation={orientation}
          onSelectNode={onSelectNode}
        />
        <SelectionMarker point={selectedPoint} xDomain={xDomain} yDomain={yDomain} />
      </div>
    </section>
  );
});

/** The graph's help tooltip; memoised so selecting moves does not re-render its tooltip tree. */
const GraphHelp = memo(function GraphHelp() {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <span
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the info icon takes focus so keyboard users can open its tooltip
          tabIndex={0}
          aria-label="About the graph"
          className="grid size-6 place-items-center rounded-md text-fg-subtle outline-none transition-colors duration-micro ease-standard hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Info className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60">
        White&apos;s perspective: above zero means White is better. Coloured points are marked
        moves; ringed ones are the key moments. Click a point to jump to that move.
      </TooltipContent>
    </UiTooltip>
  );
});

/** The glide-between-moves cursor: a dashed rule and a dot over the selected point. */
function SelectionMarker({
  point,
  xDomain,
  yDomain
}: {
  point: ChartPoint | null;
  xDomain: [number, number];
  yDomain: [number, number];
}) {
  const xSpan = xDomain[1] - xDomain[0];
  const ySpan = yDomain[1] - yDomain[0];
  const next = point
    ? {
        x: xSpan > 0 ? (point.ply - xDomain[0]) / xSpan : 0,
        y: ySpan > 0 ? 1 - (point.score - yDomain[0]) / ySpan : 0.5
      }
    : null;
  // Keep the last position while hidden so the marker fades out in place instead of jumping.
  const [last, setLast] = useState({ x: 0, y: 0.5 });
  if (next && (next.x !== last.x || next.y !== last.y)) setLast(next);
  const { x, y } = next ?? last;
  const left = `calc(${PLOT_LEFT}px + (100cqw - ${PLOT_LEFT + PLOT_RIGHT}px) * ${x.toFixed(4)})`;
  const top = `calc(${PLOT_TOP}px + ${PLOT_HEIGHT}px * ${y.toFixed(4)})`;
  const glide = "transition-[translate,opacity] duration-standard ease-enter";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 [container-type:size]",
        glide,
        point ? "opacity-100" : "opacity-0"
      )}
      aria-hidden
    >
      <span
        className={cn("absolute left-0 w-0 border-l border-dashed border-accent/80", glide)}
        style={{ top: PLOT_TOP, height: PLOT_HEIGHT, translate: `${left} 0` }}
      />
      <span
        className={cn(
          "absolute left-0 top-0 -ml-[4.5px] -mt-[4.5px] size-[9px] rounded-full border-[1.5px] border-accent-fg bg-accent shadow-[0_0_0_3px_rgb(143_182_111/0.22)]",
          glide
        )}
        style={{ translate: `${left} ${top}` }}
      />
    </div>
  );
}

/** The recharts line chart: re-renders only when the data or the axes change. */
const EvalChart = memo(function EvalChart({
  data,
  xDomain,
  yDomain,
  orientation,
  onSelectNode
}: {
  data: ChartPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  orientation: Color;
  onSelectNode: (nodeId: string) => void;
}) {
  const selectPoint = useCallback(
    (point: ChartPoint | undefined) => {
      if (point?.move) onSelectNode(point.move.nodeId);
    },
    [onSelectNode]
  );
  const yTicks = useMemo(() => [-yDomain[1], 0, yDomain[1]], [yDomain]);
  const renderDot = useCallback(
    (props: { cx?: number; cy?: number; index?: number; payload?: unknown }) => {
      const point = data.find((item) => item === props.payload);
      const interactive = Boolean(point?.move);
      const annotation = point?.move?.assessment?.annotation ?? null;
      const label = point?.move
        ? [
            moveLabel(point.move),
            annotation ? annotationLabel(annotation) : null,
            point.key ? "key moment" : null,
            `after ${formatMoveEval(point.move)}`
          ]
            .filter(Boolean)
            .join(", ")
        : "Starting position";
      return (
        <circle
          key={`dot-${point?.ply ?? props.index}`}
          cx={props.cx}
          cy={props.cy}
          r={point?.key ? 4 : annotation ? 3.25 : 2.5}
          className="cursor-pointer outline-none focus-visible:[stroke:var(--color-accent)] focus-visible:[stroke-width:2]"
          fill={
            annotation
              ? annotationTone[annotation].fill
              : point?.move
                ? "var(--color-info)"
                : "var(--color-fg-subtle)"
          }
          stroke={point?.key ? "var(--color-fg)" : "var(--color-surface)"}
          strokeWidth={point?.key ? 1.5 : 1}
          data-annotation={annotation ?? undefined}
          data-key-moment={point?.key ? "true" : undefined}
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
    },
    [data, selectPoint]
  );
  const renderTooltip = useCallback(
    ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
      const point = data.find((item) => item === payload?.[0]?.payload);
      if (!active || !point) return null;
      if (!point.move) {
        return (
          <div className="pointer-events-none rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs text-fg shadow-popover">
            Starting position
          </div>
        );
      }
      const move = point.move;
      return (
        <div className="pointer-events-none flex gap-3 rounded-lg border border-line bg-surface-raised p-2 text-xs shadow-popover">
          <ReviewBoard fen={move.fenAfter} orientation={orientation} className="size-24 shrink-0" />
          <div className="grid min-w-0 content-start gap-1 py-0.5">
            <p className="font-mono font-semibold text-fg">{moveLabel(move)}</p>
            <AnnotationBadge
              annotation={move.assessment?.annotation ?? null}
              className="justify-self-start"
            />
            <p className="font-mono text-fg-muted tabular-nums">
              {formatMoveEval(move)} · {move.evalLoss ?? "—"}cp
            </p>
          </div>
        </div>
      );
    },
    [data, orientation]
  );

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 320, height: CHART_HEIGHT }}
    >
      <LineChart
        data={data}
        margin={MARGIN}
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
          height={X_AXIS_HEIGHT}
          tick={TICK_STYLE}
          stroke="var(--color-line)"
          tickFormatter={formatPlyTick}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={yDomain}
          ticks={yTicks}
          tickFormatter={formatScoreTick}
          tick={TICK_STYLE}
          stroke="var(--color-line)"
          width={Y_AXIS_WIDTH}
        />
        <ReferenceLine y={0} stroke="var(--color-line-strong)" />
        <Tooltip
          cursor={TOOLTIP_CURSOR}
          isAnimationActive
          animationDuration={160}
          animationEasing="ease-out"
          content={renderTooltip}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="var(--color-info)"
          strokeWidth={1.5}
          isAnimationActive={false}
          dot={renderDot}
          activeDot={ACTIVE_DOT}
        />
      </LineChart>
    </ResponsiveContainer>
  );
});

function formatPlyTick(value: number): string {
  return String(value);
}

function formatScoreTick(value: number): string {
  return value === 0 ? "0" : `${value > 0 ? "+" : ""}${(value / 100).toFixed(0)}`;
}
