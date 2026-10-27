import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import type {
  DatabaseDownloadProgress,
  ExternalDatabaseSource,
  InstalledDatabase
} from "@chaturanga/shared/types/database";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { card } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { BoardThumbnail } from "../settings/board-thumbnail";
import {
  databaseAction,
  databaseFacts,
  databaseSample,
  downloadProgressText,
  type DatabaseAction,
  type DatabaseFact
} from "./database-card";

/**
 * Title bar, body (board picture + text) and one fixed action row: every state is this tall. The
 * "My games" card (MyGamesCard) is built from the same parts.
 */
export const cardShell = cn(card, "flex flex-col leading-[1.43]");
export const titleBar =
  "flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pl-4 pr-3";
export const body = "flex gap-4.5 p-4";
// Top-aligned: a stretched item would lose its square shape when the text beside it is taller.
export const board = "w-39 shrink-0 self-start";
export const footer = "mt-auto grid grid-rows-[2.5rem] px-4 pb-4";

export function DatabaseCard({
  source,
  installed,
  progress,
  starting,
  downloadDisabled,
  deleteDisabled,
  onDownload,
  onCancel,
  onDelete,
  onTrain
}: {
  source: ExternalDatabaseSource;
  installed: InstalledDatabase | undefined;
  progress: DatabaseDownloadProgress | undefined;
  /** This source's download was asked for and hasn't reported progress yet. */
  starting: boolean;
  downloadDisabled: boolean;
  deleteDisabled: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: (database: InstalledDatabase) => void;
  onTrain: (databaseId: string) => void;
}) {
  const sample = databaseSample(source.id);
  const facts = databaseFacts(source, installed);
  const action = databaseAction({ source, installed, progress, starting });
  const busy = starting || progress?.state === "downloading";

  return (
    <article className={cardShell}>
      <div className={titleBar}>
        <h2 className="min-w-0 truncate text-sm font-semibold text-fg" title={source.name}>
          {source.name}
        </h2>
        <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-[0.6875rem] font-semibold capitalize text-fg-muted">
          {source.kind}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {installed ? (
            <span className="mr-1 inline-flex animate-pop-in items-center gap-1.25 text-xs text-accent-fg [&>svg]:size-3.25 [&>svg]:text-accent">
              <CircleCheck />
              Downloaded
            </span>
          ) : null}
          {installed ? <CopyPathButton path={installed.filePath} /> : null}
          <IconLink label="Source page" href={source.pageUrl} icon={<ExternalLink />} />
          {installed ? (
            <OverflowMenu
              label={`${source.name} actions`}
              size="icon-xs"
              items={[
                {
                  label: busy ? "Downloading…" : "Download again",
                  icon: <Download />,
                  onSelect: onDownload,
                  disabled: downloadDisabled
                },
                {
                  label: "Delete",
                  icon: <Trash2 />,
                  onSelect: () => onDelete(installed),
                  disabled: deleteDisabled || busy,
                  destructive: true
                }
              ]}
            />
          ) : null}
        </div>
      </div>

      <div className={body}>
        <BoardThumbnail
          fen={sample.fen}
          orientation={sample.orientation}
          lastMove={sample.lastMove}
          rounded="md"
          className={board}
        />
        <div className="grid min-w-0 flex-1 content-start gap-3">
          <p className="text-[0.78125rem] text-fg-subtle">
            {source.provider}, {source.license}
          </p>
          <p className="text-[0.84375rem] leading-normal text-fg-muted">{source.description}</p>
          <FactsStrip facts={facts} />
        </div>
      </div>

      <div className={footer}>
        <ActionRow
          action={action}
          downloadDisabled={downloadDisabled}
          onDownload={onDownload}
          onCancel={onCancel}
          onTrain={installed ? () => onTrain(installed.id) : undefined}
        />
      </div>
    </article>
  );
}

/** A card's facts, side by side in one sunken strip (nothing without any). */
export function FactsStrip({ facts }: { facts: readonly DatabaseFact[] }) {
  if (!facts.length) return null;
  return (
    <dl
      className="grid rounded-[0.625rem] border border-line bg-surface-sunken"
      // Content-sized cells share the spare room, so a long value (a date) isn't cut short.
      style={{ gridTemplateColumns: `repeat(${facts.length}, auto)` }}
    >
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="grid min-w-0 gap-px px-3 py-2 not-first:border-l not-first:border-line-subtle"
        >
          <dt className="text-[0.6875rem] text-fg-subtle">{fact.label}</dt>
          <dd
            className="truncate text-[0.84375rem] font-semibold tabular-nums text-fg"
            title={fact.value}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ActionRow({
  action,
  downloadDisabled,
  onDownload,
  onCancel,
  onTrain
}: {
  action: DatabaseAction;
  downloadDisabled: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onTrain?: () => void;
}) {
  const row = "flex h-10 min-w-0 items-center gap-3";
  switch (action.kind) {
    case "downloading": {
      const text = downloadProgressText(action.progress);
      return (
        <div className={cn(row, "animate-fade-in")}>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Progress value={action.progress.percent} aria-label={text} />
            <span className="truncate text-xs tabular-nums text-fg-muted">{text}</span>
          </div>
          {action.progress.state === "downloading" ? (
            <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={onCancel}>
              <X />
              Cancel
            </Button>
          ) : null}
        </div>
      );
    }
    case "failed":
      return (
        <div className={row}>
          <span className="flex min-w-0 items-center gap-1.75 text-[0.8125rem] text-danger [&>svg]:size-3.75 [&>svg]:shrink-0">
            <CircleAlert />
            <span className="truncate">Download failed</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={downloadDisabled}
            onClick={onDownload}
          >
            <RotateCcw />
            Try again
          </Button>
        </div>
      );
    case "train":
      return (
        <div className={row}>
          <Button type="button" variant="primary" onClick={onTrain}>
            <Play />
            Train with this dataset
          </Button>
        </div>
      );
    case "download":
      return (
        <div className={row}>
          <Button type="button" variant="primary" disabled={downloadDisabled} onClick={onDownload}>
            {action.starting ? <Loader2 className="animate-spin" /> : <Download />}
            {action.starting ? "Starting download…" : "Download"}
          </Button>
        </div>
      );
    case "none":
      return <div className={row} />;
  }
}

/** Copies the installed file's path; the icon is a check for a moment once it's copied. */
function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  // A refused clipboard write just leaves the icon as it was.
  const copy = () =>
    navigator.clipboard.writeText(path).then(
      () => setCopied(true),
      () => undefined
    );
  return (
    <IconButton
      label={copied ? "Copied" : "Copy file path"}
      icon={copied ? <Check /> : <Copy />}
      size="icon-xs"
      className={cn(copied && "text-accent hover:text-accent")}
      onClick={() => void copy()}
    />
  );
}

/**
 * Icon-only external link styled like <IconButton> (ghost, tooltip + aria-label).
 * Local because IconButton renders a <button>; candidate for components/ui.
 */
function IconLink({ label, href, icon }: { label: string; href: string; icon: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-xs">
          <a href={href} target="_blank" rel="noreferrer" aria-label={label}>
            {icon}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** A card while the list of databases loads: the same parts at the same sizes. */
export function DatabaseCardSkeleton() {
  return (
    <div className={cardShell} aria-hidden="true">
      <div className={titleBar}>
        <Skeleton className="h-3.5 w-55" />
      </div>
      <div className={body}>
        <Skeleton className={cn(board, "aspect-square rounded-md")} />
        <div className="grid min-w-0 flex-1 content-start gap-3">
          <Skeleton className="h-2.75 w-1/2" />
          <Skeleton className="h-2.75" />
          <Skeleton className="h-2.75 w-4/5" />
          <Skeleton className="h-12 rounded-[0.625rem]" />
        </div>
      </div>
      <div className={footer}>
        <Skeleton className="h-9 w-30 self-center rounded-lg" />
      </div>
    </div>
  );
}
