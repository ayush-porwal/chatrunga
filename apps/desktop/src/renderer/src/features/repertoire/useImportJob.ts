import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import type {
  CreateRepertoireInput,
  ImportPreview,
  ImportProgressEvent,
  ImportResult,
  ImportSelection
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  useCancelImportMutation,
  useCommitImportMutation,
  useCreateRepertoireMutation,
  usePreviewImportMutation,
  useRemoveChapterMutation,
  useRemoveRepertoireMutation
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { flushDecisionTexts } from "./decision-text-drafts";
import {
  adoptCommittedRevision,
  importExpectedRevision,
  mustFlushDraftBeforeImport,
  pgnSizeError,
  startPreviewRun,
  stepPreviewRun,
  type PreviewRun
} from "./import-progress";
import { flushChapterTree, flushChapterTreeInWrite } from "./useChapterAutosave";

/**
 * The import job of the Import PGN dialog: the PGN is previewed (parsed in a worker, with progress
 * and Cancel), then the selected games are committed in one step. Closing before the commit
 * cancels the pending or running job; the commit itself can't be cancelled once the writer has
 * started. Without `repertoireId` the import makes a new repertoire: it is created at the commit
 * (its empty first chapter removed after), and removed again when the commit fails.
 */
export function useImportJob({
  repertoireId,
  revision,
  onPreviewed,
  onImported
}: {
  /** The repertoire imported into; null for a new one, created by the commit. */
  repertoireId: string | null;
  /** The repertoire's revision as cached, which the commit expects unless a draft save moved it. */
  revision: number | undefined;
  /** A new preview arrived: its games are listed afresh. */
  onPreviewed: (preview: ImportPreview) => void;
  onImported: (result: ImportResult) => void;
}) {
  const queryClient = useQueryClient();
  const previewMutation = usePreviewImportMutation();
  const commitMutation = useCommitImportMutation();
  const createMutation = useCreateRepertoireMutation();
  const removeChapterMutation = useRemoveChapterMutation();
  const removeRepertoireMutation = useRemoveRepertoireMutation();
  const { mutate: cancelJobMutation } = useCancelImportMutation();
  /**
   * Cancels a pending job. After the dialog closed the hook's mutate may no longer run, so the API
   * is called directly then (best effort: an uncancelled job only expires on its own).
   */
  const cancelJob = (jobId: string) => {
    if (open.current) cancelJobMutation(jobId);
    else void window.chaturanga?.repertoires.cancelImport(jobId).catch(() => undefined);
  };
  const [preview, setPreview] = useState<ImportPreview | null>(null);
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
  /** True while the open study draft is saved before a commit. */
  const [flushing, setFlushing] = useState(false);

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

  function runPreview(text: string) {
    setError(null);
    const sizeError = pgnSizeError(text);
    if (sizeError) {
      setError(sizeError);
      return;
    }
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
        onPreviewed(result);
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

  /** Back to the input: the previewed job is cancelled. */
  function discardPreview() {
    if (pendingJob.current) cancelJob(pendingJob.current);
    pendingJob.current = null;
    setPreview(null);
  }

  /**
   * Imports into a new repertoire: creates it, commits into it, then removes its empty first
   * chapter; a failed commit removes the repertoire again (the job is kept for a retry).
   */
  async function commitNew(selections: ImportSelection[], create: CreateRepertoireInput) {
    if (!preview) return;
    setError(null);
    const jobId = preview.jobId;
    pendingJob.current = null;
    let created;
    try {
      created = await createMutation.mutateAsync(create);
    } catch (cause) {
      if (open.current) {
        pendingJob.current = jobId;
        setError(ipcErrorMessage(cause) || "Couldn't create the repertoire.");
      } else cancelJob(jobId);
      return;
    }
    const empty = created.chapters.at(0);
    try {
      const result = await commitMutation.mutateAsync({
        jobId,
        repertoireId: created.id,
        selections,
        expectedRevision: created.revision
      });
      const removed = empty
        ? await removeChapterMutation
            .mutateAsync({
              repertoireId: created.id,
              chapterId: empty.id,
              expectedRevision: result.repertoire.revision
            })
            .catch(() => null)
        : null;
      if (open.current)
        onImported(removed ? { ...result, repertoire: removed.repertoire } : result);
    } catch (cause) {
      removeRepertoireMutation.mutate({ id: created.id, expectedRevision: created.revision });
      if (!open.current) return cancelJob(jobId);
      pendingJob.current = jobId;
      setError(ipcErrorMessage(cause) || "The import couldn't be saved.");
    }
  }

  async function commit(selections: ImportSelection[], create?: CreateRepertoireInput) {
    if (!preview || flushing) return;
    if (repertoireId === null) {
      if (create) await commitNew(selections, create);
      return;
    }
    setError(null);
    // An import into the repertoire whose draft is open, or whose prompt, hint, feedback or pause
    // change is unsaved, saves those first, so no autosave or decision write runs (or comes due)
    // during the commit and races its revision bump; the commit then expects the revision those
    // saves stored. A chapter draft that can't be saved keeps the dialog open. A decision change
    // refused now stays on its chapter with Retry (nothing of it is written during the commit),
    // so it doesn't hold the import back.
    if (mustFlushDraftBeforeImport(useRepertoireWorkspaceStore.getState(), repertoireId)) {
      setFlushing(true);
      let saved: boolean;
      try {
        const ownDraft = useRepertoireWorkspaceStore.getState().repertoireId === repertoireId;
        saved = !ownDraft || (await flushChapterTree(queryClient));
        // Holds nothing back (no repertoire to block on): a refusal stays with its chapter.
        if (saved) await flushDecisionTexts(queryClient, flushChapterTreeInWrite, []);
      } finally {
        if (open.current) setFlushing(false);
      }
      if (!open.current) return;
      if (!saved) {
        setError("The open chapter couldn't be saved; retry its save, then import.");
        return;
      }
    }
    const expectedRevision = importExpectedRevision(
      useRepertoireWorkspaceStore.getState(),
      repertoireId,
      revision
    );
    if (expectedRevision === undefined) return;
    setError(null);
    // The job belongs to the commit now: unmounting meanwhile must not cancel it. A failed commit
    // keeps the job, so it is pending again (or cancelled when the dialog is gone).
    const jobId = preview.jobId;
    pendingJob.current = null;
    // The promise (unlike per-call callbacks) settles after the dialog unmounts too, so the open
    // draft adopts the new revision even when the user navigated away meanwhile.
    commitMutation.mutateAsync({ jobId, repertoireId, selections, expectedRevision }).then(
      (result) => {
        adoptCommittedRevision(
          useRepertoireWorkspaceStore.getState(),
          repertoireId,
          result.repertoire.revision
        );
        if (open.current) onImported(result);
      },
      (cause) => {
        if (!open.current) return cancelJob(jobId);
        pendingJob.current = jobId;
        setError(ipcErrorMessage(cause) || "The import couldn't be saved.");
      }
    );
  }

  const committing =
    flushing ||
    commitMutation.isPending ||
    createMutation.isPending ||
    removeChapterMutation.isPending;
  return {
    preview,
    error,
    setError,
    previewing,
    progress,
    committing,
    busy: previewing || committing,
    runPreview,
    cancelPreview,
    discardPreview,
    commit
  };
}

export type ImportJob = ReturnType<typeof useImportJob>;
