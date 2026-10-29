import type { DrawShape } from "@lichess-org/chessground/draw";
import type { BoardArrow, BoardHighlight, Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import { SideDot } from "@/components/ui/side-dot";
import { useEventCallback } from "@/lib/use-event-callback";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { BoardStage } from "../board/BoardWorkspace";
import { ControlledBoard } from "../board/ControlledBoard";
import { COLOR_LABELS } from "./repertoire-chapters";
import { lastMoveOf } from "./repertoire-model";
import { StudyEvalBar } from "./StudyEnginePanel";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Study's board at the selected node, both sides playable (a move the chapter doesn't have is
 * staged) and drawing on (not on a staged move, which isn't saved); the repertoire's arrows
 * (`repertoireArrows`) over it; the repertoire and chapter above it, and the eval bar while the
 * engine panel is open. No movetext under the board: moves live in the Moves tab (the row below stays empty so
 * the board keeps the shared stage geometry).
 */
export function StudyBoardStage({
  chapterTitle,
  color,
  node,
  orientation,
  engineOpen,
  staged,
  repertoireArrows
}: {
  chapterTitle: string;
  color: RepertoireColor;
  node: MoveNode;
  orientation: Color;
  engineOpen: boolean;
  /** The selected move is staged (drawing would have nowhere to be saved). */
  staged: boolean;
  repertoireArrows: readonly DrawShape[];
}) {
  const onMove = useEventCallback((uci: string, san: string, fenAfter: string) => {
    workspace().playMove(uci, san, fenAfter);
  });
  const onShapesChange = useEventCallback((arrows: BoardArrow[], highlights: BoardHighlight[]) => {
    const id = workspace().selectedNodeId;
    workspace().setShapes(id, arrows, highlights);
  });
  return (
    <BoardStage
      evalBar={
        engineOpen ? <StudyEvalBar fen={node.fenAfter} orientation={orientation} /> : undefined
      }
      top={
        <p className="flex h-8 min-w-0 items-center gap-2 text-sm text-fg-secondary">
          <SideDot color={color} />
          <span className="truncate">
            {COLOR_LABELS[color]} repertoire · {chapterTitle}
          </span>
        </p>
      }
      bottom={<span className="block h-8" />}
    >
      <ControlledBoard
        fen={node.fenAfter}
        orientation={orientation}
        movable="both"
        lastMove={lastMoveOf(node.uci)}
        arrows={node.arrows}
        highlights={node.highlights}
        onShapesChange={staged ? undefined : onShapesChange}
        autoShapes={repertoireArrows}
        onMove={onMove}
      />
    </BoardStage>
  );
}
