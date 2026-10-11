import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import {
  reviewAnchorFor,
  type CommentaryMoveContext,
  type MoveNavigationTarget
} from "./commentary-moves";
import { moveLabel } from "./review-utils";

/**
 * The reviewed move the text panels (commentary, engine evidence) explain, and the links from
 * them. On an unreviewed variation they stay on the nearest reviewed ancestor; the move whose
 * commentary / engine line a link was clicked from keeps the anchor on its lines.
 */
export function useReviewPanelAnchor({
  moveTree,
  selectedNodeId,
  moves,
  reviewByNodeId,
  selectNode
}: {
  moveTree: readonly MoveNode[];
  selectedNodeId: string;
  moves: readonly MoveReview[];
  reviewByNodeId: ReadonlyMap<string, MoveReview>;
  selectNode: (nodeId: string) => void;
}) {
  const [linkOriginNodeId, setLinkOriginNodeId] = useState<string | null>(null);
  const currentAnchor = useMemo(
    () => reviewAnchorFor(moveTree, selectedNodeId, reviewByNodeId, linkOriginNodeId),
    [linkOriginNodeId, moveTree, reviewByNodeId, selectedNodeId]
  );
  // The board, graph and move list follow the selection at once; the text panels (commentary with
  // its move links, engine evidence) follow as an interruptible low-priority render, so scrubbing
  // through moves never waits for them.
  const anchor = useDeferredValue(currentAnchor);
  const panelMove = anchor?.move ?? null;
  const panelParentId = useMemo(
    () =>
      panelMove ? (moveTree.find((node) => node.id === panelMove.nodeId)?.parentId ?? null) : null,
    [moveTree, panelMove]
  );
  const variationAnchor = useMemo(
    () =>
      anchor?.variation
        ? { label: moveLabel(anchor.move), onBack: () => selectNode(anchor.move.nodeId) }
        : null,
    [anchor, selectNode]
  );
  const moveContext = useMemo<CommentaryMoveContext | null>(
    () => (panelMove ? { move: panelMove, moves, moveTree } : null),
    [moveTree, moves, panelMove]
  );
  const panelNodeId = panelMove?.nodeId ?? null;
  const goToLine = useCallback(
    (target: MoveNavigationTarget) => {
      setLinkOriginNodeId(panelNodeId);
      useGameStore.getState().goToLine(target.startNodeId, target.moves);
    },
    [panelNodeId]
  );
  return { panelMove, panelParentId, variationAnchor, moveContext, goToLine };
}
