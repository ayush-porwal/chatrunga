import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type {
  ChapterKind,
  ImportPreview,
  ImportProgressEvent,
  ImportResult,
  ImportSelection
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useCancelImportMutation,
  useCommitImportMutation,
  usePreviewImportMutation,
  useRepertoireQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  progressCounts,
  progressPercent,
  progressPhaseLabel,
  startPreviewRun,
  stepPreviewRun,
  type PreviewRun
} from "./import-progress";
import { plural } from "./repertoire-chapters";
import { nodeIdForPathLabel } from "./repertoire-model";

/** The default selection of each previewed game: included, its proposed title, opening kind. */
export function defaultSelections(preview: ImportPreview): ImportSelection[] {
  return preview.games.map((game) => ({
    gameIndex: game.index,
    title: game.proposedTitle,
    kind: "opening",
    include: game.nodeCount > 0,
    excludeNodeIds: []
  }));
}

/**
 * Import PGN into a repertoire (design §10): paste or open a file, preview every game (title,
 * kind, moves, warnings and the illegal branches left out), then commit the selected games as
 * chapters in one step. While the PGN is parsed (in a worker) its progress shows with a Cancel
 * button; closing before the commit cancels the pending or running job.
 */
export function ImportPgnDialog({
  repertoireId,
  onClose,
  onImported
}: {
  repertoireId: string;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const detail = useRepertoireQuery(repertoireId);
  const previewMutation = usePreviewImportMutation();
  const commitMutation = useCommitImportMutation();
  const { mutate: cancelJobMutation } = useCancelImportMutation();
  /**
   * Cancels a pending job. After the dialog closed the hook's mutate may no longer run, so the API
   * is called directly then (best effort: an uncancelled job only expires on its own).
   */
  const cancelJob = (jobId: string) => {
    if (open.current) cancelJobMutation(jobId);
    else void window.chaturanga?.repertoires.cancelImport(jobId).catch(() => undefined);
  };
  const [pgn, setPgn] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selections, setSelections] = useState<ImportSelection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pendingJob = useRef<string | null>(null);
  /** False once the dialog closed; a preview resolving after that cancels its job. */
  const open = useRef(true);
  /** Bumped per preview: an older preview resolving late cancels its own job. */
  const previewRequest = useRef(0);
  /** The running preview, with the jobId this dialog gave it; null when none runs. */
  const run = useRef<PreviewRun | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null);

  /** Leaves the running preview: its late result or rejection is ignored from now on. */
  const endRun = () => {
    run.current = null;
    previewRequest.current += 1;
    setPreviewing(false);
    setProgress(null);
  };

  // Closing (or unmounting) with a previewed, uncommitted job cancels it.
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      const jobId = pendingJob.current ?? run.current?.jobId;
      pendingJob.current = null;
      if (jobId) void window.chaturanga?.repertoires.cancelImport(jobId).catch(() => undefined);
    };
  }, []);

  // Progress of the running preview (matched by the jobId this dialog generated for it);
  // subscribed before any preview starts so no event is missed.
  useEffect(() => {
    const unsubscribe = window.chaturanga?.repertoires.onImportProgress?.((event) => {
      if (!run.current) return;
      const step = stepPreviewRun(run.current, event);
      if (step.kind === "update") {
        run.current = step.run;
        setProgress(step.run.latest);
      } else if (step.kind === "cancelled") {
        endRun();
      } else if (step.kind === "failed") {
        endRun();
        setError(step.error);
      }
    });
    return () => unsubscribe?.();
  }, []);

  const lookups = useMemo(
    () => preview?.games.map((game) => (game.tree.length ? buildChapterLookup(game) : null)) ?? [],
    [preview]
  );

  function runPreview(text: string) {
    setError(null);
    if (pendingJob.current) cancelJob(pendingJob.current);
    pendingJob.current = null;
    const request = ++previewRequest.current;
    const jobId = nanoid();
    run.current = startPreviewRun(jobId);
    setPreviewing(true);
    setProgress(null);
    // The promise (unlike per-call callbacks) settles after the dialog unmounts too.
    previewMutation.mutateAsync({ pgn: text, jobId }).then(
      (result) => {
        if (!open.current || request !== previewRequest.current) {
          cancelJob(result.jobId);
          return;
        }
        run.current = null;
        setPreviewing(false);
        setProgress(null);
        pendingJob.current = result.jobId;
        setPreview(result);
        setSelections(defaultSelections(result));
      },
      (cause) => {
        if (open.current && request === previewRequest.current) {
          run.current = null;
          setPreviewing(false);
          setProgress(null);
          setError(ipcErrorMessage(cause) || "That PGN couldn't be read.");
        }
      }
    );
  }

  /** Cancels the running preview and returns to the input. */
  function cancelPreview() {
    const current = run.current;
    if (!current) return;
    cancelJob(current.jobId);
    endRun();
  }

  async function chooseFile() {
    setError(null);
    try {
      const file = await window.chaturanga?.files.openPgnFile();
      if (!file) return;
      setPgn(file.contents);
      runPreview(file.contents);
    } catch (cause) {
      setError(ipcErrorMessage(cause) || "Couldn't open that file.");
    }
  }

  function commit() {
    if (!preview) return;
    // The study draft (if open) knows a newer revision than the cached detail after its saves.
    const workspace = useRepertoireWorkspaceStore.getState();
    const expectedRevision =
      workspace.repertoireId === repertoireId
        ? Math.max(workspace.baseRevision, detail.data?.revision ?? 0)
        : detail.data?.revision;
    if (expectedRevision === undefined) return;
    setError(null);
    commitMutation.mutate(
      { jobId: preview.jobId, repertoireId, selections, expectedRevision },
      {
        onSuccess: (result) => {
          pendingJob.current = null;
          if (workspace.repertoireId === repertoireId) {
            useRepertoireWorkspaceStore.getState().adoptRevision(result.repertoire.revision);
          }
          onImported(result);
        },
        onError: (cause) => setError(ipcErrorMessage(cause) || "The import couldn't be saved.")
      }
    );
  }

  const update = (index: number, patch: Partial<ImportSelection>) =>
    setSelections((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item))
    );

  const included = selections.filter((selection) => selection.include).length;
  const busy = previewing || commitMutation.isPending;

  return (
    <Dialog
      title="Import PGN"
      description={
        preview
          ? "Each game becomes a chapter. Choose what to import."
          : "Paste PGN or open a file; every game in it is read."
      }
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (pendingJob.current) cancelJob(pendingJob.current);
                pendingJob.current = null;
                setPreview(null);
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || !included || !detail.data}
              onClick={commit}
            >
              {commitMutation.isPending ? "Importing…" : `Import ${plural(included, "chapter")}`}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void chooseFile()}
            >
              <Upload />
              Choose file…
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || !pgn.trim()}
              onClick={() => runPreview(pgn)}
            >
              {previewing ? "Reading…" : "Preview"}
            </Button>
          </>
        )
      }
      bodyClassName="grid gap-3"
    >
      {preview ? (
        <ul className="grid gap-2" aria-label="Games in the PGN">
          {preview.games.map((game, index) => {
            const selection = selections[index];
            const lookup = lookups[index];
            if (!selection) return null;
            return (
              <li
                key={game.index}
                className={cn(well, "grid gap-2 p-3", !selection.include && "opacity-70")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    aria-label={`Import game ${game.index + 1}`}
                    checked={selection.include}
                    disabled={!game.nodeCount}
                    onChange={(event) => update(index, { include: event.target.checked })}
                  />
                  <Input
                    aria-label={`Chapter title for game ${game.index + 1}`}
                    className="h-8 min-w-40 flex-1"
                    value={selection.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                  />
                  <div className="w-36">
                    <Select
                      aria-label={`Chapter kind for game ${game.index + 1}`}
                      className="h-8"
                      value={selection.kind}
                      onChange={(event) =>
                        update(index, { kind: event.target.value as ChapterKind })
                      }
                    >
                      <option value="opening">Opening</option>
                      <option value="reference">Reference</option>
                    </Select>
                  </div>
                  <span className="text-xs text-fg-muted tabular-nums">
                    {plural(game.nodeCount, "move")}
                  </span>
                </div>
                {game.warnings.map((warning) => (
                  <p key={warning} className="text-2xs text-fg-muted">
                    {warning}
                  </p>
                ))}
                {game.invalidBranches.map((branch, branchIndex) => {
                  const parentId = lookup ? nodeIdForPathLabel(lookup, branch.path) : null;
                  const excluded = Boolean(
                    parentId && selection.excludeNodeIds?.includes(parentId)
                  );
                  return (
                    <div
                      key={`${branch.path}-${branchIndex}`}
                      className="flex items-start gap-2 text-xs text-fg-secondary"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0 text-warn"
                        aria-hidden="true"
                      />
                      <p className="min-w-0 flex-1">
                        <span className="font-mono">
                          {branch.path ? `${branch.path} ` : ""}
                          {branch.san}
                        </span>{" "}
                        — {branch.reason}
                        {excluded ? " The line leading to it is excluded too." : ""}
                      </p>
                      {parentId ? (
                        <Button
                          type="button"
                          variant="link"
                          size="xs"
                          onClick={() =>
                            update(index, {
                              excludeNodeIds: excluded
                                ? (selection.excludeNodeIds ?? []).filter((id) => id !== parentId)
                                : [...(selection.excludeNodeIds ?? []), parentId]
                            })
                          }
                        >
                          {excluded ? "Keep line" : "Exclude line"}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <Textarea
            aria-label="PGN text"
            autoFocus
            disabled={previewing}
            value={pgn}
            onChange={(event) => setPgn(event.target.value)}
            placeholder={'[Event "My 1.e4 repertoire"]\n\n1. e4 e5 2. Nf3 (2. Bc4) *'}
          />
          {previewing ? (
            <div className={cn(well, "grid gap-2 p-3")} role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-fg">{progressPhaseLabel(progress)}</span>
                <span className="text-fg-muted tabular-nums">{progressCounts(progress)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="ml-auto"
                  onClick={cancelPreview}
                >
                  Cancel
                </Button>
              </div>
              <Progress value={progressPercent(progress)} aria-label="Reading the PGN" />
            </div>
          ) : null}
        </>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
