import type {
  BackupImportPreview,
  BackupImportPreviewRepertoire
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Switch } from "@/components/ui/switch";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  canReplace,
  restoreDiffLine,
  restoreLossLines,
  restoreMetadataLine,
  type RestoreRowAction,
  type RestoreRowState
} from "./backup";
import { COLOR_LABELS, plural } from "./repertoire-chapters";

type ModeValue = RestoreRowState["mode"];

type Dispatch = (action: RestoreRowAction) => void;

/** The repertoires a backup holds, each with how (and whether) to restore it. */
export function BackupRepertoireList({
  preview,
  rows,
  dispatch
}: {
  preview: BackupImportPreview;
  rows: RestoreRowState[];
  dispatch: Dispatch;
}) {
  if (!preview.repertoires.length) {
    return <Notice tone="info">This backup has no repertoires.</Notice>;
  }
  return (
    <ul className="grid gap-2" aria-label="Repertoires in the backup">
      {preview.repertoires.map((item) => {
        const row = rows.find((entry) => entry.sourceId === item.sourceId);
        if (!row) return null;
        return (
          <BackupRepertoireRow key={item.sourceId} item={item} row={row} dispatch={dispatch} />
        );
      })}
    </ul>
  );
}

function BackupRepertoireRow({
  item,
  row,
  dispatch
}: {
  item: BackupImportPreviewRepertoire;
  row: RestoreRowState;
  dispatch: Dispatch;
}) {
  return (
    <li className={cn(well, "grid gap-2 p-3", !row.include && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          aria-label={`Restore ${item.name}`}
          checked={row.include}
          onChange={(event) =>
            dispatch({
              type: "include",
              sourceId: item.sourceId,
              include: event.target.checked
            })
          }
        />
        <SideDot color={item.color} size="md" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium text-fg">{item.name}</span>
          <span className="truncate text-xs text-fg-muted">
            {COLOR_LABELS[item.color]} · {plural(item.chapterCount, "chapter")} ·{" "}
            {plural(item.decisionCount, "decision")}
          </span>
        </span>
        {item.hasProgress ? <Badge>Has progress</Badge> : null}
      </div>
      {row.include ? <RestoreOptions item={item} row={row} dispatch={dispatch} /> : null}
    </li>
  );
}

/**
 * How an included repertoire is restored: as a new copy (named here) or over the existing one
 * (what replacing changes and loses), with or without its progress.
 */
function RestoreOptions({
  item,
  row,
  dispatch
}: {
  item: BackupImportPreviewRepertoire;
  row: RestoreRowState;
  dispatch: Dispatch;
}) {
  const otherColor = Boolean(item.existing) && !canReplace(item);
  const modeOptions: { value: ModeValue; label: string; disabled?: boolean }[] = [
    { value: "new-copy", label: "New copy" },
    { value: "replace", label: "Replace existing", disabled: !canReplace(item) }
  ];
  return (
    <div className="grid gap-2 pl-6">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel={`How to restore ${item.name}`}
          role="radiogroup"
          size="sm"
          value={row.mode}
          onChange={(mode) => dispatch({ type: "mode", sourceId: item.sourceId, mode })}
          options={modeOptions}
        />
        {item.hasProgress ? (
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <Switch
              checked={row.includeProgress}
              onCheckedChange={(includeProgress) =>
                dispatch({
                  type: "progress",
                  sourceId: item.sourceId,
                  includeProgress
                })
              }
              aria-label={`Include progress for ${item.name}`}
            />
            Include progress
          </label>
        ) : null}
      </div>
      {otherColor && item.existing ? (
        <p className="text-xs text-fg-muted">
          “{item.existing.name}” here is a{" "}
          {COLOR_LABELS[item.color === "white" ? "black" : "white"].toLowerCase()} repertoire, so
          this one can only be restored as a new copy.
        </p>
      ) : null}
      {row.mode === "replace" && item.existing ? (
        <ReplaceSummary
          item={item}
          existing={item.existing}
          restoringProgress={item.hasProgress && row.includeProgress}
        />
      ) : (
        <Input
          aria-label={`Name for the restored copy of ${item.name}`}
          className="h-8"
          value={row.newName}
          onChange={(event) =>
            dispatch({
              type: "name",
              sourceId: item.sourceId,
              newName: event.target.value
            })
          }
        />
      )}
    </div>
  );
}

/** What replacing the existing repertoire changes, and the practice history it discards. */
function ReplaceSummary({
  item,
  existing,
  restoringProgress
}: {
  item: BackupImportPreviewRepertoire;
  existing: NonNullable<BackupImportPreviewRepertoire["existing"]>;
  restoringProgress: boolean;
}) {
  const metadataLine = item.diff ? restoreMetadataLine(item.diff) : null;
  const lossLines = item.diff ? restoreLossLines(item.diff, restoringProgress) : [];
  return (
    <>
      <p className="text-xs text-fg-muted">
        Replaces “{existing.name}” (revision {existing.revision})
        {item.diff ? ` · ${restoreDiffLine(item.diff, restoringProgress)}` : ""}
        {metadataLine ? ` · ${metadataLine}` : ""}
      </p>
      {item.damaged ? (
        <Notice tone="warn" appear={false}>
          “{existing.name}” has a damaged chapter, so the changes can’t be listed. Its stored data
          is kept in the backup saved first.
        </Notice>
      ) : null}
      <Notice
        tone="danger"
        appear={false}
        title={lossLines.length ? `${lossLines.join(". ")}.` : undefined}
      >
        Replacing overwrites “{existing.name}”, and its practice history is lost. A backup of it is
        saved first.
      </Notice>
    </>
  );
}
