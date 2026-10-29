import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { useGameStore } from "../../stores/game-store";
import { EngineAnalysisPanel, type EnginePanelPosition } from "../analysis/EngineStatusPanel";
import { activeScratchLine } from "../game/scratch-line";
import { useReviewScratchAnalysis } from "./review-scratch-analysis";
import { playScratchMove } from "./scratch-moves";
import { VariationAnchorNote, type GoToLine, type VariationAnchor } from "./MoveLinks";

/** A live line's moves picked: played on from the board's position, into the scratch line. */
const playOnScratchLine: GoToLine = ({ moves }) => {
  for (const move of moves) if (!playScratchMove(move)) return;
};

const playLineLabel = (san: string) => `Play the line to ${san} on the board`;

/**
 * Game review's scratch line, for as long as the page is open: live analysis of its position
 * (switched off from the Engine tab; never while a review runs), and the Engine tab's view, the
 * returned function's: live analysis while a scratch line shows, else `stored` (the review's own
 * analysis of the move). Leaving the page on a scratch line puts the board back on the game move it
 * was tried from: the other boards show the game's own positions only.
 */
export function useReviewScratchLine({
  running,
  orientation,
  variationAnchor
}: {
  running: boolean;
  orientation: Color;
  variationAnchor: VariationAnchor | null;
}): (stored: ReactNode) => ReactNode {
  const [live, setLive] = useState(true);
  useReviewScratchAnalysis(live && !running);
  useEffect(
    () => () => {
      const game = useGameStore.getState();
      const line = activeScratchLine(game);
      if (line) game.goToNode(line.originNodeId);
    },
    []
  );
  const origin = useGameStore((state) => activeScratchLine(state)?.originNodeId ?? null);
  return useCallback(
    (stored: ReactNode) =>
      origin ? (
        <ReviewScratchEngine
          originNodeId={origin}
          orientation={orientation}
          live={live}
          onLiveChange={setLive}
          reviewRunning={running}
          variationAnchor={variationAnchor}
        />
      ) : (
        stored
      ),
    [live, orientation, origin, running, variationAnchor]
  );
}

/**
 * The Engine tab while the board shows a scratch line: live analysis of its position (the moves
 * tried are the user's own; the game's moves show the review's own analysis). Picking a move of a
 * line plays the line up to it on the board. The switch stops and resumes the search; while a
 * review runs it waits (the review has the engine's time).
 */
function ReviewScratchEngine({
  originNodeId,
  orientation,
  live,
  onLiveChange,
  reviewRunning,
  variationAnchor
}: {
  /** The game move the line was started from (the panels stay on it). */
  originNodeId: string;
  orientation: Color;
  /** Live analysis is switched on. */
  live: boolean;
  onLiveChange: (live: boolean) => void;
  reviewRunning: boolean;
  variationAnchor: VariationAnchor | null;
}) {
  const fen = useGameStore((state) => state.currentFen);
  const position = useMemo<EnginePanelPosition>(
    () => ({
      fen,
      nodeId: originNodeId,
      orientation,
      analysing: live && !reviewRunning,
      engineGame: false,
      onGoToLine: playOnScratchLine,
      goToLineLabel: playLineLabel
    }),
    [fen, live, orientation, originNodeId, reviewRunning]
  );
  return (
    <div className="scroll-area -mr-3 grid h-full min-h-0 auto-rows-max content-start gap-3 overflow-y-auto pr-3">
      {variationAnchor ? <VariationAnchorNote {...variationAnchor} /> : null}
      {reviewRunning ? (
        <Notice tone="info" title="The engine is reviewing the game">
          Live analysis of your moves starts once the review finishes.
        </Notice>
      ) : (
        <EngineAnalysisPanel
          position={position}
          headerAction={
            <Switch checked={live} aria-label="Live analysis" onCheckedChange={onLiveChange} />
          }
          linesHint="Click a move to play its line on the board."
        />
      )}
    </div>
  );
}
