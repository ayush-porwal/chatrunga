/**
 * The review charts' drawn layers (ReviewCharts.tsx lays them out): the winning chances with the
 * game's phases and marked moves, the difficulty and move-time strips, the move axis, the cursor
 * lines and the hover tooltip. They share one geometry, so one ply lines up in every view.
 */
import { Fragment, memo } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import { MoveMarkGlyph } from "../board/MoveMarkGlyph";
import {
  chartMark,
  type ChartPoint,
  type ChartTooltipRow,
  type ReviewChartData
} from "./review-charts";
import { STRIP_INSET, WIN_TOP } from "./review-chart-layout";
import { annotationTone } from "@/lib/ui";

/*
 * Geometry shared by the three views, so one x (a ply) lines up in all of them: each plot spans
 * [GUTTER, width - RIGHT] horizontally; the gutter holds the axis labels.
 */
export const GUTTER = 34;
const RIGHT = 6;
/** Space between two x-axis labels. */
const TICK_SPACING = 44;
const LABEL = { fontSize: 9 } as const;

const PHASE_LABELS = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" } as const;

export type Scale = { width: number; xMax: number; x: (ply: number) => number };

export function makeScale(width: number, xMax: number): Scale {
  const span = Math.max(1, width - GUTTER - RIGHT);
  const max = Math.max(1, xMax);
  return { width, xMax: max, x: (ply) => GUTTER + (ply / max) * span };
}

/** The ply at `x` pixels from the left of a view (the inverse of `scale.x`). */
export function plyAt(scale: Scale, x: number): number {
  const span = Math.max(1, scale.width - GUTTER - RIGHT);
  return ((x - GUTTER) / span) * scale.xMax;
}

/** The width of a bar (one per ply): the ply's slot less a small gap. */
function barWidth(scale: Scale): number {
  const slot = (scale.width - GUTTER - RIGHT) / scale.xMax;
  return Math.max(0.6, slot - Math.min(1, slot * 0.25));
}

function markFill(point: ChartPoint): string | null {
  const mark = chartMark(point.annotation);
  return mark ? annotationTone[mark].fill : null;
}

/** The current move's line (accent) and the hovered move's (subtle), through one view. */
export function Cursor({
  selectedX,
  hoverX,
  top,
  bottom
}: {
  selectedX: number | null;
  hoverX: number | null;
  top: number;
  bottom: number;
}) {
  return (
    <g pointerEvents="none">
      {hoverX !== null && hoverX !== selectedX ? (
        <line
          x1={hoverX}
          x2={hoverX}
          y1={top}
          y2={bottom}
          stroke="var(--color-fg-muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ) : null}
      {selectedX !== null ? (
        <line
          data-current-move
          x1={0}
          x2={0}
          y1={top}
          y2={bottom}
          stroke="var(--color-accent)"
          strokeWidth={1.4}
          style={{ transform: `translateX(${selectedX}px)` }}
          className="transition-transform duration-standard ease-enter"
        />
      ) : null}
    </g>
  );
}

/** The phases inside the axis: where each starts (as an x in plies) and its label. */
function phaseBands(data: ReviewChartData, xMax: number) {
  const { openingEnd, endgameStart } = data.phases;
  const middleEnd = Math.min(xMax, (endgameStart ?? xMax + 1) - 1);
  const bands: { from: number; to: number; label: string }[] = [];
  if (openingEnd >= 1)
    bands.push({ from: 0, to: Math.min(openingEnd, xMax), label: PHASE_LABELS.opening });
  if (openingEnd < middleEnd)
    bands.push({ from: openingEnd, to: middleEnd, label: PHASE_LABELS.middlegame });
  if (endgameStart !== null && endgameStart <= xMax)
    bands.push({ from: endgameStart - 1, to: xMax, label: PHASE_LABELS.endgame });
  return bands;
}

/** A label's width at the charts' 9px mono, with a little room. */
function labelRoom(label: string): number {
  return label.length * 5.6 + 6;
}

/**
 * An opening too short for its label (a game that left the book in a move or two) merges into the
 * axis start: no divider hugging the left edge, and the middlegame's label starts there.
 */
function tidyBands(bands: ReturnType<typeof phaseBands>, x: (ply: number) => number) {
  const first = bands.at(0);
  const second = bands.at(1);
  if (first?.label !== PHASE_LABELS.opening || !second) return bands;
  if (x(first.to) - x(first.from) >= labelRoom(first.label)) return bands;
  return [{ ...second, from: 0 }, ...bands.slice(2)];
}

export const WinningChancesLayer = memo(function WinningChancesLayer({
  data,
  scale,
  plot,
  reviewedSide
}: {
  data: ReviewChartData;
  scale: Scale;
  /** The plot's height (the view takes the charts area's spare height). */
  plot: number;
  reviewedSide: Color;
}) {
  // The moves the review has evaluated (every move but those a running review hasn't reached).
  const points = data.points.flatMap((point) =>
    point.whiteWin === null ? [] : [{ ...point, whiteWin: point.whiteWin }]
  );
  const { x } = scale;
  const bottom = WIN_TOP + plot;
  // The reviewed side's winning chances, drawn up from the bottom.
  const y = (point: { whiteWin: number }) => {
    const own = reviewedSide === "white" ? point.whiteWin : 100 - point.whiteWin;
    return WIN_TOP + (1 - own / 100) * plot;
  };
  const last = points.at(-1);
  const area = last
    ? `${points.map((point, index) => `${index ? "L" : "M"}${x(point.ply).toFixed(1)} ${y(point).toFixed(1)}`).join("")}L${x(last.ply).toFixed(1)} ${bottom}L${x(0)} ${bottom}Z`
    : "";
  const ownFill = reviewedSide === "white" ? "var(--color-eval-white)" : "var(--color-eval-black)";
  const otherFill =
    reviewedSide === "white" ? "var(--color-eval-black)" : "var(--color-eval-white)";
  const half = WIN_TOP + plot / 2;
  const bands = tidyBands(phaseBands(data, scale.xMax), x);
  return (
    <g>
      {last ? (
        <>
          <rect
            x={x(0)}
            y={WIN_TOP}
            width={Math.max(0, x(last.ply) - x(0))}
            height={plot}
            fill={otherFill}
          />
          <path d={area} fill={ownFill} />
        </>
      ) : null}
      <line
        x1={GUTTER}
        x2={scale.width - RIGHT}
        y1={half}
        y2={half}
        stroke="var(--color-fg-subtle)"
        strokeWidth={0.8}
        strokeDasharray="3 4"
      />
      {bands.map((band, index) => {
        const room = x(band.to) - x(band.from);
        return (
          <g key={band.label} data-phase={band.label}>
            {index > 0 ? (
              <line
                x1={x(band.from)}
                x2={x(band.from)}
                y1={1}
                y2={bottom}
                stroke="var(--color-fg-subtle)"
                strokeWidth={0.8}
              />
            ) : null}
            {room >= labelRoom(band.label) ? (
              <text x={x(band.from) + 3} y={9} {...LABEL} fill="var(--color-fg-muted)">
                {band.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {[100, 50, 0].map((value) => (
        <text
          key={value}
          x={GUTTER - 4}
          y={WIN_TOP + (1 - value / 100) * plot + 3}
          {...LABEL}
          fontSize={8.5}
          fill="var(--color-fg-subtle)"
          textAnchor="end"
        >
          {value}%
        </text>
      ))}
      {points.map((point) => {
        const fill = markFill(point);
        if (!fill) return null;
        const cx = x(point.ply);
        const cy = y(point);
        return (
          <g key={point.nodeId}>
            {point.key ? (
              <circle
                cx={cx}
                cy={cy}
                r={5.5}
                fill="none"
                stroke="var(--color-fg)"
                strokeWidth={1}
                opacity={0.85}
              />
            ) : null}
            <circle
              cx={cx}
              cy={cy}
              r={3.2}
              fill={fill}
              stroke="var(--color-canvas)"
              strokeWidth={0.9}
              data-ply={point.ply}
              data-annotation={chartMark(point.annotation) ?? undefined}
              data-key-moment={point.key ? "true" : undefined}
            />
          </g>
        );
      })}
    </g>
  );
});

export const DifficultyLayer = memo(function DifficultyLayer({
  points,
  scale,
  plot
}: {
  points: readonly ChartPoint[];
  scale: Scale;
  /** The plot's height (the strip's share of the charts area). */
  plot: number;
}) {
  const base = STRIP_INSET + plot;
  const width = barWidth(scale);
  return (
    <g>
      <text
        x={GUTTER - 4}
        y={STRIP_INSET + 7}
        {...LABEL}
        fill="var(--color-fg-subtle)"
        textAnchor="end"
      >
        hard
      </text>
      <text x={GUTTER - 4} y={base} {...LABEL} fill="var(--color-fg-subtle)" textAnchor="end">
        easy
      </text>
      <line x1={GUTTER} x2={scale.width - RIGHT} y1={base} y2={base} stroke="var(--color-line)" />
      {points.map((point) => {
        if (point.bestChance === null) return null;
        const height = Math.max(1, (1 - point.bestChance) * plot);
        return (
          <rect
            key={point.nodeId}
            x={scale.x(point.ply) - width / 2}
            y={base - height}
            width={width}
            height={height}
            rx={0.8}
            fill={markFill(point) ?? "var(--color-line-strong)"}
            data-ply={point.ply}
          />
        );
      })}
    </g>
  );
});

export const TimesLayer = memo(function TimesLayer({
  points,
  scale,
  plot
}: {
  points: readonly ChartPoint[];
  scale: Scale;
  /** The plot's height (the strip's share of the charts area). */
  plot: number;
}) {
  const middle = STRIP_INSET + plot / 2;
  const width = barWidth(scale);
  let longest = 0;
  for (const point of points) longest = Math.max(longest, point.spentMs ?? 0);
  return (
    <g>
      <text
        x={GUTTER - 4}
        y={STRIP_INSET + 7}
        {...LABEL}
        fill="var(--color-fg-subtle)"
        textAnchor="end"
      >
        White
      </text>
      <text
        x={GUTTER - 4}
        y={STRIP_INSET + plot}
        {...LABEL}
        fill="var(--color-fg-subtle)"
        textAnchor="end"
      >
        Black
      </text>
      <line
        x1={GUTTER}
        x2={scale.width - RIGHT}
        y1={middle}
        y2={middle}
        stroke="var(--color-line)"
      />
      {longest > 0
        ? points.map((point) => {
            if (point.spentMs === null || point.mover === null) return null;
            const height = Math.max(0.5, (point.spentMs / longest) * (plot / 2 - 1));
            const white = point.mover === "white";
            return (
              <rect
                key={point.nodeId}
                x={scale.x(point.ply) - width / 2}
                y={white ? middle - height : middle}
                width={width}
                height={height}
                fill={
                  markFill(point) ?? (white ? "var(--color-side-white)" : "var(--color-fg-subtle)")
                }
                data-ply={point.ply}
              />
            );
          })
        : null}
    </g>
  );
});

/** Ply numbers under the views, as many as fit. */
export const AxisLayer = memo(function AxisLayer({ scale }: { scale: Scale }) {
  const span = scale.width - GUTTER - RIGHT;
  const fit = Math.max(1, Math.floor(span / TICK_SPACING));
  const step = [1, 2, 5, 10, 20, 50, 100, 200].find((value) => scale.xMax / value <= fit) ?? 500;
  const ticks: number[] = [];
  for (let ply = 0; ply <= scale.xMax; ply += step) ticks.push(ply);
  return (
    <g>
      {ticks.map((ply) => (
        <text
          key={ply}
          x={scale.x(ply)}
          y={10}
          {...LABEL}
          fill="var(--color-fg-subtle)"
          textAnchor="middle"
        >
          {ply}
        </text>
      ))}
    </g>
  );
});

/**
 * The hovered move's tooltip, beside its line (to the left in the charts' right half): the move
 * and its mark, then its details as a table, labels left and values right.
 */
export function ChartTooltip({
  point,
  tooltip,
  x,
  width
}: {
  point: ChartPoint;
  tooltip: { title: string; rows: ChartTooltipRow[] };
  x: number;
  width: number;
}) {
  const left = x > width / 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-4 z-10 grid gap-1 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-2xs text-fg-muted shadow-popover"
      style={{
        left: x,
        // Never past the charts' edges (they clip it), however wide its rows make it.
        transform: left
          ? `translateX(max(calc(-100% - 10px), ${-x}px))`
          : `translateX(min(10px, calc(${width - x}px - 100%)))`
      }}
      data-chart-tooltip
    >
      <p className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-fg-secondary">
        {point.annotation ? (
          <svg viewBox="0 0 100 100" className="size-4 shrink-0" aria-hidden>
            <circle cx={50} cy={50} r={50} fill={annotationTone[point.annotation].fill} />
            <g fill="var(--color-mark-fg)" className="text-mark-fg">
              <MoveMarkGlyph annotation={point.annotation} />
            </g>
          </svg>
        ) : null}
        {tooltip.title}
      </p>
      {tooltip.rows.length ? (
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 whitespace-nowrap">
          {tooltip.rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd className="text-right font-mono text-fg-secondary tabular-nums">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
