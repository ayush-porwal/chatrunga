/**
 * The review footer's one button, which walks the user through the key insights.
 *
 * The state rule: the label and target depend only on where the current move is relative to
 * the key insights, and on whether the user has started stepping through them in this review
 * session (a flag the button sets when it goes to an insight and clears when Finish returns to
 * the summary).
 * - No insights (a clean game for the side reviewed): "No key moments", going nowhere (disabled).
 * - Not started: "Start review", to the first insight (wherever the board is).
 * - Started, with an insight after the current move: "Next insight · N of M", to the first
 *   insight after the current move by ply. It follows the move the user is on, so navigating
 *   elsewhere never repeats an insight or steps backwards.
 * - Started, at or past the last insight: "Finish review", back to the summary; started again
 *   from the first insight after that.
 */

type ReviewStepTarget = { kind: "insight"; index: number } | { kind: "summary" };

/** Where the walk-through is, what the button says, and where it goes (null: nowhere, disabled). */
export type ReviewStepAction = {
  stage: "none" | "start" | "next" | "finish";
  label: string;
  target: ReviewStepTarget | null;
};

/**
 * What the button says and where it goes. `keyMomentPlies` are the key insights' plies in game
 * order (as `keyMoments` returns them); `currentPly` is the selected move's (0 at the start).
 */
export function reviewStepAction(
  keyMomentPlies: readonly number[],
  currentPly: number,
  started: boolean
): ReviewStepAction {
  const total = keyMomentPlies.length;
  if (!total) return { stage: "none", label: "No key moments", target: null };
  if (!started)
    return { stage: "start", label: "Start review", target: { kind: "insight", index: 0 } };
  const next = keyMomentPlies.findIndex((ply) => ply > currentPly);
  if (next === -1) return { stage: "finish", label: "Finish review", target: { kind: "summary" } };
  return {
    stage: "next",
    label: `Next insight · ${next + 1} of ${total}`,
    target: { kind: "insight", index: next }
  };
}
