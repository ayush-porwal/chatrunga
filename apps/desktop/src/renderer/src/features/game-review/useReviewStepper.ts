import { useCallback, useState } from "react";
import type { KeyMoment } from "@chaturanga/shared/chess/key-moments";
import type { Color } from "@chaturanga/shared/types/chess";
import type { GameReview } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import type { ReviewTab } from "./review-utils";
import { reviewStepAction } from "./review-steps";

/**
 * The footer's review button: Start review (the first key moment, explained), Next insight
 * through the rest after the current move, then Finish review back to the summary; disabled
 * without key moments (rule: review-steps.ts). Started belongs to this review session: another
 * game, analysis or side starts over.
 */
export function useReviewStepper({
  moments,
  session,
  selectNode,
  onTabChange
}: {
  moments: readonly KeyMoment[];
  /** The review session: the game, the analysis shown and the side reviewed. */
  session: { gameId: string | null; review: GameReview | null; side: Color };
  selectNode: (nodeId: string) => void;
  onTabChange: (tab: ReviewTab) => void;
}) {
  const sessionKey = `${session.gameId ?? ""}|${session.review?.reviewId ?? ""}|${session.side}`;
  const [startedSessionKey, setStartedSessionKey] = useState<string | null>(null);
  // The selected move's ply (0 at the start): the next insight is the first one after it.
  const currentPly = useGameStore(
    (state) => state.moveTree.find((node) => node.id === state.currentNodeId)?.ply ?? 0
  );
  const step = reviewStepAction(
    moments.map((moment) => moment.ply),
    currentPly,
    startedSessionKey === sessionKey
  );
  const stepTarget = step.target;
  const stepThrough = useCallback(() => {
    if (!stepTarget) return;
    if (stepTarget.kind === "summary") {
      setStartedSessionKey(null);
      onTabChange("summary");
      return;
    }
    const moment = moments.at(stepTarget.index);
    if (!moment) return;
    setStartedSessionKey(sessionKey);
    selectNode(moment.nodeId);
    onTabChange("commentary");
  }, [moments, onTabChange, sessionKey, selectNode, stepTarget]);
  return { step, stepThrough };
}
