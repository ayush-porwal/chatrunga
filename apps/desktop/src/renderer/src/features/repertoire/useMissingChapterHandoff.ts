import { useEffect, useRef } from "react";
import type { RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import type { useRepertoireChapterQuery, useRepertoireQuery } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { sortedChapters } from "./repertoire-chapters";
import { isNotFoundError } from "./repertoire-model";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Study's open chapter going away. Deleted elsewhere (the repertoire or chapter read fails as not
 * found, or the chapter left the repertoire), it hands back to the hub (`onMissing`); removed here
 * (`removeChapter`), the next chapter opens instead. Any other failure to read them is
 * `loadError`, with `retryLoad` to read them again.
 */
export function useMissingChapterHandoff({
  chapterId,
  detail,
  chapterQuery,
  removeChapter: removeStoredChapter,
  onOpenChapter,
  onMissing
}: {
  chapterId: string;
  detail: ReturnType<typeof useRepertoireQuery>;
  chapterQuery: ReturnType<typeof useRepertoireChapterQuery>;
  /** Removes a chapter (null: not removed, the error shows in the panel). */
  removeChapter: (id: string) => Promise<RepertoireDetail | null>;
  onOpenChapter: (chapterId: string) => void;
  onMissing: (message: string) => void;
}): {
  loadError: string | null;
  retryLoad: () => void;
  /** Removes a chapter of the repertoire; removing the open one opens the next. */
  removeChapter: (id: string) => Promise<void>;
} {
  /** Set while this page removes the open chapter itself (not a "missing chapter" case). */
  const leavingChapter = useRef(false);

  // The chapter opened after removing the open one is watched again (this runs before the check).
  useEffect(() => {
    leavingChapter.current = false;
  }, [chapterId]);

  // A read that failed because the repertoire or chapter was deleted, or for another reason (a
  // damaged chapter, a database error): only a deletion leaves the page.
  const detailError = detail.isError ? ipcErrorMessage(detail.error) : null;
  const chapterError = chapterQuery.isError ? ipcErrorMessage(chapterQuery.error) : null;
  const repertoireGone = detailError !== null && isNotFoundError(detailError, "repertoire");
  const chapterGone = chapterError !== null && isNotFoundError(chapterError, "chapter");
  const loadError = repertoireGone || chapterGone ? null : (detailError ?? chapterError);

  // Gone since: hand back to the hub with a reason.
  useEffect(() => {
    if (leavingChapter.current) return;
    if (repertoireGone) onMissing("That repertoire no longer exists.");
    else if (
      chapterGone ||
      (detail.data && !detail.data.chapters.some((item) => item.id === chapterId))
    ) {
      onMissing("That chapter no longer exists.");
    }
  }, [repertoireGone, chapterGone, detail.data, chapterId, onMissing]);

  /** Reads the repertoire and chapter again after a failure (the draft stays as it is). */
  const retryLoad = useEventCallback(() => {
    if (detail.isError) void detail.refetch();
    if (chapterQuery.isError) void chapterQuery.refetch();
  });

  const removeChapter = useEventCallback(async (id: string) => {
    const current = id === chapterId;
    if (current) leavingChapter.current = true;
    const repertoire = await removeStoredChapter(id);
    if (!current) return;
    if (!repertoire) {
      // Not removed (the error shows in the panel): stay on it.
      leavingChapter.current = false;
      return;
    }
    // The removed chapter's draft must never be saved again (that would recreate it).
    workspace().reset();
    const next = sortedChapters(repertoire.chapters).at(0);
    if (next) onOpenChapter(next.id);
    else onMissing("The chapter was removed.");
  });

  return { loadError, retryLoad, removeChapter };
}
