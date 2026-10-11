import type { ComponentProps, ReactNode } from "react";
import { Library, Plus, Search } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { listRowInteractive } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { COLOR_LABELS, plural, relativeDay } from "./repertoire-chapters";
import type { HubFilters } from "./useRepertoireHub";

type RowActions = ComponentProps<typeof OverflowMenu>["items"];

const colorOptions = [
  { value: "all" as const, label: "All" },
  { value: "white" as const, label: "White" },
  { value: "black" as const, label: "Black" }
];

export function HubFilterBar({ filters }: { filters: HubFilters }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        ariaLabel="Colour"
        size="sm"
        value={filters.color}
        onChange={filters.setColor}
        options={colorOptions}
      />
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search repertoires"
          placeholder="Search by name or tag"
          className="pl-8"
          value={filters.query}
          onChange={(event) => filters.setQuery(event.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <Switch
          checked={filters.archived}
          onCheckedChange={filters.setArchived}
          aria-label="Show archived repertoires"
        />
        Archived
      </label>
    </div>
  );
}

/** The filtered repertoires: placeholders while loading, the failure with Try again, or `empty`. */
export function RepertoireList({
  list,
  now,
  onStudy,
  actionsFor,
  empty
}: {
  list: UseQueryResult<RepertoireSummary[]>;
  /** When the hub opened: "Last studied" is relative to it. */
  now: number;
  onStudy: (repertoireId: string) => void;
  actionsFor: (item: RepertoireSummary) => RowActions;
  empty: ReactNode;
}) {
  if (list.isPending) {
    return (
      <div className="grid gap-2" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return (
      <Notice
        tone="danger"
        title="Couldn't load your repertoires"
        action={
          <Button type="button" variant="outline" size="xs" onClick={() => void list.refetch()}>
            Try again
          </Button>
        }
      >
        {ipcErrorMessage(list.error)}
      </Notice>
    );
  }
  if (!list.data.length) return empty;
  return (
    <ul className="grid gap-2" aria-label="Repertoires">
      {list.data.map((item) => (
        <li key={item.id} className="flex items-center gap-2">
          <button
            type="button"
            className={cn(listRowInteractive, "flex-1")}
            onClick={() => onStudy(item.id)}
            aria-label={`Study ${item.name}`}
          >
            <SideDot color={item.color} size="md" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-medium text-fg">{item.name}</span>
              <span className="truncate text-xs text-fg-muted">
                {COLOR_LABELS[item.color]} · {plural(item.chapterCount, "chapter")} ·{" "}
                {plural(item.decisionCount, "decision")} · Last studied{" "}
                {relativeDay(item.lastStudiedAt, now).toLowerCase()}
              </span>
              {item.tags.length ? (
                <span className="flex min-w-0 gap-1 overflow-hidden">
                  {item.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </span>
              ) : null}
            </span>
            {item.archivedAt ? <Badge>Archived</Badge> : null}
            {item.dueCount ? (
              <Badge tone="accent" size="md">
                {item.dueCount} due
              </Badge>
            ) : null}
          </button>
          <OverflowMenu label={`${item.name} actions`} items={actionsFor(item)} />
        </li>
      ))}
    </ul>
  );
}

/** No repertoire shown: none matches the filters, none is archived, or none exists yet. */
export function HubEmptyState({
  filters,
  onCreate
}: {
  filters: HubFilters;
  onCreate: () => void;
}) {
  const { archived, query, color } = filters;
  // Only an unfiltered hub with no repertoires at all suggests starting one.
  const narrowed = archived || Boolean(query) || color !== "all";
  return (
    <EmptyState
      icon={<Library />}
      title={
        archived
          ? "No archived repertoires"
          : narrowed
            ? "No repertoires match"
            : "No repertoires yet"
      }
      description={
        narrowed
          ? undefined
          : "Start one for each side you play — for example “My 1.e4 repertoire” or “Black against 1.e4”."
      }
      action={
        narrowed ? undefined : (
          <Button type="button" variant="primary" onClick={onCreate}>
            <Plus />
            Create repertoire
          </Button>
        )
      }
    />
  );
}
