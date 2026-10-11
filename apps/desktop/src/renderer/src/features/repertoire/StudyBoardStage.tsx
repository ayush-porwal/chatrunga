import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { BoardArrow, BoardHighlight, Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import { SideDot } from "@/components/ui/side-dot";
import { useEventCallback } from "@/lib/use-event-callback";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { BoardStage } from "../board/BoardWorkspace";
import { ControlledBoard } from "../board/ControlledBoard";
import { COLOR_LABELS } from "./repertoire-chapters";
import { lastMoveOf, pathLabel } from "./repertoire-model";
import { StudyEvalBar } from "./StudyEnginePanel";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Study's board at the selected node, both sides playable (a move adds to the chapter) and
 * drawing on; the repertoire and chapter above it, the route below, and the eval bar while the
 * engine panel is open.
 */
export function StudyBoardStage({
  chapterTitle,
  color,
  lookup,
  node,
  orientation,
  engineOpen
}: {
  chapterTitle: string;
  color: RepertoireColor;
  lookup: ChapterLookup;
  node: MoveNode;
  orientation: Color;
  engineOpen: boolean;
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
      bottom={
        <p
          className="flex h-8 min-w-0 items-center truncate font-mono text-xs text-fg-muted"
          title={pathLabel(lookup, node.id)}
        >
          {pathLabel(lookup, node.id)}
        </p>
      }
    >
      <ControlledBoard
        fen={node.fenAfter}
        orientation={orientation}
        movable="both"
        lastMove={lastMoveOf(node.uci)}
        arrows={node.arrows}
        highlights={node.highlights}
        onShapesChange={onShapesChange}
        onMove={onMove}
      />
    </BoardStage>
  );
}
