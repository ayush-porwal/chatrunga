import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { withoutMoveSounds } from "../../app/useMoveSounds";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { markRapidNavigation } from "../board/board-motion";
import { activeBestLine } from "../game/best-line-cursor";
import {
  createAnalysisFollower,
  followTargetIndex,
  runEnding,
  type AnalysisFollower
} from "./analysis-follow";

/**
 * While a review runs on this page, the board follows its analysis (analysis-follow.ts): `line`
 * is the main line's node ids from the start, `moves` the reviewed moves shown. `paused`: the user
 * navigated away (or `pause`, a move the user picked, even the one shown); `resume` follows again.
 */
export function useAnalysisFollow(
  line: readonly string[],
  moves: readonly MoveReview[]
): { paused: boolean; pause: () => void; resume: () => void } {
  const runId = useReviewStore((state) => (state.status === "running" ? state.reviewId : null));
  // The run following was paused in (a new run starts unpaused).
  const [pausedRun, setPausedRun] = useState<string | null>(null);
  const followerRef = useRef<AnalysisFollower | null>(null);

  useEffect(() => {
    if (!runId) return;
    const game = useGameStore.getState();
    const follower = createAnalysisFollower({
      board: activeBestLine(game) ? null : game.currentNodeId,
      show: ({ nodeId, quiet }) => {
        const goTo = () => useGameStore.getState().goToNode(nodeId);
        if (!quiet) return goTo();
        // Catching up: the board snaps there, without a sound.
        markRapidNavigation();
        withoutMoveSounds(goTo);
      },
      onPausedChange: (paused) => setPausedRun(paused ? runId : null)
    });
    followerRef.current = follower;
    const unsubscribeGame = useGameStore.subscribe((state, previous) => {
      if (
        state.currentNodeId === previous.currentNodeId &&
        state.currentFen === previous.currentFen
      )
        return;
      follower.noteBoard(state.currentNodeId, Boolean(activeBestLine(state)));
    });
    // The run finished (its own result, not a stop or a detach): the board ends on its last move.
    const unsubscribeReview = useReviewStore.subscribe((state, previous) => {
      if (previous.status !== "running" || previous.reviewId !== runId) return;
      const ending = runEnding(previous, state, runId);
      if (ending === "running") return;
      const last = ending === "finished" ? state.review?.moves.at(-1) : undefined;
      if (last) follower.finish(last.nodeId);
      else follower.dispose();
    });
    return () => {
      unsubscribeReview();
      unsubscribeGame();
      follower.dispose();
      followerRef.current = null;
    };
  }, [runId]);

  const targetIndex = useMemo(() => followTargetIndex(line, moves), [line, moves]);
  useEffect(() => {
    followerRef.current?.update(line, targetIndex);
  }, [line, runId, targetIndex]);

  const pause = useCallback(() => followerRef.current?.pause(), []);
  const resume = useCallback(() => followerRef.current?.resume(), []);
  return { paused: runId !== null && pausedRun === runId, pause, resume };
}
