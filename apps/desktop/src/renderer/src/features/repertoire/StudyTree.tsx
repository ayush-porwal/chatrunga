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
import type { MoveKind } from "./repertoire-model";

type StudyTreeProps = Omit<
  ComponentProps<typeof TreeView>,
  "nodes" | "collapsedRows" | "onExpandRow" | "selectedNodeId" | "moveTones"
> & {
  /** The chapter's lookup (built once per chapter revision by the study page). */
  lookup: ChapterLookup;
  selectedNodeId: string;
  /** Each move's kind, shown by its colour: the player's own stronger, study-only dimmed. */
  kinds: ReadonlyMap<string, MoveKind>;
};

const KIND_TONES: Record<MoveKind, string | undefined> = {
  yours: "text-fg",
  covered: undefined,
  reference: "text-fg-subtle"
};

/**
 * The Study move tree: the game TreeView over a collapsed view of the chapter, so a chapter of
 * thousands of moves renders a few hundred rows (see study-tree-model.ts), each move coloured by
 * its kind. Expanded rows last
 * while the chapter stays open; the page remounts this per chapter.
 */
export function StudyTree({ lookup, selectedNodeId, kinds, ...props }: StudyTreeProps) {
  const tones = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, kind] of kinds) {
      const tone = KIND_TONES[kind];
      if (tone) map.set(id, tone);
    }
    return map;
  }, [kinds]);
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
      moveTones={tones}
      collapsedRows={collapsed.placeholders}
      onExpandRow={expand}
    />
  );
}
