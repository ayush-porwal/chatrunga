import { useRef, useState } from "react";
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
  useUpdateChaptersMutation,
  useUpdateDecisionMutation
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { queueRepertoireWrite } from "./decision-text-drafts";
import type { ChapterBulkPatch } from "./long-lists";
import { chapterOrderAfterMove, rootNodeFor } from "./repertoire-chapters";
import { flushChapterTree } from "./useChapterAutosave";

type ChapterPatch = Partial<Pick<RepertoireChapter, "title" | "kind" | "enabled" | "sortOrder">>;

/** Chapter ids one bulk write names at most (the main process refuses more). */
const BULK_CHAPTER_LIMIT = 1_000;

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Study writes that go beyond the open draft: decision choices (the preferred move; typed prompts
 * and hints save through decision-text-drafts.ts), edits to other chapters, adding and removing
 * chapters. Each one first flushes the chapter draft (so it writes against the latest revision),
 * then adopts the revision the main process returns, so the next autosave is not refused as
 * stale. Writes run one at a time (queued with the prompt and hint saves), each against the
 * revision the previous one returned; a result arriving after another repertoire was opened
 * leaves that repertoire's draft alone. `error` holds the last failure for the panel.
 */
export function useStudyCommands(repertoireId: string) {
  const queryClient = useQueryClient();
  const updateDecision = useUpdateDecisionMutation();
  const removeChapterMutation = useRemoveChapterMutation();
  const updateChaptersMutation = useUpdateChaptersMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);

  /** True while the open draft still belongs to this hook's repertoire. */
  const isOpen = () => workspace().repertoireId === repertoireId;

  /** Adopts a revision this repertoire's write returned, unless another repertoire is open now. */
  function adopt(revision: number) {
    if (isOpen()) workspace().adoptRevision(revision);
  }

  /**
   * Queues a write behind any running one, then runs it after a flush; null when the draft
   * couldn't be saved first or the write failed.
   */
  function run<T>(write: () => Promise<T>): Promise<T | null> {
    pending.current += 1;
    setBusy(true);
    setError(null);
    return queueRepertoireWrite(async () => {
      try {
        if (!(await flushChapterTree(queryClient))) {
          setError("Save the chapter first (see the save status above).");
          return null;
        }
        return await write();
      } catch (cause) {
        setError(ipcErrorMessage(cause) || "That change couldn't be saved.");
        return null;
      } finally {
        pending.current -= 1;
        if (!pending.current) setBusy(false);
      }
    });
  }

  async function writeDecision(positionKey: string, patch: UpdateDecisionInput["patch"]) {
    return run(async () => {
      const result = await updateDecision.mutateAsync({
        repertoireId,
        positionKey,
        expectedRevision: workspace().baseRevision,
        patch
      });
      adopt(result.repertoire.revision);
      if (isOpen()) workspace().rememberDecision(result.decision);
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
    adopt(result.repertoire.revision);
  }

  /** The open chapter changes through its draft (autosaved); any other chapter is saved now. */
  async function editChapter(chapterId: string, patch: ChapterPatch) {
    if (chapterId === workspace().chapterId) {
      workspace().setChapterFields(patch);
      return true;
    }
    return (await run(() => saveOtherChapter(chapterId, patch).then(() => true))) ?? false;
  }

  /**
   * Bulk enable/disable or kind change. The other chapters change in one main-process write per
   * BULK_CHAPTER_LIMIT ids (one revision check and reconciliation, not a save per chapter); the
   * open chapter changes through its draft, like a single edit, after that write.
   */
  async function editChapters(chapterIds: readonly string[], patch: ChapterBulkPatch) {
    if (!chapterIds.length) return true;
    const result = await run(async () => {
      const others = chapterIds.filter((id) => id !== workspace().chapterId);
      for (let start = 0; start < others.length; start += BULK_CHAPTER_LIMIT) {
        const { repertoire } = await updateChaptersMutation.mutateAsync({
          repertoireId,
          chapterIds: others.slice(start, start + BULK_CHAPTER_LIMIT),
          expectedRevision: workspace().baseRevision,
          patch
        });
        adopt(repertoire.revision);
      }
      if (isOpen() && chapterIds.includes(workspace().chapterId ?? "")) {
        workspace().setChapterFields(patch);
      }
      return true;
    });
    return result ?? false;
  }

  /** Swaps a chapter's place with its neighbour (`direction` -1 up, +1 down). */
  async function moveChapter(
    chapters: readonly RepertoireChapterSummary[],
    chapterId: string,
    direction: -1 | 1
  ) {
    const changes = chapterOrderAfterMove(chapters, chapterId, direction);
    if (!changes.length) return;
    await run(async () => {
      for (const [id, sortOrder] of changes) {
        if (id === workspace().chapterId) {
          workspace().setChapterFields({ sortOrder });
          if (!(await flushChapterTree(queryClient)))
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
        nodeCount: 0,
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
      adopt(result.repertoire.revision);
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
      adopt(result.repertoire.revision);
      return result.repertoire;
    });
  }

  return {
    busy,
    error,
    clearError: () => setError(null),
    writeDecision,
    editChapter,
    editChapters,
    moveChapter,
    addChapter,
    removeChapter
  };
}
