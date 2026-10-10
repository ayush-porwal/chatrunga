import { memo, useMemo, useState } from "react";
import type { PuzzleRatingPoint, PuzzleThemeStat } from "@chaturanga/shared/types/puzzle-rating";
import { Disclosure } from "@/components/ui/disclosure";
import { Skeleton } from "@/components/ui/skeleton";
import { cardPadded, sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  usePuzzleRatingHistoryQuery,
  usePuzzleRatingSummaryQuery,
  usePuzzleThemeStatsQuery
} from "../../queries/puzzles";
import { formatPuzzleRating, formatRatingDelta } from "./PuzzleRatingLine";
import { formatPuzzleTag } from "./puzzle-set";

/** Themes listed under "By theme" (the most played first). */
const THEMES_SHOWN = 8;
const SPARK_HEIGHT = 44;

/**
 * The solver's local puzzle rating on the Puzzles page: the number (with "?" while provisional),
 * the change over the recent rated puzzles as a small line, counts, and the most played themes.
 */
export const PuzzleRatingCard = memo(function PuzzleRatingCard() {
  const summary = usePuzzleRatingSummaryQuery();
  const history = usePuzzleRatingHistoryQuery();
  const themes = usePuzzleThemeStatsQuery();
  const data = summary.data;
  const points = history.data ?? [];
  // The change across the line (from its first point to the latest).
  const recent = points.length
    ? Math.round(points[points.length - 1].rating) - Math.round(points[0].rating)
    : null;

  return (
    <section className={cn(cardPadded, "grid gap-3")} aria-labelledby="puzzle-rating-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="puzzle-rating-title" className={sectionTitle}>
          Your puzzle rating
        </h2>
        {data && data.ratedCount ? (
          <span className="text-2xs tabular-nums text-fg-subtle">{data.ratedCount} rated</span>
        ) : null}
      </div>
      {!data ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <div className="grid gap-1">
          <p className="flex items-baseline gap-2">
            <span
              className="text-3xl font-semibold tabular-nums text-fg"
              title={`Deviation ${Math.round(data.deviation)}`}
            >
              {formatPuzzleRating(data)}
            </span>
            {recent !== null && points.length > 1 ? (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  recent > 0 ? "text-accent-fg" : recent < 0 ? "text-danger" : "text-fg-subtle"
                )}
                title={`Change over the last ${points.length - 1} rated ${points.length === 2 ? "puzzle" : "puzzles"}`}
              >
                {formatRatingDelta(recent)}
              </span>
            ) : null}
          </p>
          <p className="text-xs leading-5 text-fg-muted">
            {data.ratedCount === 0
              ? "Solve Lichess puzzles to set it. Only your first try at each puzzle counts."
              : data.provisional
                ? "Provisional: a few more rated puzzles settle it."
                : `${data.attemptCount ? Math.round((100 * data.solvedCount) / data.attemptCount) : 0}% of ${data.attemptCount} puzzles solved.`}
          </p>
        </div>
      )}
      {points.length > 1 ? <RatingSparkline points={points} /> : null}
      {themes.data?.length ? (
        <Disclosure
          title="By theme"
          summary={`${themes.data.length} ${themes.data.length === 1 ? "theme" : "themes"}`}
        >
          <ThemeStats stats={themes.data.slice(0, THEMES_SHOWN)} />
        </Disclosure>
      ) : null}
    </section>
  );
});

/** The rating after each recent rated puzzle: a bare line (hover for the value). */
const RatingSparkline = memo(function RatingSparkline({ points }: { points: PuzzleRatingPoint[] }) {
  const data = useMemo(
    () => points.map((point) => ({ rating: Math.round(point.rating), at: point.at })),
    [points]
  );
  const [hover, setHover] = useState<number | null>(null);
  const min = Math.min(...data.map((point) => point.rating)) - 10;
  const max = Math.max(...data.map((point) => point.rating)) + 10;
  const span = Math.max(1, max - min);
  const x = (index: number) => (data.length === 1 ? 110 : 2 + (index / (data.length - 1)) * 216);
  const y = (rating: number) => 4 + (1 - (rating - min) / span) * (SPARK_HEIGHT - 8);
  const path = data
    .map(
      (point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.rating).toFixed(1)}`
    )
    .join(" ");
  const active = hover === null ? null : data[hover];
  return (
    <div
      className="relative min-w-0"
      style={{ height: SPARK_HEIGHT }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 220 ${SPARK_HEIGHT}`}
        className="h-full w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Rating over the last ${points.length} rated puzzles`}
      >
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={4}
            y2={SPARK_HEIGHT - 4}
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {hover !== null ? (
          /* A zero-length round-capped stroke stays circular under preserveAspectRatio="none",
             where a circle would stretch into an oval on any card that isn't exactly 220px wide. */
          <path
            d={`M${x(hover)} ${y(data[hover].rating)}h0`}
            stroke="var(--color-accent)"
            strokeWidth="6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex">
        {data.map((point, index) => (
          <div key={point.at} className="h-full flex-1" onMouseEnter={() => setHover(index)} />
        ))}
      </div>
      {active ? (
        <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs text-fg shadow-popover">
          <span className="font-semibold tabular-nums">{active.rating}</span>
          <span className="ml-1.5 text-fg-muted">{new Date(active.at).toLocaleDateString()}</span>
        </div>
      ) : null}
    </div>
  );
});

/** Per theme: rated puzzles, the share solved, and Lichess's performance figure. */
function ThemeStats({ stats }: { stats: PuzzleThemeStat[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-2xs text-fg-subtle">
        <tr>
          <th scope="col" className="pb-1 text-left font-normal">
            Theme
          </th>
          <th scope="col" className="pb-1 pr-2 text-right font-normal">
            Puzzles
          </th>
          <th scope="col" className="pb-1 pr-2 text-right font-normal">
            Solved
          </th>
          <th
            scope="col"
            className="pb-1 text-right font-normal"
            title="Lichess's performance: average puzzle rating − 500 + 1000 × the share solved"
          >
            Perf.
          </th>
        </tr>
      </thead>
      <tbody>
        {stats.map((stat) => (
          <tr key={stat.theme} className="border-b border-line-subtle last:border-0">
            <th
              scope="row"
              className="max-w-0 truncate py-1 pr-2 text-left font-normal text-fg-secondary"
              title={formatPuzzleTag(stat.theme)}
            >
              {formatPuzzleTag(stat.theme)}
            </th>
            <td className="py-1 pr-2 text-right tabular-nums text-fg-subtle">{stat.attempts}</td>
            <td className="py-1 pr-2 text-right tabular-nums text-fg-muted">
              {Math.round((100 * stat.solved) / stat.attempts)}%
            </td>
            <td className="py-1 text-right font-medium tabular-nums text-fg">
              {stat.performance ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
