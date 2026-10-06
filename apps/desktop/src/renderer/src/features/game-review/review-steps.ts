/**
 * The review footer's one button, which walks the user through the key insights.
 *
 * The state rule: the label and target depend only on where the current move is relative to
 * the key insights, and on whether the user has started stepping through them in this review
 * session (a flag the button sets when it goes to an insight and clears when Finish returns to
 * the summary).
 * - Not started: "Start review", to the first insight (wherever the board is).
 * - Started, with an insight after the current move: "Next insight · N of M", to the first
 *   insight after the current move by ply. It follows the move the user is on, so navigating
 *   elsewhere never repeats an insight or steps backwards.
 * - Started, at or past the last insight: "Finish review", back to the summary; started again
 *   from the first insight after that.
 */

export type ReviewStepTarget = { kind: "insight"; index: number } | { kind: "summary" };

export type ReviewStepAction = { label: string; target: ReviewStepTarget };

/**
 * What the button says and where it goes. `keyMomentPlies` are the key insights' plies in game
 * order (as `keyMoments` returns them); `currentPly` is the selected move's (0 at the start).
 * Null when there are no insights.
 */
export function reviewStepAction(
  keyMomentPlies: readonly number[],
  currentPly: number,
  started: boolean
): ReviewStepAction | null {
  const total = keyMomentPlies.length;
  if (!total) return null;
  if (!started) return { label: "Start review", target: { kind: "insight", index: 0 } };
  const next = keyMomentPlies.findIndex((ply) => ply > currentPly);
  if (next === -1) return { label: "Finish review", target: { kind: "summary" } };
  return {
    label: `Next insight · ${next + 1} of ${total}`,
    target: { kind: "insight", index: next }
  };
}
