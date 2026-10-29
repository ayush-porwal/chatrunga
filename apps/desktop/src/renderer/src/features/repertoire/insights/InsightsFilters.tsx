import { useId } from "react";
import { ChipButton } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RATING_MODE_LABELS,
  RATING_MODES,
  type RatingMode
} from "@chaturanga/shared/types/ratings";
import {
  INSIGHTS_ACCOUNTS,
  INSIGHTS_PERIODS,
  type InsightsAccount,
  type InsightsFilters as Filters,
  type InsightsPeriod,
  type InsightsReport
} from "@chaturanga/shared/types/repertoire-insights";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { well } from "@/lib/ui";
import {
  useInsightsFiltersQuery,
  useSetInsightsFiltersMutation
} from "../../../queries/repertoire-insights";
import { PERIOD_LABELS } from "./insights-format";

const ACCOUNT_LABELS: Record<InsightsAccount, string> = {
  lichess: "Lichess",
  chesscom: "Chess.com",
  imported: "Imported"
};

/** Today as the date input writes it (local). */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `items` with `item` added or taken out, in `order`'s order. */
function toggled<T extends string>(items: readonly T[], item: T, order: readonly T[]): T[] {
  const next = items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
  return order.filter((value) => next.includes(value));
}

/**
 * Insights' Filters strip (sunken): period, time controls and accounts with their game counts,
 * rated or casual. Saved at once; weak-spots practice and the Study explorer use them too.
 */
export function InsightsFiltersStrip({ counts }: { counts: InsightsReport | undefined }) {
  const periodId = useId();
  const filters = useInsightsFiltersQuery();
  const save = useSetInsightsFiltersMutation();
  if (!filters.data) {
    return (
      <div className={`${well} flex flex-wrap items-center gap-3 px-4 py-3`} aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-72" />
      </div>
    );
  }
  const value = filters.data;
  const update = (patch: Partial<Filters>) => save.mutate({ ...value, ...patch });
  const setPeriod = (period: InsightsPeriod) =>
    update({ period, since: period === "since" ? (value.since ?? today()) : null });

  return (
    <section aria-label="Filters" className={`${well} grid gap-2 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={periodId} className="sr-only">
            Period
          </label>
          <Select
            id={periodId}
            className="h-8 w-auto text-xs"
            value={value.period}
            onChange={(event) => {
              if (isOneOf(INSIGHTS_PERIODS, event.target.value)) setPeriod(event.target.value);
            }}
          >
            {INSIGHTS_PERIODS.map((period) => (
              <option key={period} value={period}>
                {PERIOD_LABELS[period]}
              </option>
            ))}
          </Select>
          {value.period === "since" ? (
            <Input
              type="date"
              aria-label="Since"
              className="h-8 w-auto text-xs"
              value={value.since ?? ""}
              max={today()}
              onChange={(event) => {
                if (event.target.value) update({ since: event.target.value });
              }}
            />
          ) : null}
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Time controls"
        >
          {RATING_MODES.map((mode: RatingMode) => (
            <ChipButton
              key={mode}
              selected={value.timeControls.includes(mode)}
              onClick={() =>
                update({ timeControls: toggled(value.timeControls, mode, RATING_MODES) })
              }
            >
              {RATING_MODE_LABELS[mode]}
              {counts ? (
                <span className="tabular-nums text-fg-subtle">
                  {counts.timeControlCounts[mode]}
                </span>
              ) : null}
            </ChipButton>
          ))}
        </div>
        <SegmentedControl
          ariaLabel="Rated games"
          size="sm"
          value={value.ratedOnly ? "rated" : "all"}
          onChange={(rated) => update({ ratedOnly: rated === "rated" })}
          options={[
            { value: "all", label: "Rated + casual" },
            { value: "rated", label: "Rated only" }
          ]}
        />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Accounts">
          {INSIGHTS_ACCOUNTS.map((account) => (
            <ChipButton
              key={account}
              selected={value.accounts.includes(account)}
              onClick={() =>
                update({ accounts: toggled(value.accounts, account, INSIGHTS_ACCOUNTS) })
              }
            >
              {ACCOUNT_LABELS[account]}
              {counts ? (
                <span className="tabular-nums text-fg-subtle">{counts.accountCounts[account]}</span>
              ) : null}
            </ChipButton>
          ))}
        </div>
      </div>
      <p className="text-2xs text-fg-subtle">
        Saved; also used by weak-spots practice and the Study explorer.
      </p>
    </section>
  );
}
