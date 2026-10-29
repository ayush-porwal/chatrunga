import { useId, useState } from "react";
import { ListFilter, RotateCcw } from "lucide-react";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  RATING_MODE_LABELS,
  RATING_MODES,
  type RatingMode
} from "@chaturanga/shared/types/ratings";
import {
  DEFAULT_INSIGHTS_FILTERS,
  INSIGHTS_ACCOUNTS,
  INSIGHTS_PERIODS,
  type InsightsFilters as Filters,
  type InsightsPeriod,
  type InsightsReport
} from "@chaturanga/shared/types/repertoire-insights";
import { isOneOf } from "@chaturanga/shared/types/guards";
import {
  useInsightsFiltersQuery,
  useSetInsightsFiltersMutation
} from "../../../queries/repertoire-insights";
import { ActiveDot } from "../../play/recent-games-controls";
import { ACCOUNT_LABELS, filtersSummary, PERIOD_LABELS } from "./insights-format";

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
 * Insights' Filters (the funnel at the end of the hub card's tab bar): a dot while they leave
 * games out, named in its label ("Filters: Last 3 months · Blitz"). It opens the Filters dialog.
 */
export function InsightsFiltersButton({ counts }: { counts: InsightsReport | undefined }) {
  const filters = useInsightsFiltersQuery();
  const [open, setOpen] = useState(false);
  const summary = filters.data ? filtersSummary(filters.data) : null;
  return (
    <>
      <IconButton
        label={summary ? `Filters: ${summary}` : "Filters"}
        icon={
          <>
            <ListFilter />
            {summary ? <ActiveDot /> : null}
          </>
        }
        className="group/dot relative"
        disabled={!filters.data}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      {open && filters.data ? (
        <InsightsFiltersDialog
          value={filters.data}
          counts={counts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * The Filters dialog: period, time controls and accounts with their game counts, rated or
 * casual. Each change is saved at once (the report behind it follows); Reset counts every game.
 */
function InsightsFiltersDialog({
  value,
  counts,
  onClose
}: {
  value: Filters;
  counts: InsightsReport | undefined;
  onClose: () => void;
}) {
  const ids = { period: useId(), since: useId() };
  const save = useSetInsightsFiltersMutation();
  const update = (patch: Partial<Filters>) => save.mutate({ ...value, ...patch });
  const setPeriod = (period: InsightsPeriod) =>
    update({ period, since: period === "since" ? (value.since ?? today()) : null });
  return (
    <Dialog
      size="sm"
      title="Filters"
      description="Saved; weak-spots practice and the Study explorer use them too."
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={filtersSummary(value) === null}
            onClick={() => save.mutate(DEFAULT_INSIGHTS_FILTERS)}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Period" htmlFor={ids.period}>
          <div className="flex flex-wrap gap-2">
            <Select
              id={ids.period}
              className="w-auto"
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
                id={ids.since}
                type="date"
                aria-label="Since"
                className="w-auto"
                value={value.since ?? ""}
                max={today()}
                onChange={(event) => {
                  if (event.target.value) update({ since: event.target.value });
                }}
              />
            ) : null}
          </div>
        </Field>
        <Field label="Time controls">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time controls">
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
        </Field>
        <Field label="Games">
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
        </Field>
        <Field label="Accounts">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Accounts">
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
                  <span className="tabular-nums text-fg-subtle">
                    {counts.accountCounts[account]}
                  </span>
                ) : null}
              </ChipButton>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
