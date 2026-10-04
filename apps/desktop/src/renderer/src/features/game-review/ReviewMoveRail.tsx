import type { GameOpening, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { TreeView } from "../game/TreeView";
import type { PlayLine } from "../game/BestLineRow";
import { MomentList } from "./KeyMoments";

/** What the Moves tab lists: the key moments, every marked move, or the whole move tree. */
export type MovesView = "key" | "marked" | "all";

const viewOptions: readonly SegmentedOption<MovesView>[] = [
  { value: "key", label: "Key moments" },
  { value: "marked", label: "All marks" },
  { value: "all", label: "All moves" }
];

const NO_MOVES: readonly MoveReview[] = [];
const NO_MOMENTS: readonly KeyMoment[] = [];

/**
 * The Moves tab: the full move tree (main line + variations) with each move's mark and score, or
 * the focused lists — the key moments, or every marked move (errors included) in game order.
 */
export function ReviewMoveRail({
  nodes,
  selectedNodeId,
  reviews,
  commentaryByNodeId,
  onSelectNode,
  view = "all",
  onViewChange,
  moves = NO_MOVES,
  keyMoments = NO_MOMENTS,
  marks = NO_MOMENTS,
  opening,
  onPlayLine,
  orientation
}: {
  nodes: readonly MoveNode[];
  selectedNodeId: string | null;
  reviews: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId: ReadonlyMap<string, ReviewCommentary>;
  onSelectNode: (nodeId: string) => void;
  view?: MovesView;
  onViewChange?: (view: MovesView) => void;
  /** The reviewed moves the lists point at. */
  moves?: readonly MoveReview[];
  keyMoments?: readonly KeyMoment[];
  /** Every marked move, in game order. */
  marks?: readonly KeyMoment[];
  /** The game's opening, named after the last book move. */
  opening?: GameOpening | null;
  /** Plays a BEST line on the board as a variation. */
  onPlayLine?: PlayLine;
  /** The board's orientation, for the BEST lines' preview boards. */
  orientation?: Color;
}) {
  const tree = (
    <TreeView
      nodes={nodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      reviews={reviews}
      commentaryByNodeId={commentaryByNodeId}
      showCommentaryState
      opening={opening}
      onPlayLine={onPlayLine}
      orientation={orientation}
      emptyLabel="No moves to review."
      ariaLabel="Reviewed move tree"
      className="-mr-3 h-full pr-3"
    />
  );
  if (!onViewChange) return tree;
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <SegmentedControl
        ariaLabel="Moves shown"
        size="sm"
        fullWidth
        options={viewOptions}
        value={view}
        onChange={onViewChange}
      />
      {view === "all" ? (
        tree
      ) : (
        <div className="scroll-area -mr-3 min-h-0 overflow-y-auto pr-3">
          <MomentList
            moments={view === "key" ? keyMoments : marks}
            moves={moves}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            label={view === "key" ? "Key moments of the game" : "Every marked move"}
            emptyTitle={view === "key" ? "No key moments yet." : "No marked moves yet."}
          />
        </div>
      )}
    </div>
  );
}
