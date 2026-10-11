import { useMemo, useState } from "react";
import { promotionTarget } from "@chaturanga/shared/chess/move-tree-promote";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";
import { useEventCallback } from "@/lib/use-event-callback";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { pathLabel } from "./repertoire-model";
import { useTreeKeyboardNavigation } from "./RepertoireMoveNavigation";
import { useStudyEditShortcuts } from "./useStudyEditShortcuts";

const workspace = () => useRepertoireWorkspaceStore.getState();

export type LineDeletion = {
  /** Deletes the line from a node on (the move tree's Delete). */
  deleteLine: (nodeId: string) => void;
  /** Where the deleted line started, while its undo step is the last one (else null). */
  undoableLabel: string | null;
  undo: () => void;
  dismiss: () => void;
};

/**
 * Moving through and editing the open chapter's move tree: selecting a node (also from the
 * arrow keys), deleting a line (with Undo offered), promoting a variation, and the Undo / Redo /
 * Promote shortcuts. The keys work while the chapter is loaded.
 */
export function useMoveTreeEditing({
  chapter,
  lookup,
  selectedNodeId
}: {
  chapter: RepertoireChapter | null;
  lookup: ChapterLookup | null;
  selectedNodeId: string;
}) {
  const selectNode = useEventCallback((nodeId: string) => workspace().selectNode(nodeId));
  useTreeKeyboardNavigation({
    enabled: Boolean(chapter),
    nodes: chapter?.tree ?? [],
    selectedNodeId,
    onSelect: selectNode
  });
  const deletion = useLineDeletion(lookup);
  const promoteVariation = useEventCallback((nodeId: string) => {
    workspace().promoteVariation(nodeId);
  });
  const canPromote = useMemo(
    () => Boolean(chapter && promotionTarget(chapter.tree, selectedNodeId)),
    [chapter, selectedNodeId]
  );
  useStudyEditShortcuts({
    enabled: Boolean(chapter),
    onAction: (action) => {
      if (action === "undo") workspace().undo();
      else if (action === "redo") workspace().redo();
      else workspace().promoteVariation(workspace().selectedNodeId);
    }
  });
  return { selectNode, deletion, promoteVariation, canPromote };
}

function useLineDeletion(lookup: ChapterLookup | null): LineDeletion {
  /** The line just deleted, with the undo step that brings it back (offered while it's the last). */
  const [deletedLine, setDeletedLine] = useState<{
    label: string;
    step: RepertoireChapter | undefined;
  } | null>(null);
  const lastUndo = useRepertoireWorkspaceStore((state) => state.undoStack.at(-1));
  const deleteLine = useEventCallback((nodeId: string) => {
    const label = lookup ? pathLabel(lookup, nodeId) : "";
    if (workspace().deleteLine(nodeId)) {
      setDeletedLine({ label, step: workspace().undoStack.at(-1) });
    }
  });
  return {
    deleteLine,
    undoableLabel: deletedLine !== null && deletedLine.step === lastUndo ? deletedLine.label : null,
    undo: () => {
      workspace().undo();
      setDeletedLine(null);
    },
    dismiss: () => setDeletedLine(null)
  };
}
