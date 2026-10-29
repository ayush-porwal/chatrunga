import { useMemo } from "react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireChapter, RepertoireColor } from "@chaturanga/shared/types/repertoire";
import {
  useRepertoireDecisionQuery,
  useRepertoireOccurrencesQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { deriveChoices, occurrencesInOtherChapters } from "./repertoire-model";
import { shownChapter } from "./study-staging";

/**
 * The open chapter as Study shows it (`shown`: the draft with its staged moves) and its lookup
 * (the draft's own too, `draftLookup`), and the selected position in it: its node (the root when
 * the selection is gone), position key, decision, where else it occurs, and who is to move.
 */
export function useStudyPosition({
  repertoireId,
  chapterId,
  chapter,
  staged,
  selectedNodeId,
  color
}: {
  repertoireId: string;
  chapterId: string;
  /** The draft of this page's chapter (null until it is loaded). */
  chapter: RepertoireChapter | null;
  /** The moves staged beside it. */
  staged: readonly MoveNode[];
  selectedNodeId: string;
  color: RepertoireColor;
}) {
  const { shown, lookup, draftLookup } = useShownChapter(chapter, staged);
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
      shown && lookup && node
        ? deriveChoices(shown, lookup, { nodeId: node.id, color, decision })
        : null,
    [shown, lookup, node, color, decision]
  );
  const playerToMove = choices?.side === "player";
  return {
    shown,
    lookup,
    draftLookup,
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

/**
 * The draft with its staged moves (`shown`), and the lookups of both (the same one while nothing
 * is staged). Once per tree revision (design §11): selecting a node, editing edges/training marks
 * or chapter fields, and an autosave that returns the same tree (see reuseUnchangedTree) keep
 * them; only new moves, comments or shapes (a changed tree) rebuild them, and staging a move
 * rebuilds the shown one only.
 */
function useShownChapter(chapter: RepertoireChapter | null, staged: readonly MoveNode[]) {
  const tree = chapter?.tree;
  const draftLookup = useMemo(() => (tree ? buildChapterLookup({ tree }) : null), [tree]);
  const shown = useMemo(() => (chapter ? shownChapter(chapter, staged) : null), [chapter, staged]);
  const shownTree = staged.length ? shown?.tree : undefined;
  const stagedLookup = useMemo(
    () => (shownTree ? buildChapterLookup({ tree: shownTree }) : null),
    [shownTree]
  );
  return { shown, lookup: stagedLookup ?? draftLookup, draftLookup };
}
