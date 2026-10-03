import type { QueryClient } from "@tanstack/react-query";
import type { RepertoireDecision, RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { adoptDecisionSave, invalidateDecisions, repertoireKeys } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { decisionDraftPatch, isNotFoundError, isStaleRevisionError } from "./repertoire-model";

/*
 * Saving the decision changes made in study (the workspace store's `decisionDrafts`): practice
 * prompts and hints, wrong-move feedback, and pausing a decision.
 * A draft is cleared only once the main process confirms its write; a refusal keeps the text with
 * its error (stale when the repertoire moved on, which waits for the player's choice like a stale
 * chapter draft does). Navigation and window-close flushes save pending drafts but never retry a
 * failed one on their own: that is Retry's job.
 */

const workspace = () => useRepertoireWorkspaceStore.getState();

/** Saves the open chapter draft (true once it is saved). */
export type FlushChapter = (queryClient: QueryClient) => Promise<boolean>;

let writes: Promise<unknown> = Promise.resolve();

/**
 * Runs repertoire writes one at a time, each once the previous one settled, so each sends the
 * revision the previous one returned. Shared by the study commands and the decision draft saves.
 */
export function queueRepertoireWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = writes.then(write);
  writes = next.catch(() => undefined);
  return next;
}

/** The revision a write to `repertoireId` expects: the open draft's, or the stored one. */
async function expectedRevision(queryClient: QueryClient, repertoireId: string): Promise<number> {
  const state = workspace();
  if (state.repertoireId === repertoireId) return state.baseRevision;
  return (await readDetail(queryClient, repertoireId)).revision;
}

function readDecision(
  queryClient: QueryClient,
  repertoireId: string,
  positionKey: string
): Promise<RepertoireDecision | null> {
  return queryClient.fetchQuery({
    queryKey: repertoireKeys.decision(repertoireId, positionKey),
    queryFn: () => window.chaturanga!.repertoires.getDecision({ repertoireId, positionKey }),
    staleTime: 0
  });
}

function readDetail(queryClient: QueryClient, repertoireId: string): Promise<RepertoireDetail> {
  return queryClient.fetchQuery({
    queryKey: repertoireKeys.detail(repertoireId),
    queryFn: () => window.chaturanga!.repertoires.get(repertoireId),
    staleTime: 0
  });
}

/**
 * Writes one draft (queued behind any running repertoire write). True once it is saved (or was
 * already); false while it stays unsaved: refused now, waiting for a chapter that can't be saved
 * first, or failed earlier and not `retry`ing (a stale refusal is never retried here).
 */
export function saveDecisionText(
  queryClient: QueryClient,
  key: string,
  { flushChapter, retry = false }: { flushChapter: FlushChapter; retry?: boolean }
): Promise<boolean> {
  return queueRepertoireWrite(async () => {
    const draft = workspace().decisionDrafts[key];
    if (!draft) return true;
    if (draft.status === "error" && (draft.error?.stale || !retry)) return false;
    const api = window.chaturanga?.repertoires;
    if (!api) {
      workspace().decisionTextFailed(key, "Saving needs the desktop app.", false);
      return false;
    }
    // The position may so far exist only in the open chapter's unsaved draft: that saves first
    // (its own error shows in the save status; the text waits, pending).
    if (workspace().repertoireId === draft.repertoireId && !(await flushChapter(queryClient))) {
      return false;
    }
    const current = workspace().decisionDrafts[key];
    if (!current) return true;
    const generation = workspace().markDecisionTextSaving(key)!;
    try {
      // Feedback replaces the position's whole map: it is merged into the stored one, read now
      // (after any earlier queued write), so feedback saved for other moves stays.
      const stored =
        current.field === "feedback"
          ? await readDecision(queryClient, current.repertoireId, current.positionKey)
          : null;
      const result = await api.updateDecision({
        repertoireId: current.repertoireId,
        positionKey: current.positionKey,
        expectedRevision: await expectedRevision(queryClient, current.repertoireId),
        patch: decisionDraftPatch(current, stored)
      });
      adoptDecisionSave(queryClient, result);
      if (workspace().repertoireId === result.repertoire.id) {
        workspace().adoptRevision(result.repertoire.revision);
        workspace().rememberDecision(result.decision);
      }
      workspace().decisionTextSaved(key, generation);
      return !workspace().decisionDrafts[key];
    } catch (error) {
      const message = ipcErrorMessage(error) || "That change couldn't be saved.";
      // The repertoire was deleted: the text has nowhere to go, and must not block leaving.
      if (isNotFoundError(message, "repertoire")) {
        workspace().discardDecisionText(key);
        return true;
      }
      workspace().decisionTextFailed(key, message, isStaleRevisionError(message));
      return false;
    }
  });
}

/** Saves every pending draft (of any repertoire). True when none is left unsaved. */
export async function flushDecisionTexts(
  queryClient: QueryClient,
  flushChapter: FlushChapter
): Promise<boolean> {
  const keys = Object.keys(workspace().decisionDrafts);
  const saved = await Promise.all(
    keys.map((key) => saveDecisionText(queryClient, key, { flushChapter }))
  );
  return saved.every(Boolean);
}

/** Retry: writes the repertoire's pending and failed drafts again (stale ones wait for a choice). */
export async function retryDecisionTexts(
  queryClient: QueryClient,
  repertoireId: string,
  flushChapter: FlushChapter
): Promise<boolean> {
  const keys = Object.entries(workspace().decisionDrafts)
    .filter(([, draft]) => draft.repertoireId === repertoireId)
    .map(([key]) => key);
  const saved = await Promise.all(
    keys.map((key) => saveDecisionText(queryClient, key, { flushChapter, retry: true }))
  );
  return saved.every(Boolean);
}

/**
 * After a stale refusal, "Keep mine": the write goes again against the repertoire's current
 * revision, replacing the newer stored value (as Keep editing does for a chapter draft).
 */
export async function keepDecisionText(
  queryClient: QueryClient,
  key: string,
  flushChapter: FlushChapter
): Promise<boolean> {
  const draft = workspace().decisionDrafts[key];
  if (!draft) return true;
  if (workspace().repertoireId === draft.repertoireId) {
    try {
      workspace().adoptRevision((await readDetail(queryClient, draft.repertoireId)).revision);
    } catch (error) {
      workspace().decisionTextFailed(
        key,
        ipcErrorMessage(error) || "The repertoire couldn't be read.",
        true
      );
      return false;
    }
  }
  workspace().clearDecisionTextError(key);
  return saveDecisionText(queryClient, key, { flushChapter, retry: true });
}

/** Drops the change; the stored value shows again (re-read, in case it changed). */
export function discardDecisionText(queryClient: QueryClient, key: string): void {
  const draft = workspace().decisionDrafts[key];
  if (!draft) return;
  workspace().discardDecisionText(key);
  invalidateDecisions(queryClient, draft.repertoireId);
}
