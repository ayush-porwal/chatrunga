import { useState } from "react";
import { CircleAlert, CircleCheck, Download, ExternalLink, Loader2, RefreshCw, RotateCw } from "lucide-react";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { UpdateState } from "@chaturanga/shared/types/updates";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatLastChecked, updateAction, updateActionLabel, updateStatusText } from "@/lib/app-update";
import { checkForUpdates, runUpdateAction, useAppUpdate } from "@/lib/use-app-update";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useSetSetting } from "../settings/use-set-setting";
import { UpdateDialog } from "./UpdateDialog";

/** Settings → Updates: version, status + check, the update's action, and the two update settings. */
export function UpdatesSection({ appearance }: { appearance: AppSettings }) {
  const state = useAppUpdate();
  const setSetting = useSetSetting();
  const [notesOpen, setNotesOpen] = useState(false);
  const now = useMinuteClock();

  if (!state) {
    return (
      <section className={cn(cardPadded, "grid gap-3")}>
        <SectionHeader title="Updates" />
        <Skeleton className="h-10 w-full" />
      </section>
    );
  }

  const status = state.status;
  const action = updateAction(status);
  const disabled = state.mode === "disabled";
  const checking = status.kind === "checking";
  const hasNotes = "notes" in status && Boolean(status.notes);

  return (
    <section className={cn(cardPadded, "grid gap-2")}>
      <SectionHeader title="Updates" />
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1.5">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm text-fg-secondary">
            Chaturanga <span className="tabular-nums text-fg">{state.currentVersion}</span>
          </p>
          <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs leading-5 text-fg-muted">
            <StatusIcon state={state} />
            <span key={status.kind} className="min-w-0 animate-fade-in">
              {updateStatusText(state)}
              {!disabled && !checking ? <span className="text-fg-subtle"> · {formatLastChecked(state.lastCheckedAt, now)}</span> : null}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasNotes ? (
            <Button variant="link" size="sm" onClick={() => setNotesOpen(true)}>
              What’s new
            </Button>
          ) : null}
          {action ? (
            <Button variant="primary" size="sm" onClick={() => void runUpdateAction(action)}>
              {action === "install" ? <RotateCw /> : action === "open-download" ? <ExternalLink /> : <Download />}
              {updateActionLabel[action]}
            </Button>
          ) : null}
          {!disabled && status.kind !== "ready" && status.kind !== "downloading" ? (
            <Button variant="outline" size="sm" disabled={checking} onClick={() => void checkForUpdates()}>
              <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} />
              Check for updates
            </Button>
          ) : null}
        </div>
      </div>
      {status.kind === "downloading" ? (
        <div className="pb-1 animate-rise-in">
          <Progress value={status.percent} aria-label={`Downloading version ${status.version}`} />
        </div>
      ) : null}
      {disabled ? (
        <Notice tone="info" appear={false}>
          {status.kind === "disabled" ? status.message : state.modeReason}
        </Notice>
      ) : (
        <div className="grid divide-y divide-line-subtle border-t border-line-subtle">
          {state.mode === "auto" ? (
            <SettingRow
              label="Download updates automatically"
              htmlFor="setting-updates-auto-download"
              description="New versions download in the background; restart when it suits you."
              control={
                <Switch
                  id="setting-updates-auto-download"
                  checked={appearance.updatesAutoDownload}
                  onCheckedChange={(v) => setSetting("updatesAutoDownload", v)}
                />
              }
            />
          ) : null}
          <SettingRow
            label="Include beta releases"
            htmlFor="setting-updates-beta"
            description={
              state.allowPrerelease && !appearance.updatesIncludeBeta
                ? "On while you run a beta version."
                : "Try new features early. Betas may be less stable."
            }
            control={
              <Switch
                id="setting-updates-beta"
                checked={appearance.updatesIncludeBeta || state.allowPrerelease}
                disabled={state.allowPrerelease && !appearance.updatesIncludeBeta}
                onCheckedChange={(v) => setSetting("updatesIncludeBeta", v)}
              />
            }
          />
          {state.mode === "manual" && state.modeReason ? <p className="pt-2.5 text-xs leading-5 text-fg-subtle">{state.modeReason}</p> : null}
        </div>
      )}
      {notesOpen ? <UpdateDialog state={state} onClose={() => setNotesOpen(false)} /> : null}
    </section>
  );
}

function StatusIcon({ state }: { state: UpdateState }) {
  const kind = state.status.kind;
  if (kind === "checking" || kind === "downloading") return <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  if (kind === "up-to-date") return <CircleCheck className="size-3.5 shrink-0 text-accent" aria-hidden="true" />;
  if (kind === "error") return <CircleAlert className="size-3.5 shrink-0 text-warn" aria-hidden="true" />;
  if (kind === "available" || kind === "manual" || kind === "ready") return <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />;
  return null;
}
