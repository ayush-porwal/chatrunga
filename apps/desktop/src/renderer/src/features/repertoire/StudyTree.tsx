import { useMemo, useState, type ComponentProps } from "react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { useEventCallback } from "@/lib/use-event-callback";
import { TreeView } from "../game/TreeView";
import {
  collapseStudyTree,
  expandPathTo,
  isHidden,
  placeholderParent,
  subtreeSizes
} from "./study-tree-model";

type StudyTreeProps = Omit<
  ComponentProps<typeof TreeView>,
  "nodes" | "collapsedRows" | "onExpandRow" | "selectedNodeId"
> & {
  /** The chapter's lookup (built once per chapter revision by the study page). */
  lookup: ChapterLookup;
  selectedNodeId: string;
};

/**
 * The Study move tree: the game TreeView over a collapsed view of the chapter, so a chapter of
 * thousands of moves renders a few hundred rows (see study-tree-model.ts). Expanded rows last
 * while the chapter stays open; the page remounts this per chapter.
 */
export function StudyTree({ lookup, selectedNodeId, ...props }: StudyTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const sizes = useMemo(() => subtreeSizes(lookup), [lookup]);
  const collapsed = useMemo(
    () => collapseStudyTree(lookup, { expanded, sizes }),
    [lookup, expanded, sizes]
  );

  // The selected move is always shown: a hidden one expands its path (adjusting state while
  // rendering, so the tree never renders without it).
  if (isHidden(collapsed, lookup, selectedNodeId)) {
    setExpanded(expandPathTo(expanded, lookup, selectedNodeId));
  }

  const expand = useEventCallback((rowId: string) => {
    const parentId = placeholderParent(rowId);
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
  });

  return (
    <TreeView
      {...props}
      nodes={collapsed.nodes}
      selectedNodeId={selectedNodeId}
      collapsedRows={collapsed.placeholders}
      onExpandRow={expand}
    />
  );
}
