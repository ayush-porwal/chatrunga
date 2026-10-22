import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { FigurineSan } from "../analysis/EngineLines";
import {
  PREDICTION_ROLE_NAMES,
  columnText,
  columnValues,
  percent,
  predictionChart,
  type PredictionChart,
  type PredictionLine,
  type PredictionRole
} from "./rating-curve-chart";
import { columnForKey, nearestColumn } from "@/lib/chart";
import { useWidth } from "@/lib/use-width";

/** The chart's height; its width is the box's. */
export const PREDICTION_PLOT_HEIGHT = 140;
const CHART_HEIGHT = PREDICTION_PLOT_HEIGHT;

/*
 * Inline weights: the panel is a `.cg-wrap` (for figurines), whose board rules set every SVG
 * text's weight.
 */
const TEXT_STYLE = { fontWeight: 400 } as const;
const LABEL_STYLE = { fontWeight: 700 } as const;

/** A line's marker beside text: a diamond for the move played, a dot for the best, a ring for Maia's. */
export function LegendMarker({ role, color }: { role: PredictionRole; color: string }) {
  const shape =
    role === "played"
      ? "size-2 rotate-45 rounded-[1.5px]"
      : role === "best"
        ? "size-[0.5625rem] rounded-full"
        : "size-[0.5625rem] rounded-full border-2";
  return (
    <i
      aria-hidden
      className={cn("shrink-0", shape)}
      style={role === "maia" ? { borderColor: color } : { background: color }}
    />
  );
}

/**
 * The lines over the ratings, sized to the box. Pointing at the plot picks the nearest rating
 * (its band, a guide and bigger dots) with a tooltip of every line's value there; focused, it is a
 * slider over the ratings (← → Home End, Escape hides the tooltip) read out as those values.
 * `emphasis`: a line the legend points at, the others dimmed.
 */
export function PredictionPlot({
  lines,
  ratings,
  marked,
  markLabel,
  colors,
  emphasis
}: {
  lines: readonly PredictionLine[];
  /** The ratings the lines' values are at, ascending. */
  ratings: readonly number[];
  /** The rating shaded (the mover's, or the user's level). */
  marked: number;
  /** The word over the shaded rating ("You"). */
  markLabel: string;
  colors: Record<PredictionRole, string>;
  emphasis: PredictionRole | null;
}) {
  const [measure, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const markedIndex = Math.max(0, ratings.indexOf(marked));
  const chart = width
    ? predictionChart(lines, ratings, marked, { width, height: CHART_HEIGHT })
    : null;
  const value = active ?? markedIndex;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!chart) return;
    const box = event.currentTarget.getBoundingClientRect();
    const xs = chart.xTicks.map((tick) => tick.x);
    setActive(nearestColumn(event.clientX - box.left, xs));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = columnForKey(event.key, active, ratings.length, markedIndex);
    // Escape with nothing shown is left to whatever holds the panel.
    if (next === undefined || (next === null && active === null)) return;
    event.preventDefault();
    setActive(next);
  };
  return (
    <div className="relative" style={{ height: CHART_HEIGHT }}>
      <div
        ref={measure}
        role="slider"
        tabIndex={0}
        aria-label="Human prediction by rating"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={ratings.length - 1}
        aria-valuenow={value}
        aria-valuetext={columnText(lines, ratings, value)}
        onPointerMove={onPointerMove}
        // Focused, the slider keeps its column (the arrow keys go on from it); blur clears it.
        onPointerLeave={(event) => {
          if (document.activeElement !== event.currentTarget) setActive(null);
        }}
        onFocus={() => setActive((current) => current ?? markedIndex)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
        className="h-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {chart ? (
          <PlotSvg
            chart={chart}
            markLabel={markLabel}
            colors={colors}
            emphasis={emphasis}
            active={active}
          />
        ) : null}
      </div>
      {chart && active !== null ? (
        <ColumnTooltip chart={chart} lines={lines} index={active} colors={colors} />
      ) : null}
    </div>
  );
}

function PlotSvg({
  chart,
  markLabel,
  colors,
  emphasis,
  active
}: {
  chart: PredictionChart;
  markLabel: string;
  colors: Record<PredictionRole, string>;
  emphasis: PredictionRole | null;
  active: number | null;
}) {
  // A fragment-safe id for the fills' gradients.
  const gradientId = useId().replace(/[^\w-]/g, "");
  const dimmed = (role: PredictionRole) => (emphasis && emphasis !== role ? 0.22 : 1);
  return (
    <svg width={chart.width} height={chart.height} className="block font-mono" aria-hidden>
      <MarkBand chart={chart} label={markLabel} />
      {active === null ? null : <HoverColumn chart={chart} index={active} />}
      <Grid chart={chart} />
      {chart.series.map((series) => (
        <g
          key={series.role}
          style={{ color: colors[series.role], opacity: dimmed(series.role) }}
          className="transition-opacity duration-micro"
        >
          <defs>
            <linearGradient id={`${gradientId}-${series.role}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity={0.16} />
              <stop offset="1" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={series.area} fill={`url(#${gradientId}-${series.role})`} />
          <path
            d={series.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={emphasis === series.role ? 2.5 : 2}
          />
          {series.points.map((point, index) => (
            <Marker
              key={chart.xTicks[index]?.rating ?? index}
              x={point.x}
              y={point.y}
              role={series.role}
              scale={(index === active ? 1.4 : 1) * (chart.dense ? 0.6 : 1)}
            />
          ))}
        </g>
      ))}
      {chart.endLabels.map((label) => (
        <text
          key={label.role}
          x={label.x}
          y={label.y}
          className="text-[11px] transition-opacity duration-micro"
          fill={colors[label.role]}
          opacity={dimmed(label.role)}
          style={LABEL_STYLE}
        >
          {label.text}
        </text>
      ))}
    </svg>
  );
}

/** The marked rating: a rounded band labelled `label` ("You"). */
function MarkBand({ chart, label }: { chart: PredictionChart; label: string }) {
  if (!chart.markBand) return null;
  return (
    <g>
      <rect
        x={chart.markBand.x}
        y={chart.plot.top - 6}
        width={chart.markBand.width}
        height={chart.plot.bottom - chart.plot.top + 12}
        rx={Math.min(6, chart.markBand.width / 2)}
        className="fill-fg/[0.06]"
      />
      <text
        x={chart.markBand.x + chart.markBand.width / 2}
        y={chart.plot.top - 9}
        textAnchor="middle"
        className="fill-fg-muted text-[10px]"
        style={TEXT_STYLE}
      >
        {label}
      </text>
    </g>
  );
}

/** The pointed-at rating: a faint square band and a guide down its middle. */
function HoverColumn({ chart, index }: { chart: PredictionChart; index: number }) {
  const x = chart.xTicks[index]?.x ?? chart.plot.left;
  return (
    <g>
      <rect
        x={x - chart.bandWidth / 2}
        y={chart.plot.top}
        width={chart.bandWidth}
        height={chart.plot.bottom - chart.plot.top}
        className="fill-fg/[0.04]"
      />
      <line
        x1={x}
        x2={x}
        y1={chart.plot.top}
        y2={chart.plot.bottom}
        className="stroke-fg-subtle"
        strokeWidth={1}
      />
    </g>
  );
}

/** The dashed grid, the % axis and the ratings (the marked one in bold; some unwritten when dense). */
function Grid({ chart }: { chart: PredictionChart }) {
  return (
    <g>
      {chart.yTicks.map((tick) => (
        <g key={tick.label}>
          <line
            x1={chart.plot.left}
            x2={chart.plot.right}
            y1={tick.y}
            y2={tick.y}
            strokeDasharray="3 3"
            className="stroke-line"
          />
          <text
            x={chart.plot.left - 7}
            y={tick.y + 3.5}
            textAnchor="end"
            className="fill-fg-subtle text-[10px]"
            style={TEXT_STYLE}
          >
            {tick.label}
          </text>
        </g>
      ))}
      {chart.xTicks.map((tick) => (
        <g key={tick.rating}>
          <line
            x1={tick.x}
            x2={tick.x}
            y1={chart.plot.top}
            y2={chart.plot.bottom}
            strokeDasharray="3 3"
            className="stroke-line"
          />
          {tick.label ? (
            <text
              x={tick.x}
              y={chart.height - 6}
              textAnchor="middle"
              className={tick.marked ? "fill-fg text-[10.5px]" : "fill-fg-subtle text-[10.5px]"}
              style={tick.marked ? LABEL_STYLE : TEXT_STYLE}
            >
              {tick.rating}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

/**
 * A point of a line, ringed in the box's colour so crossing lines stay apart: a diamond for the
 * move played, a dot for the best (drawn last, so it shows inside a diamond it meets), a ring for
 * Maia's pick. `scale`: larger at the pointed-at rating, smaller where the points crowd.
 */
function Marker({
  x,
  y,
  role,
  scale
}: {
  x: number;
  y: number;
  role: PredictionRole;
  scale: number;
}) {
  if (role === "maia")
    return (
      <circle
        cx={x}
        cy={y}
        r={3.5 * scale}
        strokeWidth={2}
        stroke="currentColor"
        className="fill-surface-sunken"
      />
    );
  const filled = { fill: "currentColor", strokeWidth: 2, className: "stroke-surface-sunken" };
  if (role === "best") return <circle cx={x} cy={y} r={4.5 * scale} {...filled} />;
  const half = 4.5 * scale;
  return (
    <rect
      x={x - half}
      y={y - half}
      width={half * 2}
      height={half * 2}
      rx={1.5}
      transform={`rotate(45 ${x} ${y})`}
      {...filled}
    />
  );
}

/**
 * The pointed-at rating's values, most likely first, in the Winning chances tooltip's look: beside
 * the rating, flipped to its left in the plot's right half so it stays in the panel.
 */
function ColumnTooltip({
  chart,
  lines,
  index,
  colors
}: {
  chart: PredictionChart;
  lines: readonly PredictionLine[];
  index: number;
  colors: Record<PredictionRole, string>;
}) {
  const x = chart.xTicks[index]?.x ?? chart.plot.left;
  const left = x > chart.width / 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1 z-10 grid gap-0.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-2xs text-fg-muted shadow-popover"
      style={{ left: x, transform: left ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
    >
      <p className="font-mono text-xs text-fg-secondary">{chart.xTicks[index]?.rating}</p>
      {columnValues(lines, index).map((row) => (
        <p key={row.role} className="flex items-center gap-1.5 whitespace-nowrap">
          <LegendMarker role={row.role} color={colors[row.role]} />
          {PREDICTION_ROLE_NAMES[row.role]}
          <span className="font-mono font-medium text-fg">
            <FigurineSan san={row.san} />
          </span>
          <span className="ml-auto pl-2 font-mono text-fg-secondary tabular-nums">
            {percent(row.value)}
          </span>
        </p>
      ))}
    </div>
  );
}
