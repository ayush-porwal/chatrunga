import { useCallback, useDeferredValue, useMemo } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import { activeScratchLine } from "../game/scratch-line";
import {
  reviewAnchorFor,
  type CommentaryMoveContext,
  type MoveNavigationTarget
} from "./commentary-moves";
import type { VariationAnchor } from "./MoveLinks";
import { moveLabel, numberedLine } from "./review-utils";
import { playScratchLine } from "./scratch-moves";

/**
 * A coach's line clicked from the text about `originNodeId` (the Commentary or Engine tab, a key
 * moment's card): the game moves it follows are gone to, the rest is a scratch line, never saved,
 * with the panels staying on that move.
 */
export function playCoachLine(originNodeId: string, target: MoveNavigationTarget): void {
  playScratchLine(originNodeId, target.startNodeId, target.moves);
}

/** "6… Nf6" for the game move a scratch line hangs off ("the start" before the first move). */
function scratchAnchorLabel(moveTree: readonly MoveNode[], anchorNodeId: string): string {
  const node = moveTree.find((item) => item.id === anchorNodeId);
  return node?.san ? numberedLine(node.fenBefore, [node.san]) : "the start";
}

/**
 * The reviewed move the text panels (commentary, engine evidence) explain, and the links from
 * them. On an unreviewed variation they stay on the nearest reviewed ancestor; on a scratch line,
 * on the move it was started from. A link clicked plays its line as a scratch line.
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
  const currentAnchor = useMemo(
    () => reviewAnchorFor(moveTree, selectedNodeId, reviewByNodeId),
    [moveTree, reviewByNodeId, selectedNodeId]
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
  const scratch = useGameStore(activeScratchLine);
  const scratchOrigin = scratch?.originNodeId ?? null;
  const scratchAnchor = scratch?.anchorNodeId ?? null;
  const variationAnchor = useMemo<VariationAnchor | null>(() => {
    if (scratchOrigin && scratchAnchor)
      return {
        label: scratchAnchorLabel(moveTree, scratchAnchor),
        scratch: true,
        onBack: () => selectNode(scratchOrigin)
      };
    return anchor?.variation
      ? { label: moveLabel(anchor.move), onBack: () => selectNode(anchor.move.nodeId) }
      : null;
  }, [anchor, moveTree, scratchAnchor, scratchOrigin, selectNode]);
  const moveContext = useMemo<CommentaryMoveContext | null>(
    () => (panelMove ? { move: panelMove, moves, moveTree } : null),
    [moveTree, moves, panelMove]
  );
  const panelNodeId = panelMove?.nodeId ?? null;
  const goToLine = useCallback(
    (target: MoveNavigationTarget) => playCoachLine(panelNodeId ?? target.startNodeId, target),
    [panelNodeId]
  );
  return { panelMove, panelParentId, variationAnchor, moveContext, goToLine };
}
