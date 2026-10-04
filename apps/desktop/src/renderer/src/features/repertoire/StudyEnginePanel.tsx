import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { EngineAnalysisPanel, type EnginePanelPosition } from "../analysis/EngineStatusPanel";
import { engineHolder, type EngineHolder } from "../analysis/live-analysis";
import { EvalBarFill, liveAnalysisEval, useLiveAnalysisScore } from "../board/EvalBar";
import type { GoToLine } from "../game-review/MoveLinks";
import { NO_MOVES_TO_PLAY } from "./handoffs";
import { sanLineToUcis, studyAnalysisTarget } from "./study-engine";

/** Who holds the engine now (an engine game on the board, a Lichess game), read live. */
function useEngineHolder(): EngineHolder {
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const board = useGameStore(
    useShallow((state) => ({
      mode: state.mode,
      engineSide: state.engineSide,
      gameOutcome: state.gameOutcome
    }))
  );
  return engineHolder(board, onlineGameLive);
}

const restartSearch = () => useAnalysisStore.getState().restartSearch();
const addLineLabel = (san: string) => `Add the line to ${san} to the chapter`;

/**
 * Study's engine panel (opened by Analyze): live analysis of the selected move, following the
 * selection through the tree, with the Engine tab's lines. Picking a move of a line adds the line
 * up to it to the chapter at the selected move (one undo step; autosave saves it). While it is
 * mounted the selected move is live analysis's target; unmounting it (closing it, leaving Study,
 * another chapter) clears the target, which stops the search. A game holding the engine (an
 * engine game on the board, a Lichess game) keeps it: the panel says so instead of searching.
 */
export function StudyEnginePanel({
  id,
  chapter,
  node,
  orientation,
  onClose,
  onOpenSettings
}: {
  id: string;
  chapter: Pick<RepertoireChapter, "id" | "rootFen" | "tree">;
  node: MoveNode;
  orientation: Color;
  onClose: () => void;
  /** Offered when no engine is installed. */
  onOpenSettings?: () => void;
}) {
  const holder = useEngineHolder();
  const { id: chapterId, rootFen, tree } = chapter;
  const target = useMemo(
    () => studyAnalysisTarget({ id: chapterId, rootFen, tree }, node),
    [chapterId, rootFen, tree, node]
  );
  useEffect(() => {
    useAnalysisStore.getState().setTarget(target);
    return () => useAnalysisStore.getState().setTarget(null);
  }, [target]);

  /** A picked line that no longer fits the chapter (it changed under the line), for this move. */
  const [lineError, setLineError] = useState<{ nodeId: string; message: string } | null>(null);
  const playLine = useCallback<GoToLine>(
    ({ startNodeId, moves }) => {
      const start = tree.find((item) => item.id === startNodeId);
      const ucis = start ? sanLineToUcis(start.fenAfter, moves) : null;
      const added = ucis
        ? useRepertoireWorkspaceStore.getState().playLine(startNodeId, ucis)
        : null;
      setLineError(
        added ? null : { nodeId: startNodeId, message: "That line no longer fits this position." }
      );
    },
    [tree]
  );
  const position = useMemo<EnginePanelPosition>(
    () => ({
      fen: node.fenAfter,
      nodeId: node.id,
      orientation,
      analysing: true,
      engineGame: false,
      onGoToLine: playLine,
      goToLineLabel: addLineLabel
    }),
    [node.fenAfter, node.id, orientation, playLine]
  );
  const over = statusForFen(node.fenAfter).isEnd;
  const closeButton = (
    <IconButton label="Close the engine" icon={<X />} size="icon-sm" onClick={onClose} />
  );

  return (
    // Its natural height above the tab (header and the lines in full; the tab below takes the rest
    // and keeps its own minimum). Only past 60% of the body (many or unfolded lines) does it
    // scroll. A hovered move's preview floats beside the side panel, so it never grows this.
    <section
      id={id}
      aria-label="Engine analysis"
      className="scroll-area flex max-h-[60%] min-h-0 shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-line-subtle p-2.5"
    >
      {holder || over ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">Engine</h3>
            {closeButton}
          </div>
          {over ? (
            <EmptyState compact title={`${NO_MOVES_TO_PLAY}.`} />
          ) : holder === "engine-game" ? (
            <Notice tone="info" title="The engine is playing your game">
              Finish or resign the engine game on the board to analyse here.
            </Notice>
          ) : (
            // A Lichess game: the engine panel's own lock says why.
            <EngineAnalysisPanel position={position} />
          )}
        </>
      ) : (
        <EngineAnalysisPanel
          position={position}
          onStartAnalysis={restartSearch}
          onOpenSettings={onOpenSettings}
          headerAction={closeButton}
          linesHint="Click a move to add its line to the chapter."
          compact
        />
      )}
      {lineError?.nodeId === node.id ? <Notice tone="danger">{lineError.message}</Notice> : null}
    </section>
  );
}

/**
 * The eval bar beside the study board while the engine panel is open: live analysis of the
 * selected move (a finished position shows its result). Nothing while a game holds the engine.
 */
export function StudyEvalBar({ fen, orientation }: { fen: string; orientation: Color }) {
  const holder = useEngineHolder();
  const score = useLiveAnalysisScore();
  // Only the search of this position: right after another move is selected, the lines are still
  // the previous position's until its search starts (the bar holds its value meanwhile).
  const searchedFen = useAnalysisStore((state) => state.resultKey?.split("|")[0] ?? null);
  const evaluation = holder ? null : liveAnalysisEval(fen, searchedFen === fen ? score : null);
  return <EvalBarFill orientation={orientation} evaluation={evaluation} live={!holder} />;
}
