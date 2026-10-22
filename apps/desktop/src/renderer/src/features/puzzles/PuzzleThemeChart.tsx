import { memo, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { card } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { usePuzzleThemeStatsQuery } from "../../queries/puzzles";
import { CardTitleBar } from "../play/card-title";
import { themeRows } from "./rating-chart";

const TITLE_ID = "puzzle-themes-title";
/** Rows shown before Show all. */
const ROWS_SHOWN = 10;
const head = "h-9 px-4 text-left text-xs font-medium text-fg-muted first:pl-4";

/**
 * By theme: the rated puzzles of each theme, the most played first, as bars of the share solved,
 * with the count and Lichess's performance figure. With `onToggleTheme` (a Lichess set), a theme's
 * name adds it to the Themes filter or takes it out (`selected`: the themes filtered on).
 */
export const PuzzleThemeChart = memo(function PuzzleThemeChart({
  selected,
  onToggleTheme
}: {
  selected: readonly string[];
  onToggleTheme: ((theme: string) => void) | null;
}) {
  const stats = usePuzzleThemeStatsQuery();
  const rows = useMemo(() => themeRows(stats.data ?? []), [stats.data]);
  const [all, setAll] = useState(false);
  // No themes yet, or they couldn't be read: no card (an empty table would read as "no themes").
  if (stats.isError || (stats.isSuccess && !rows.length)) return null;
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  return (
    <section className={card} aria-labelledby={TITLE_ID}>
      <CardTitleBar id={TITLE_ID} title="By theme" count={rows.length || null} />
      {stats.isPending ? (
        <ThemeSkeleton />
      ) : (
        <table className="w-full table-fixed text-sm" aria-labelledby={TITLE_ID}>
          <thead>
            <tr className="border-y border-b-line border-t-line-subtle bg-surface-sunken">
              <th scope="col" className={cn(head, "w-[34%]")}>
                Theme
              </th>
              <th scope="col" className={head}>
                Solved
              </th>
              <th scope="col" className={cn(head, "w-20 text-right")}>
                Puzzles
              </th>
              <th
                scope="col"
                className={cn(head, "w-24 text-right")}
                title="Lichess's performance: average puzzle rating − 500 + 1000 × the share solved"
              >
                Perf.
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const on = selected.includes(row.theme);
              const percent = Math.round(row.share * 100);
              return (
                <tr key={row.theme} className="h-10 border-b border-line-subtle last:border-0">
                  <th scope="row" className="px-2 text-left font-normal">
                    {onToggleTheme ? (
                      <button
                        type="button"
                        aria-pressed={on}
                        title={on ? "Remove from the Themes filter" : "Add to the Themes filter"}
                        onClick={() => onToggleTheme(row.theme)}
                        className={cn(
                          "flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-left outline-none transition-colors duration-micro hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/70 [&_svg]:size-3.5 [&_svg]:shrink-0",
                          on ? "text-accent-fg" : "text-fg-secondary hover:text-fg"
                        )}
                      >
                        <span className="truncate">{row.label}</span>
                        {on ? <Check aria-hidden /> : null}
                      </button>
                    ) : (
                      <span className="block truncate px-2 text-fg-secondary">{row.label}</span>
                    )}
                  </th>
                  <td className="whitespace-nowrap px-4">
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-[calc(100%-3rem)] overflow-hidden rounded-full bg-control align-middle"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="inline-block w-12 text-right align-middle text-xs tabular-nums text-fg-secondary">
                      {percent}%
                    </span>
                  </td>
                  <td className="px-4 text-right text-xs tabular-nums text-fg-muted">
                    {row.attempts}
                  </td>
                  <td className="px-4 text-right text-xs font-medium tabular-nums text-fg">
                    {row.performance ?? "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > ROWS_SHOWN ? (
        <div className="border-t border-line-subtle px-2 py-1.5">
          <Button type="button" variant="ghost" size="xs" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
});

function ThemeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading themes">
      <div className="h-9 border-y border-b-line border-t-line-subtle bg-surface-sunken" />
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className="flex h-10 items-center gap-4 border-b border-line-subtle px-4 last:border-0"
        >
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-1.5 flex-1 rounded-full" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
