import { Pause, Play, Settings, Stethoscope, X } from "lucide-react";
import type { RepertoireHealthQueueStatus } from "@chaturanga/shared/types/repertoire-health";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Progress } from "@/components/ui/progress";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useRepertoireHealthQueueMutation } from "../../../queries/repertoire-health";
import { useOpenSettings } from "../../settings/settings-link";
import { queueHeadline } from "./explorer-view";

const queueActive = (status: RepertoireHealthQueueStatus | undefined) =>
  Boolean(status && (status.current || status.queued.length));

/**
 * The health queue's controls (the MyGamesCard's): Run check for `repertoireIds`, and while the
 * queue has work, Pause / Resume and Cancel.
 */
export function HealthQueueActions({
  status,
  repertoireIds
}: {
  status: RepertoireHealthQueueStatus | undefined;
  repertoireIds: string[];
}) {
  const queue = useRepertoireHealthQueueMutation();
  const active = queueActive(status);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={queue.isPending || !repertoireIds.length}
        onClick={() => queue.mutate({ action: "check", repertoireIds })}
      >
        <Stethoscope />
        Run check
      </Button>
      {active ? (
        <>
          <IconButton
            label={status?.paused ? "Resume" : "Pause"}
            icon={status?.paused ? <Play /> : <Pause />}
            size="icon-xs"
            disabled={queue.isPending}
            onClick={() => queue.mutate({ action: status?.paused ? "resume" : "pause" })}
          />
          <IconButton
            label="Cancel"
            icon={<X />}
            size="icon-xs"
            disabled={queue.isPending}
            onClick={() => queue.mutate({ action: "cancel" })}
          />
        </>
      ) : null}
      {queue.isError ? (
        <span className="text-xs text-danger" role="alert">
          {ipcErrorMessage(queue.error) || "The health check didn't answer."}
        </span>
      ) : null}
    </>
  );
}

/**
 * What the queue is doing (with its progress), or why it stopped: no usable default engine, with
 * Open Settings (Engines) where that is fixed (then Run check tries again). Nothing while it is
 * idle.
 */
export function HealthQueueLine({ status }: { status: RepertoireHealthQueueStatus | undefined }) {
  const openSettings = useOpenSettings();
  if (!status) return null;
  const headline = queueHeadline(status);
  const current = status.current;
  return (
    <>
      {status.problem ? (
        <p className="flex items-center gap-2 text-xs leading-5 text-fg-muted">
          <span className="min-w-0 flex-1">{status.problem}</span>
          {openSettings ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0"
              onClick={() => openSettings("engines")}
            >
              <Settings />
              Open Settings
            </Button>
          ) : null}
        </p>
      ) : null}
      {headline ? (
        <div className="grid animate-fade-in gap-1.5" role="status">
          <span className="truncate text-xs tabular-nums text-fg-muted">{headline}</span>
          {current?.total && !status.paused ? (
            <Progress value={(current.done / current.total) * 100} aria-label={headline} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
