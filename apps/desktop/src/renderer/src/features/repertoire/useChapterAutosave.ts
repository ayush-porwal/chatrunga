import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ipcErrorMessage } from "@/lib/ipc-error";
import type { RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { adoptChapterSave, repertoireKeys } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { autosaveStep, isStaleRevisionError } from "./repertoire-model";

/** Quiet time after the last edit before the draft is saved. */
export const AUTOSAVE_DELAY_MS = 800;

let inFlight: Promise<void> | null = null;

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Saves the current draft once against its base revision. The result replaces the draft only if
 * nothing was edited meanwhile (the store checks the generation); a refusal is kept as the save
 * error (stale when the repertoire moved on) and blocks autosave until the user decides.
 */
async function saveOnce(queryClient: QueryClient): Promise<void> {
  const state = workspace();
  if (!state.chapter || !state.repertoireId || !state.dirty) return;
  const api = window.chaturanga?.repertoires;
  if (!api) {
    state.saveFailed("Saving needs the desktop app.", false);
    return;
  }
  const generation = state.generation;
  state.markSaving();
  try {
    const result = await api.saveChapter({
      repertoireId: state.repertoireId,
      chapter: state.chapter,
      expectedRevision: state.baseRevision
    });
    adoptChapterSave(queryClient, result);
    workspace().saveSucceeded(result, generation);
  } catch (error) {
    const message = ipcErrorMessage(error) || "Couldn't save the chapter.";
    workspace().saveFailed(message, isStaleRevisionError(message));
  }
}

/** Saves the draft now (joining a save already running). */
export function saveChapterDraftNow(queryClient: QueryClient): Promise<void> {
  if (!inFlight) {
    inFlight = saveOnce(queryClient).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Waits for the running save and writes any unsaved edits. True when the draft is saved; false
 * when a save error (or a refusal now) keeps it unsaved — callers stay put and show Retry.
 */
export async function flushChapterDraft(queryClient: QueryClient): Promise<boolean> {
  if (inFlight) await inFlight;
  if (workspace().saveState.status === "error") return false;
  if (workspace().dirty) await saveChapterDraftNow(queryClient);
  const after = workspace();
  return !after.dirty && after.saveState.status !== "error";
}

/**
 * Stores the open chapter, node and orientation as the repertoire's workspace (Home's and the
 * hub's "Continue studying"), keeping its practice draft. Best effort: a failure only loses that.
 */
export async function rememberStudyPosition(queryClient: QueryClient): Promise<void> {
  const state = workspace();
  const api = window.chaturanga?.repertoires;
  if (!api || !state.repertoireId || !state.chapterId) return;
  const repertoireId = state.repertoireId;
  const detail = queryClient.getQueryData<RepertoireDetail>(repertoireKeys.detail(repertoireId));
  try {
    await api.saveWorkspace({
      repertoireId,
      workspace: {
        lastChapterId: state.chapterId,
        lastNodeId: state.selectedNodeId,
        orientation: state.orientation,
        practiceDraft: detail?.workspace?.practiceDraft ?? null
      }
    });
    void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
    void queryClient.invalidateQueries({
      queryKey: repertoireKeys.detail(repertoireId),
      exact: true
    });
  } catch {
    // Only the "Continue studying" target is lost.
  }
}

/**
 * Debounced autosave of the repertoire study draft (never through the game store). Saves
 * AUTOSAVE_DELAY_MS after the last edit, waits for a running save, stops on an error until it is
 * cleared, and flushes when the study page unmounts. Returns `flush` for navigation handoffs.
 */
export function useChapterAutosave(): { flush: () => Promise<boolean> } {
  const queryClient = useQueryClient();
  const dirty = useRepertoireWorkspaceStore((state) => state.dirty);
  const generation = useRepertoireWorkspaceStore((state) => state.generation);
  const saveState = useRepertoireWorkspaceStore((state) => state.saveState);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (autosaveStep({ dirty, saveState }) !== "schedule") return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void saveChapterDraftNow(queryClient);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [dirty, generation, saveState, queryClient]);

  // Leaving the page saves what is left (the store outlives the page, so the save completes),
  // then remembers where you were for "Continue studying".
  useEffect(
    () => () =>
      void flushChapterDraft(queryClient).then((saved) => {
        if (saved) void rememberStudyPosition(queryClient);
      }),
    [queryClient]
  );

  // Closing the window (or quitting) unmounts nothing: save the draft and the study position then.
  useEffect(
    () =>
      window.chaturanga?.games.onFlushRequest?.(async () => {
        const saved = await flushChapterDraft(queryClient);
        if (saved) await rememberStudyPosition(queryClient);
        return saved;
      }),
    [queryClient]
  );

  return { flush: () => flushChapterDraft(queryClient) };
}
