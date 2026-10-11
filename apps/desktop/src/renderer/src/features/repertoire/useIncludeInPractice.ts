import { useState } from "react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { AcceptedAt } from "@chaturanga/shared/chess/repertoire-training";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { fetchPractisedElsewhere } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { currentIncludePlan, wideningQuestion } from "./training-explanations";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * "Include in practice" for the open chapter (the training notice's fix): makes it trainable,
 * first asking when that would widen what other chapters practise. `setError` is the page's
 * error line (cleared when it starts).
 */
export function useIncludeInPractice({
  repertoireId,
  chapterId,
  color,
  setError
}: {
  repertoireId: string;
  chapterId: string;
  color: RepertoireColor;
  setError: (message: string | null) => void;
}) {
  /**
   * "Include in practice" waiting on the player: it would add moves at positions other chapters
   * answer differently (the question, for this chapter), with what it read of the repertoire for
   * the chapter as it was at `generation`.
   */
  const [widening, setWidening] = useState<{
    chapterId: string;
    generation: number;
    question: string;
    acceptedAt: AcceptedAt;
  } | null>(null);
  const [including, setIncluding] = useState(false);
  // Reads what the other chapters practise where it accepts moves, so it accepts those moves
  // there; asks first when it would still add one where they practise another. The plan is for
  // the chapter as it is when it applies (currentIncludePlan).
  const includeInPractice = useEventCallback(async () => {
    setError(null);
    setWidening(null);
    setIncluding(true);
    try {
      const plan = await currentIncludePlan(
        color,
        () => {
          const { chapter, chapterId: open, generation } = workspace();
          return chapter && open === chapterId ? { chapter, generation } : null;
        },
        (keys) => fetchPractisedElsewhere(repertoireId, chapterId, keys)
      );
      if (!plan) return;
      if (plan.widened.length) {
        setWidening({
          chapterId,
          generation: plan.generation,
          question: wideningQuestion(buildChapterLookup({ tree: plan.chapter.tree }), plan.widened),
          acceptedAt: plan.acceptedAt
        });
      } else {
        workspace().makeChapterTrainable(plan.acceptedAt);
      }
    } catch (error) {
      setError(`Couldn't include the chapter in practice: ${ipcErrorMessage(error)}`);
    } finally {
      setIncluding(false);
    }
  });
  // A chapter edited since the question was asked is planned (and asked about) again.
  const confirmWidening = useEventCallback(() => {
    const asked = widening;
    setWidening(null);
    if (asked?.chapterId !== chapterId) return;
    if (workspace().generation === asked.generation) {
      workspace().makeChapterTrainable(asked.acceptedAt);
    } else {
      void includeInPractice();
    }
  });

  return {
    including,
    /** The question waiting on the player, for this chapter (else null). */
    widening: widening?.chapterId === chapterId ? widening.question : null,
    includeInPractice: () => void includeInPractice(),
    confirmWidening,
    cancelWidening: () => setWidening(null)
  };
}
