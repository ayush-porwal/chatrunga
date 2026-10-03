import type { QueryClient } from "@tanstack/react-query";
import type { RepertoireDecision, RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { adoptDecisionSave, invalidateDecisions, repertoireKeys } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  decisionDraftHoldsBack,
  decisionDraftPatch,
  decisionDraftWritable,
  decisionWriteFailure
} from "./repertoire-model";

/*
 * Saving the decision changes made in study (the workspace store's `decisionDrafts`): practice
 * prompts and hints, wrong-move feedback, and pausing a decision.
 * A draft is cleared only once the main process confirms its write; a refusal keeps the text with
 * its error (stale when the repertoire moved on, which waits for the player's choice like a stale
 * chapter draft does). Navigation and window-close flushes save pending drafts but never retry a
 * failed one on their own: that is Retry's job. A navigation is held back only by the drafts of
 * the repertoire it leaves or uses; another repertoire's are written too, and a failure there
 * waits on that repertoire's study page (its titlebar and notices offer Retry, Keep mine and
 * Discard). A draft whose repertoire was deleted is dropped. One whose position left the
 * repertoire (its move undone, its line deleted) keeps its text with Discard, is tried again by
 * every flush (it saves once the move is back) and holds back no navigation.
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
 * Writes one draft (queued behind any running repertoire write): the one write path of every save,
 * flush, Retry and Keep mine. True once it is saved (or was already); false while it stays
 * unsaved: refused now, waiting for a chapter that can't be saved first, or failed earlier and not
 * `retry`ing (decisionDraftWritable: a stale refusal is never retried here). A draft committed
 * again while its write ran is written again as soon as that write settles.
 */
export async function saveDecisionText(
  queryClient: QueryClient,
  key: string,
  options: { flushChapter: FlushChapter; retry?: boolean }
): Promise<boolean> {
  const { saved, writeAgain } = await queueRepertoireWrite(() =>
    writeDecisionText(queryClient, key, options)
  );
  return writeAgain ? saveDecisionText(queryClient, key, { ...options, retry: true }) : saved;
}

type WriteOutcome = { saved: boolean; writeAgain: boolean };

async function writeDecisionText(
  queryClient: QueryClient,
  key: string,
  { flushChapter, retry = false }: { flushChapter: FlushChapter; retry?: boolean }
): Promise<WriteOutcome> {
  const unsaved = { saved: false, writeAgain: false };
  const draft = workspace().decisionDrafts[key];
  if (!draft) return { saved: true, writeAgain: false };
  if (!decisionDraftWritable(draft, retry)) return unsaved;
  const api = window.chaturanga?.repertoires;
  if (!api) {
    refuse(key, "Saving needs the desktop app.");
    return unsaved;
  }
  // The position may so far exist only in the open chapter's unsaved draft: that saves first
  // (its own error shows in the save status; the text waits, pending).
  if (workspace().repertoireId === draft.repertoireId && !(await flushChapter(queryClient))) {
    return unsaved;
  }
  const current = workspace().decisionDrafts[key];
  if (!current) return { saved: true, writeAgain: false };
  workspace().updateDecisionDraft(key, { type: "saving" });
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
    const writeAgain = workspace().updateDecisionDraft(key, {
      type: "saved",
      generation: current.generation
    });
    return { saved: !workspace().decisionDrafts[key], writeAgain };
  } catch (error) {
    return refuse(key, ipcErrorMessage(error) || "That change couldn't be saved.");
  }
}

/**
 * The one place a refused write (or Keep mine's refused read, `stale`) is settled, by what the
 * main process's message means (decisionWriteFailure): the repertoire was deleted, so all of its
 * drafts are dropped (saved: nothing is left to hold back leaving); otherwise the draft keeps its
 * text with the error.
 */
function refuse(key: string, message: string, options?: { stale?: boolean }): WriteOutcome {
  const failure = decisionWriteFailure(message, options);
  if (failure === "repertoire-gone") {
    const draft = workspace().decisionDrafts[key];
    if (draft) discardRepertoireTexts(draft.repertoireId);
    return { saved: true, writeAgain: false };
  }
  const writeAgain = workspace().updateDecisionDraft(key, { type: "failed", error: failure });
  return { saved: false, writeAgain };
}

/** Drops every draft of a deleted repertoire. */
function discardRepertoireTexts(repertoireId: string): void {
  for (const [key, draft] of Object.entries(workspace().decisionDrafts)) {
    if (draft.repertoireId === repertoireId) workspace().discardDecisionText(key);
  }
}

/**
 * Saves every pending draft (of any repertoire). True when none of `blockOn`'s repertoires (every
 * repertoire when omitted, as for closing the window) is left with a draft that holds back leaving
 * it (decisionDraftHoldsBack): another repertoire's draft is written too, but a failure there
 * doesn't hold back this navigation.
 */
export async function flushDecisionTexts(
  queryClient: QueryClient,
  flushChapter: FlushChapter,
  blockOn?: readonly string[]
): Promise<boolean> {
  const drafts = Object.entries(workspace().decisionDrafts);
  const saved = await Promise.all(
    drafts.map(async ([key, draft]) => {
      if (await saveDecisionText(queryClient, key, { flushChapter })) return true;
      if (blockOn === undefined) return false;
      const left = workspace().decisionDrafts[key];
      return !blockOn.includes(draft.repertoireId) || !left || !decisionDraftHoldsBack(left);
    })
  );
  return saved.every(Boolean);
}

/**
 * Drops the drafts of repertoires that were deleted: those missing from `listed` (the hub's list)
 * whose repertoire can't be found either (an archived one isn't listed but still exists).
 */
export async function discardDeletedRepertoireTexts(
  queryClient: QueryClient,
  listed: readonly string[]
): Promise<void> {
  const unlisted = new Set(
    Object.values(workspace().decisionDrafts)
      .map((draft) => draft.repertoireId)
      .filter((id) => !listed.includes(id))
  );
  await Promise.all(
    [...unlisted].map(async (repertoireId) => {
      try {
        await readDetail(queryClient, repertoireId);
      } catch (error) {
        if (decisionWriteFailure(ipcErrorMessage(error)) === "repertoire-gone") {
          discardRepertoireTexts(repertoireId);
        }
      }
    })
  );
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
      const message = ipcErrorMessage(error) || "The repertoire couldn't be read.";
      return refuse(key, message, { stale: true }).saved;
    }
  }
  workspace().updateDecisionDraft(key, { type: "retry", stale: true });
  return saveDecisionText(queryClient, key, { flushChapter, retry: true });
}

/** Drops the change; the stored value shows again (re-read, in case it changed). */
export function discardDecisionText(queryClient: QueryClient, key: string): void {
  const draft = workspace().decisionDrafts[key];
  if (!draft) return;
  workspace().discardDecisionText(key);
  invalidateDecisions(queryClient, draft.repertoireId);
}
