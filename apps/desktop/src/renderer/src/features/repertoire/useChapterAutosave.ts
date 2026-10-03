import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ipcErrorMessage } from "@/lib/ipc-error";
import type { RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { adoptChapterSave, invalidateSummaries, repertoireKeys } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  discardDecisionText,
  flushDecisionTexts,
  keepDecisionText,
  retryDecisionTexts,
  saveDecisionText
} from "./decision-text-drafts";
import { autosaveStep, isMissingTargetError, isStaleRevisionError } from "./repertoire-model";

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
    // The repertoire was deleted: nothing left to save the draft into, so drop it rather than
    // block every later navigation on a save that can never succeed.
    if (isMissingTargetError(message)) workspace().reset();
    else workspace().saveFailed(message, isStaleRevisionError(message));
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
 * The chapter draft only: waits for the running save and writes any unsaved edits. True when the
 * draft is saved; false when a save error (or a refusal now) keeps it unsaved. For writes that
 * need the chapter's tree stored first; leaving the study draft uses flushChapterDraft.
 */
export async function flushChapterTree(queryClient: QueryClient): Promise<boolean> {
  if (inFlight) await inFlight;
  const { saveState } = workspace();
  if (saveState.status === "error") {
    if (!isMissingTargetError(saveState.message)) return false;
    workspace().reset();
    return true;
  }
  if (workspace().dirty) await saveChapterDraftNow(queryClient);
  const after = workspace();
  return !after.dirty && after.saveState.status !== "error";
}

/**
 * Everything study holds unsaved: the chapter draft, then the practice prompts and hints typed
 * at its positions (decision-text-drafts.ts). True when the chapter draft and the decision changes
 * of `blockOn`'s repertoires are saved (every repertoire's when omitted, as closing the window
 * needs); false when an error (or a refusal now) keeps one unsaved — callers stay put and show
 * Retry. Other repertoires' changes are written too without holding the caller back. A failed
 * write is not retried here.
 */
export async function flushChapterDraft(
  queryClient: QueryClient,
  blockOn?: readonly string[]
): Promise<boolean> {
  const chapterSaved = await flushChapterTree(queryClient);
  const textSaved = await flushDecisionTexts(queryClient, flushChapterTree, blockOn);
  return chapterSaved && textSaved;
}

/**
 * Why a flush of `repertoireId`'s study held the caller back (after flushChapterDraft returned
 * false): the chapter draft, its decision changes, or only decision changes refused as stale
 * (Retry can't save those: their notice on the chapter asks Keep mine or Discard). Null when
 * nothing of it is unsaved any more.
 */
export function unsavedStudyCause(
  repertoireId: string | null
): "chapter" | "decision" | "stale-decision" | null {
  const state = workspace();
  if (state.dirty || state.saveState.status === "error") return "chapter";
  const own = Object.values(state.decisionDrafts).filter(
    (draft) => draft.repertoireId === repertoireId
  );
  if (!own.length) return null;
  const failed = own.filter((draft) => draft.status === "error");
  return failed.length && failed.every((draft) => draft.error?.stale)
    ? "stale-decision"
    : "decision";
}

/**
 * The notice when a repertoire's prompt, hint, feedback or pause change held back `action` (e.g.
 * "Analyze"): Retry for a failed write; for one refused as stale, the chapter's notice decides.
 */
export function unsavedDecisionMessage(stale: boolean, action: string): string {
  return stale
    ? `A practice prompt, hint or other change in this repertoire was also changed elsewhere, so ${action} didn't open. ` +
        "Keep yours or discard it in the notice on the chapter, then try again."
    : `A practice prompt, hint or other change in this repertoire couldn't be saved, so ${action} didn't open. ` +
        "Your text is kept: retry, or discard it in the notice on the chapter.";
}

/** Writes a typed prompt or hint now (a failed one is retried). */
export function saveDecisionTextNow(queryClient: QueryClient, key: string): Promise<boolean> {
  return saveDecisionText(queryClient, key, { flushChapter: flushChapterTree, retry: true });
}

/** Retry for a repertoire's unsaved prompts and hints. */
export function retryDecisionTextsNow(
  queryClient: QueryClient,
  repertoireId: string
): Promise<boolean> {
  return retryDecisionTexts(queryClient, repertoireId, flushChapterTree);
}

/** Keep mine, after a stale refusal: saved over the newer prompt or hint. */
export function keepDecisionTextNow(queryClient: QueryClient, key: string): Promise<boolean> {
  return keepDecisionText(queryClient, key, flushChapterTree);
}

export { discardDecisionText };

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
    invalidateSummaries(queryClient);
    void queryClient.invalidateQueries({
      queryKey: repertoireKeys.detail(repertoireId),
      exact: true
    });
  } catch {
    // Only the "Continue studying" target is lost.
  }
}

/**
 * Saves a study draft that outlived its page (left while a save was failing, or a prompt or hint
 * whose write failed) when the window closes, so quitting from another page still saves it or
 * keeps the window open. Mount once.
 */
export function useChapterDraftCloseFlush(): void {
  const queryClient = useQueryClient();
  useEffect(
    () => window.chaturanga?.games.onFlushRequest?.(() => flushChapterDraft(queryClient)),
    [queryClient]
  );
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

  // Leaving the page saves what is left (the store outlives the page, so the saves complete),
  // then remembers where you were for "Continue studying" once the chapter is saved.
  useEffect(
    () => () => {
      void flushChapterTree(queryClient).then((saved) => {
        if (saved) void rememberStudyPosition(queryClient);
      });
      void flushDecisionTexts(queryClient, flushChapterTree);
    },
    [queryClient]
  );

  // Closing the window (or quitting) unmounts nothing: save the drafts and the study position then.
  useEffect(
    () =>
      window.chaturanga?.games.onFlushRequest?.(async () => {
        const saved = await flushChapterDraft(queryClient);
        if (saved) await rememberStudyPosition(queryClient);
        return saved;
      }),
    [queryClient]
  );

  // Practising or rehearsing from the page uses only its own repertoire.
  return {
    flush: () => {
      const { repertoireId } = workspace();
      return flushChapterDraft(queryClient, repertoireId ? [repertoireId] : []);
    }
  };
}
