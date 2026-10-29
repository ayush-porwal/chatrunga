import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useMinuteClock } from "@/lib/use-minute-clock";
import {
  useRepertoireHealthStatus,
  useRepertoireHealthSummaries
} from "../../../queries/repertoire-health";
import { CardTitleBar } from "../../play/card-title";
import { healthCountBadges, healthStateText } from "./explorer-view";
import { HealthQueueActions, HealthQueueLine } from "./HealthQueue";

/**
 * Insights → "Repertoire health" (docs/repertoire-games-and-practice.md §5.2, §6.3; UI §2f): a row
 * per repertoire with its flags by kind and its place in the queue, and Open (Study's Explorer at
 * its health flags, `onOpen`). The title bar runs the check on every repertoire, and pauses or
 * cancels it; without a usable engine the card says so, with Open Settings.
 */
export function RepertoireHealthCard({ onOpen }: { onOpen: (repertoireId: string) => void }) {
  const summaries = useRepertoireHealthSummaries();
  const status = useRepertoireHealthStatus();
  const rows = summaries.data ?? [];
  const now = useMinuteClock();
  return (
    <section
      aria-labelledby="insights-health-title"
      className="flex min-w-0 flex-col border-t border-line-subtle"
    >
      <CardTitleBar
        id="insights-health-title"
        title="Repertoire health"
        className="border-b border-line-subtle"
        actions={
          <HealthQueueActions
            status={status.data}
            repertoireIds={rows.map((row) => row.repertoireId)}
          />
        }
      />
      <div className="grid gap-2 p-4">
        <HealthQueueLine status={status.data} />
        {summaries.isPending ? (
          <div className="grid gap-2" aria-busy="true">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-7 w-full" />
            ))}
          </div>
        ) : null}
        {summaries.isError ? (
          <p className="flex items-center gap-2 text-xs text-danger">
            <span className="min-w-0 flex-1">
              Couldn&apos;t read the health check:{" "}
              {ipcErrorMessage(summaries.error) || "unknown error"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void summaries.refetch()}
            >
              <RotateCcw />
              Try again
            </Button>
          </p>
        ) : null}
        {summaries.data && !rows.length ? (
          <p className="text-xs text-fg-muted">No repertoires to check yet.</p>
        ) : null}
        {rows.length ? (
          <ul className="grid" aria-label="Repertoires">
            {rows.map((row) => {
              const badges = healthCountBadges(row);
              return (
                <li
                  key={row.repertoireId}
                  className="flex min-h-10 min-w-0 items-center gap-2 border-t border-line-subtle text-xs first:border-t-0"
                >
                  <span className="min-w-0 truncate font-medium text-fg">{row.name}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {badges.map((badge) => (
                      <Badge key={badge} tone="warn">
                        {badge}
                      </Badge>
                    ))}
                    {!badges.length && row.checkedAt !== null ? (
                      <Badge tone="accent">No flags</Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-2xs text-fg-subtle">
                    {healthStateText(row, status.data, now)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Open ${row.name}'s health`}
                    onClick={() => onOpen(row.repertoireId)}
                  >
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
