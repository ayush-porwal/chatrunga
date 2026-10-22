import { memo, useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TrendingUp } from "lucide-react";
import type { PuzzleRatingPoint } from "@chaturanga/shared/types/puzzle-rating";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { columnForKey, nearestColumn } from "@/lib/chart";
import { card } from "@/lib/ui";
import { useWidth } from "@/lib/use-width";
import { cn } from "@/lib/utils";
import { usePuzzleRatingHistoryQuery, usePuzzleRatingSummaryQuery } from "../../queries/puzzles";
import { CardTitleBar } from "../play/card-title";
import { formatPuzzleRating, formatRatingDelta } from "./PuzzleRatingLine";
import {
  firstPuzzleNumber,
  formatDay,
  pointText,
  ratingChange,
  ratingChart,
  type RatingChart
} from "./rating-chart";

const TITLE_ID = "puzzle-rating-title";
/** The plot's height; its width is the card's. */
const PLOT_HEIGHT = 220;

type RatingSummary = NonNullable<ReturnType<typeof usePuzzleRatingSummaryQuery>["data"]>;

/**
 * The Rating card: the solver's local puzzle rating ("?" while provisional), its change across the
 * recent rated puzzles, the share solved, and the rating after each of those puzzles as a line
 * chart. Before the first rated puzzle, only how to set it.
 */
export const PuzzleRatingChart = memo(function PuzzleRatingChart() {
  const summary = usePuzzleRatingSummaryQuery();
  const history = usePuzzleRatingHistoryQuery();
  const data = summary.data;
  return (
    <section className={card} aria-labelledby={TITLE_ID}>
      <CardTitleBar id={TITLE_ID} title="Rating" />
      {!data || history.isPending ? (
        <RatingSkeleton />
      ) : data.ratedCount === 0 ? (
        <EmptyState
          icon={<TrendingUp />}
          title="No rated puzzles yet"
          description="Solve Lichess puzzles to set your rating. Only your first try at each puzzle counts."
        />
      ) : (
        <div className="grid gap-4 px-4 pb-4">
          <CurrentRating summary={data} history={history.data ?? []} />
          {(history.data?.length ?? 0) > 1 ? (
            <RatingPlot
              history={history.data ?? []}
              firstNumber={firstPuzzleNumber(data.ratedCount, history.data?.length ?? 0)}
            />
          ) : null}
        </div>
      )}
    </section>
  );
});

/**
 * The rating (its deviation in the tooltip), its change over the recent rated puzzles, how many
 * are rated and the share solved, and whether it is still provisional.
 */
function CurrentRating({
  summary,
  history
}: {
  summary: RatingSummary;
  history: readonly PuzzleRatingPoint[];
}) {
  const change = ratingChange(history);
  const solved = summary.attemptCount
    ? Math.round((100 * summary.solvedCount) / summary.attemptCount)
    : 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span
        className="text-2xl font-semibold tabular-nums text-fg"
        title={`Deviation ${Math.round(summary.deviation)}`}
      >
        {formatPuzzleRating(summary)}
      </span>
      {change !== null ? (
        <span
          className={cn(
            "text-xs font-medium tabular-nums",
            change > 0 ? "text-accent-fg" : change < 0 ? "text-danger" : "text-fg-subtle"
          )}
        >
          {formatRatingDelta(change)}
          <span className="font-normal text-fg-muted">
            {` over the last ${history.length - 1} ${history.length === 2 ? "puzzle" : "puzzles"}`}
          </span>
        </span>
      ) : null}
      <span className="ml-auto text-xs tabular-nums text-fg-muted">
        {summary.ratedCount} rated · {solved}% solved
      </span>
      {summary.provisional ? (
        <p className="basis-full text-xs text-fg-muted">
          Provisional: a few more rated puzzles settle it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The rating after each recent rated puzzle, sized to the card: a dashed grid, the rating axis,
 * the puzzles' numbers below, the line over a fading fill. Pointing at it picks the nearest puzzle
 * (a guide and a dot) with its rating and date; focused, it is a slider over the puzzles
 * (← → Home End, Escape hides the tooltip) read out the same way.
 */
const RatingPlot = memo(function RatingPlot({
  history,
  firstNumber
}: {
  history: readonly PuzzleRatingPoint[];
  firstNumber: number;
}) {
  const [measure, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const chart = width ? ratingChart(history, firstNumber, { width, height: PLOT_HEIGHT }) : null;
  const last = history.length - 1;
  const value = active ?? last;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!chart) return;
    const box = event.currentTarget.getBoundingClientRect();
    setActive(
      nearestColumn(
        event.clientX - box.left,
        chart.points.map((point) => point.x)
      )
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = columnForKey(event.key, active, history.length, last);
    if (next === undefined || (next === null && active === null)) return;
    event.preventDefault();
    setActive(next);
  };
  const point = chart?.points[value];
  return (
    <div className="relative" style={{ height: PLOT_HEIGHT }}>
      <div
        ref={measure}
        role="slider"
        tabIndex={0}
        aria-label="Rating after each rated puzzle"
        aria-orientation="horizontal"
        aria-valuemin={firstNumber}
        aria-valuemax={firstNumber + last}
        aria-valuenow={firstNumber + value}
        aria-valuetext={point ? pointText(point) : undefined}
        onPointerMove={onPointerMove}
        // Focused, the slider keeps its puzzle (the arrow keys go on from it); blur clears it.
        onPointerLeave={(event) => {
          if (document.activeElement !== event.currentTarget) setActive(null);
        }}
        onFocus={() => setActive((current) => current ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
        className="h-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {chart ? <PlotSvg chart={chart} active={active} /> : null}
      </div>
      {chart && active !== null ? <PointTooltip chart={chart} index={active} /> : null}
    </div>
  );
});

function PlotSvg({ chart, active }: { chart: RatingChart; active: number | null }) {
  // A fragment-safe id for the fill's gradient.
  const gradientId = useId().replace(/[^\w-]/g, "");
  const point = active === null ? null : chart.points[active];
  const { plot } = chart;
  return (
    <svg width={chart.width} height={chart.height} className="block font-mono" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity={0.16} />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {chart.yTicks.map((tick) => (
        <g key={tick.label}>
          <line
            x1={plot.left}
            x2={plot.right}
            y1={tick.y}
            y2={tick.y}
            strokeDasharray="3 3"
            className="stroke-line"
          />
          <text
            x={plot.left - 7}
            y={tick.y + 3.5}
            textAnchor="end"
            className="fill-fg-subtle text-[10px]"
          >
            {tick.label}
          </text>
        </g>
      ))}
      {chart.xTicks.map((tick) => (
        <text
          key={tick.label}
          x={tick.x}
          y={chart.height - 6}
          textAnchor="middle"
          className="fill-fg-subtle text-[10.5px]"
        >
          {tick.label}
        </text>
      ))}
      <path d={chart.area} fill={`url(#${gradientId})`} />
      <path
        d={chart.path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {point ? (
        <g>
          <line
            x1={point.x}
            x2={point.x}
            y1={plot.top}
            y2={plot.bottom}
            className="stroke-fg-subtle"
            strokeWidth={1}
          />
          <circle
            cx={point.x}
            cy={point.y}
            r={4.5}
            fill="var(--color-accent)"
            strokeWidth={2}
            className="stroke-surface"
          />
        </g>
      ) : null}
    </svg>
  );
}

/**
 * The pointed-at puzzle's rating, number and date, in the review charts' tooltip look: beside the
 * point, flipped to its left in the plot's right half so it stays in the card.
 */
function PointTooltip({ chart, index }: { chart: RatingChart; index: number }) {
  const point = chart.points[index];
  const left = point.x > chart.width / 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1 z-10 grid gap-0.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-2xs text-fg-muted shadow-popover"
      style={{
        left: point.x,
        transform: left ? "translateX(calc(-100% - 12px))" : "translateX(12px)"
      }}
    >
      <p className="font-mono text-xs font-semibold text-fg tabular-nums">{point.rating}</p>
      <p className="whitespace-nowrap">
        Puzzle {point.number} · {formatDay(point.at)}
      </p>
    </div>
  );
}

/** The card's body while the rating loads: the figures' row and the plot, at their sizes. */
function RatingSkeleton() {
  return (
    <div className="grid gap-4 px-4 pb-4" aria-busy="true" aria-label="Loading your rating">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="rounded-md" style={{ height: PLOT_HEIGHT }} />
    </div>
  );
}
