import { useQueryClient } from "@tanstack/react-query";
import type { RepertoireDecision } from "@chaturanga/shared/types/repertoire";
import { useEventCallback } from "@/lib/use-event-callback";
import {
  pendingDecisionDraft,
  useRepertoireWorkspaceStore
} from "../../stores/repertoire-workspace-store";
import { decisionDraftKey, decisionDraftMatches, type DecisionTextField } from "./repertoire-model";
import { saveDecisionTextNow } from "./useChapterAutosave";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Study's edits of the decision at the selected position (Notes: the prompt and hint, wrong-move
 * feedback, pausing): typed into a draft, which a commit writes. Nothing happens without a
 * position key.
 */
export function useDecisionDraftCommands({
  repertoireId,
  positionKey,
  decision
}: {
  repertoireId: string;
  positionKey: string | null;
  /** The decision shown at the position (a draft matching it is dropped instead of written). */
  decision: RepertoireDecision | null;
}) {
  const queryClient = useQueryClient();
  const changeDecisionText = useEventCallback((field: DecisionTextField, text: string) => {
    if (positionKey) workspace().setDecisionText(repertoireId, positionKey, field, text);
  });
  // Blur (or Add / Remove / the pause switch): a draft matching the stored decision is dropped;
  // any other is written now. One whose write is still running is marked to be written again
  // once that write settles (with what was typed meanwhile). A stale one waits for Discard /
  // Keep mine.
  const commitDecisionDraft = useEventCallback((key: string) => {
    const draft = pendingDecisionDraft(key);
    if (!draft) return;
    if (draft.status === "saving") {
      workspace().requestDecisionTextSaveAgain(key);
      return;
    }
    if (draft.status === "pending" && decisionDraftMatches(draft, decision)) {
      workspace().discardDecisionText(key);
      return;
    }
    void saveDecisionTextNow(queryClient, key);
  });
  const commitDecisionText = useEventCallback((field: DecisionTextField) => {
    if (positionKey) commitDecisionDraft(decisionDraftKey(repertoireId, positionKey, field));
  });
  const changeFeedback = useEventCallback((uci: string, text: string) => {
    if (positionKey) workspace().setWrongMoveFeedback(repertoireId, positionKey, uci, text);
  });
  const commitFeedback = useEventCallback((uci: string) => {
    if (positionKey) {
      commitDecisionDraft(decisionDraftKey(repertoireId, positionKey, "feedback", uci));
    }
  });
  const setPaused = useEventCallback((paused: boolean) => {
    if (!positionKey) return;
    workspace().setDecisionPaused(repertoireId, positionKey, paused);
    commitDecisionDraft(decisionDraftKey(repertoireId, positionKey, "paused"));
  });
  return { changeDecisionText, commitDecisionText, changeFeedback, commitFeedback, setPaused };
}
