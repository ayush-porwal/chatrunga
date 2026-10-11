import { useEffect, useState } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { useRepertoireChapterQuery, useRepertoireQuery } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import type { StudyStage } from "./repertoire-chapters";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Keeps the workspace draft on the chapter Study shows: loads it from the stored repertoire and
 * chapter, follows a history restore to another node, and applies a staged move once.
 */
export function useChapterDraftLoad({
  repertoireId,
  chapterId,
  detail,
  chapterQuery,
  loadedId,
  initialNodeId,
  initialOrientation,
  stage = null,
  onStageApplied,
  onStageFailed
}: {
  repertoireId: string;
  chapterId: string;
  detail: ReturnType<typeof useRepertoireQuery>;
  chapterQuery: ReturnType<typeof useRepertoireChapterQuery>;
  /** The chapter id while the draft holds this page's chapter, else null. */
  loadedId: string | null;
  initialNodeId: string | null;
  initialOrientation: Color | null;
  stage?: StudyStage | null;
  onStageApplied?: () => void;
  /** Reports a staged move that couldn't be added (a stable callback: a state setter). */
  onStageFailed: (message: string) => void;
}): void {
  const [mountedAt] = useState(() => Date.now());
  /** The chapter was read since this page opened (a cached tree may predate another write). */
  const chapterFresh = chapterQuery.dataUpdatedAt >= mountedAt && !chapterQuery.isFetching;

  // Load the chapter into the draft. A draft of this chapter with unsaved edits or a save error
  // is kept (coming back to it must not drop them); a clean one takes a newer stored revision.
  useEffect(() => {
    const loaded = detail.data;
    const stored = chapterQuery.data;
    if (!loaded || !stored || stored.id !== chapterId) return;
    const state = workspace();
    const same =
      state.repertoireId === repertoireId && state.chapterId === chapterId && state.chapter;
    if (same && (state.dirty || state.saveState.status !== "idle")) return;
    if (same && stored.revision <= state.chapter!.revision) {
      // The chapter is unchanged: a newer repertoire revision (another chapter, a decision)
      // doesn't conflict with this clean draft.
      state.adoptRevision(loaded.revision);
      return;
    }
    state.loadChapter(loaded, stored, {
      nodeId: same ? state.selectedNodeId : initialNodeId,
      orientation: same ? state.orientation : initialOrientation
    });
  }, [detail.data, chapterQuery.data, repertoireId, chapterId, initialNodeId, initialOrientation]);

  // History restore to the same chapter at another node.
  useEffect(() => {
    if (initialNodeId) workspace().selectNode(initialNodeId);
  }, [initialNodeId]);

  // A staged move (after the node selection above): added with its edge and selected (a reference
  // move leaves its decision selected), or marked when the chapter already has it (see stageMove). Applied once, and only on a chapter read
  // since this page opened, so it never edits a stale draft; the autosave saves it.
  useEffect(() => {
    if (!stage || !loadedId || !chapterFresh) return;
    const staged = workspace().stageMove(stage.nodeId, stage.uci, stage.edge);
    if (!staged) onStageFailed("The game's move couldn't be added at this position.");
    onStageApplied?.();
  }, [stage, loadedId, chapterFresh, onStageApplied, onStageFailed]);
}
