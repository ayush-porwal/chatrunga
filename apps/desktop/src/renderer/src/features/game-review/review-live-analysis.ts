/**
 * Game review's Analysis switch: live engine analysis of the board's position, the same session
 * the Analyze page runs (the game store's "analysis" mode, which useEngineDriver searches and the
 * eval bar reads). On, stepping through the moves analyses each one; off, the engine stops. The
 * choice holds for this session (as the Analyze page's analysis does), across games and reviews;
 * a review being run pauses it, as the engine is busy with the review.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { GameMode } from "@chaturanga/shared/types/chess";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";

export const useReviewAnalysisStore = create<{ on: boolean; setOn: (on: boolean) => void }>(
  (set) => ({ on: false, setOn: (on) => set({ on }) })
);

/**
 * The mode the review's board should be in for the switch: "analysis" while it's on (and no
 * review is running, and the engine can run at all), else "freeplay" if it's analysing; null to
 * leave the mode as it is.
 */
export function reviewAnalysisMode(input: {
  on: boolean;
  running: boolean;
  desktop: boolean;
  mode: GameMode;
}): "analysis" | "freeplay" | null {
  const wanted = input.on && !input.running && input.desktop;
  if (wanted) return input.mode === "analysis" ? null : "analysis";
  return input.mode === "analysis" ? "freeplay" : null;
}

function applyMode(mode: "analysis" | "freeplay", engineId: string | null): void {
  const game = useGameStore.getState();
  const analysis = useAnalysisStore.getState();
  if (mode === "analysis") {
    if (engineId && !analysis.activeEngineId) analysis.setActiveEngine(engineId);
    game.setMode("analysis");
    analysis.restartBoardSearch();
  } else {
    game.setMode("freeplay");
    analysis.setStatus("idle");
  }
}

/**
 * Keeps the review board's live analysis in step with the switch while the review shows, and
 * stops it when the review is left (the engine never searches behind another screen).
 */
export function useReviewLiveAnalysis(running: boolean, engineId: string | null): void {
  const on = useReviewAnalysisStore((state) => state.on);
  const mode = useGameStore((state) => state.mode);
  const desktop = Boolean(window.chaturanga);
  useEffect(() => {
    const next = reviewAnalysisMode({ on, running, desktop, mode });
    if (next) applyMode(next, engineId);
  }, [desktop, engineId, mode, on, running]);
  useEffect(
    () => () => {
      if (useGameStore.getState().mode === "analysis") applyMode("freeplay", null);
    },
    []
  );
}
