import { useState } from "react";
import { nanoid } from "nanoid";
import { useQueryClient } from "@tanstack/react-query";
import type {
  RepertoireChapter,
  RepertoireChapterSummary,
  UpdateDecisionInput
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  adoptChapterSave,
  repertoireKeys,
  useRemoveChapterMutation,
  useUpdateDecisionMutation
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { rootNodeFor } from "./repertoire-chapters";
import { flushChapterDraft } from "./useChapterAutosave";

type ChapterPatch = Partial<Pick<RepertoireChapter, "title" | "kind" | "enabled" | "sortOrder">>;

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Study writes that go beyond the open draft: decision choices (preferred move, prompt, hint),
 * edits to other chapters, adding and removing chapters. Each one first flushes the draft (so it
 * writes against the latest revision), then adopts the revision the main process returns, so the
 * next autosave is not refused as stale. `error` holds the last failure for the panel.
 */
export function useStudyCommands(repertoireId: string) {
  const queryClient = useQueryClient();
  const updateDecision = useUpdateDecisionMutation();
  const removeChapterMutation = useRemoveChapterMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs a write after a flush; false when the draft couldn't be saved first or the write failed. */
  async function run<T>(write: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      if (!(await flushChapterDraft(queryClient))) {
        setError("Save the chapter first (see the save status above).");
        return null;
      }
      return await write();
    } catch (cause) {
      setError(ipcErrorMessage(cause) || "That change couldn't be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function writeDecision(positionKey: string, patch: UpdateDecisionInput["patch"]) {
    return run(async () => {
      const result = await updateDecision.mutateAsync({
        repertoireId,
        positionKey,
        expectedRevision: workspace().baseRevision,
        patch
      });
      workspace().adoptRevision(result.repertoire.revision);
      workspace().rememberDecision(result.decision);
      return result.decision;
    });
  }

  /** Saves a stored chapter other than the open draft with `patch` applied. */
  async function saveOtherChapter(chapterId: string, patch: ChapterPatch) {
    const api = window.chaturanga?.repertoires;
    if (!api) throw new Error("Repertoires need the desktop app.");
    const stored = await queryClient.fetchQuery({
      queryKey: repertoireKeys.chapter(repertoireId, chapterId),
      queryFn: () => api.getChapter({ repertoireId, chapterId }),
      staleTime: 0
    });
    const result = await api.saveChapter({
      repertoireId,
      chapter: { ...stored, ...patch },
      expectedRevision: workspace().baseRevision
    });
    adoptChapterSave(queryClient, result);
    workspace().adoptRevision(result.repertoire.revision);
  }

  /** The open chapter changes through its draft (autosaved); any other chapter is saved now. */
  async function editChapter(chapterId: string, patch: ChapterPatch) {
    if (chapterId === workspace().chapterId) {
      workspace().setChapterFields(patch);
      return true;
    }
    return (await run(() => saveOtherChapter(chapterId, patch).then(() => true))) ?? false;
  }

  /** Swaps a chapter's place with its neighbour (`direction` -1 up, +1 down). */
  async function moveChapter(
    chapters: readonly RepertoireChapterSummary[],
    chapterId: string,
    direction: -1 | 1
  ) {
    const ordered = [...chapters].sort((left, right) => left.sortOrder - right.sortOrder);
    const index = ordered.findIndex((chapter) => chapter.id === chapterId);
    const neighbour = ordered[index + direction];
    const chapter = ordered[index];
    if (!chapter || !neighbour) return;
    // Distinct orders even when imported chapters shared one.
    const [first, second] =
      chapter.sortOrder === neighbour.sortOrder
        ? [neighbour.sortOrder + direction, chapter.sortOrder]
        : [neighbour.sortOrder, chapter.sortOrder];
    await run(async () => {
      for (const [id, sortOrder] of [
        [chapter.id, first],
        [neighbour.id, second]
      ] as const) {
        if (id === workspace().chapterId) {
          workspace().setChapterFields({ sortOrder });
          if (!(await flushChapterDraft(queryClient)))
            throw new Error("The chapter couldn't be saved.");
        } else {
          await saveOtherChapter(id, { sortOrder });
        }
      }
    });
  }

  /** Creates an empty chapter at `rootFen`; resolves to its id. */
  async function addChapter(title: string, rootFen: string, sortOrder: number) {
    return run(async () => {
      const api = window.chaturanga?.repertoires;
      if (!api) throw new Error("Repertoires need the desktop app.");
      const chapter: RepertoireChapter = {
        id: nanoid(),
        title,
        sortOrder,
        kind: "opening",
        enabled: true,
        rootFen,
        revision: 0,
        nodeCount: 1,
        dueCount: 0,
        headers: {},
        tree: [rootNodeFor(rootFen)],
        nodeMeta: {}
      };
      const result = await api.saveChapter({
        repertoireId,
        chapter,
        expectedRevision: workspace().baseRevision
      });
      adoptChapterSave(queryClient, result);
      workspace().adoptRevision(result.repertoire.revision);
      return result.chapter.id;
    });
  }

  async function removeChapter(chapterId: string) {
    return run(async () => {
      const result = await removeChapterMutation.mutateAsync({
        repertoireId,
        chapterId,
        expectedRevision: workspace().baseRevision
      });
      workspace().adoptRevision(result.repertoire.revision);
      return result.repertoire;
    });
  }

  return {
    busy,
    error,
    clearError: () => setError(null),
    writeDecision,
    editChapter,
    moveChapter,
    addChapter,
    removeChapter
  };
}
