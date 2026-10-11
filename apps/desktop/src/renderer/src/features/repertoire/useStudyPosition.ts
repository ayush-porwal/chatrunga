import { useMemo } from "react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { RepertoireChapter, RepertoireColor } from "@chaturanga/shared/types/repertoire";
import {
  useRepertoireDecisionQuery,
  useRepertoireOccurrencesQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { deriveChoices, occurrencesInOtherChapters } from "./repertoire-model";

/**
 * The open chapter's lookup and the selected position in it: its node (the root when the
 * selection is gone), position key, decision, where else it occurs, and who is to move.
 */
export function useStudyPosition({
  repertoireId,
  chapterId,
  chapter,
  selectedNodeId,
  color
}: {
  repertoireId: string;
  chapterId: string;
  /** The draft of this page's chapter (null until it is loaded). */
  chapter: RepertoireChapter | null;
  selectedNodeId: string;
  color: RepertoireColor;
}) {
  // Once per tree revision (design §11): selecting a node, editing edges/training marks or chapter
  // fields, and an autosave that returns the same tree (see reuseUnchangedTree) keep the lookup;
  // only new moves, comments or shapes (a changed tree) rebuild it.
  const tree = chapter?.tree;
  const lookup = useMemo(() => (tree ? buildChapterLookup({ tree }) : null), [tree]);
  const node = lookup?.nodesById.get(selectedNodeId) ?? lookup?.nodesById.get("root") ?? null;
  const positionKey = lookup?.positionKeys.get(node?.id ?? "") ?? null;
  const storedDecision = useRepertoireDecisionQuery(repertoireId, positionKey);
  const sessionDecision = useRepertoireWorkspaceStore((state) =>
    positionKey ? (state.decisions[positionKey] ?? null) : null
  );
  // The stored decision is the truth; this session's last write only fills in while it loads.
  const decision = storedDecision.isSuccess ? storedDecision.data : sessionDecision;
  const occurrences = useRepertoireOccurrencesQuery(repertoireId, positionKey);
  const otherOccurrences = useMemo(
    () => occurrencesInOtherChapters(occurrences.data ?? [], chapterId),
    [occurrences.data, chapterId]
  );
  const choices = useMemo(
    () =>
      chapter && lookup && node
        ? deriveChoices(chapter, lookup, { nodeId: node.id, color, decision })
        : null,
    [chapter, lookup, node, color, decision]
  );
  const playerToMove = choices?.side === "player";
  return {
    lookup,
    node,
    positionKey,
    decision,
    otherOccurrences,
    playerToMove,
    /** The player is to move here with at least one accepted move (a decision exists). */
    canEditDecision:
      playerToMove &&
      choices.rows.some((row) => row.state === "preferred" || row.state === "accepted")
  };
}
