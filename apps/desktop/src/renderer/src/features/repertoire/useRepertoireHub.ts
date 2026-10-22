import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RepertoireListFilters } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  repertoireKeys,
  useRepertoireDueSummaryQuery,
  useRepertoiresQuery
} from "../../queries/repertoire";
import { discardDeletedRepertoireTexts } from "./decision-text-drafts";
import type { HubMessage } from "./HubNotice";
import { resumePracticeTarget, sortedChapters, type StudyTarget } from "./repertoire-chapters";

/** Unfiltered, unarchived repertoires (the same list Home reads). */
const ACTIVE: RepertoireListFilters = {};

/** The hub's list filters: a name or tag search, and archived instead of active ones. */
export function useHubFilters() {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const filters: RepertoireListFilters = { query: query.trim() || undefined, archived };
  return { query, setQuery, archived, setArchived, listFilters: filters };
}

/**
 * The unfinished practice session the hub's Practice resumes (its repertoire's row says Resume),
 * or null. Also drops unsaved prompts and hints of repertoires deleted since.
 */
export function useHubResume() {
  const queryClient = useQueryClient();
  const active = useRepertoiresQuery(ACTIVE);
  // An unsaved prompt or hint of a repertoire deleted since has nowhere to go: dropped here, so it
  // never holds back closing the window.
  useEffect(() => {
    if (active.data) {
      void discardDeletedRepertoireTexts(
        queryClient,
        active.data.map((item) => item.id)
      );
    }
  }, [active.data, queryClient]);
  const due = useRepertoireDueSummaryQuery();
  return resumePracticeTarget(due.data);
}

/**
 * Opening a repertoire from the hub: Study at the chapter last studied (at its node), else the
 * first chapter. A repertoire without chapters, or one that can't be read, says so (`onNotice`).
 */
export function useStudyFromHub(
  onStudy: (target: StudyTarget) => void,
  onNotice: (notice: HubMessage) => void
) {
  const queryClient = useQueryClient();
  return async (id: string) => {
    const api = window.chaturanga?.repertoires;
    if (!api) return;
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: repertoireKeys.detail(id),
        queryFn: () => api.get(id)
      });
      const last = detail.workspace?.lastChapterId;
      const chapter =
        detail.chapters.find((item) => item.id === last) ?? sortedChapters(detail.chapters).at(0);
      if (!chapter) {
        onNotice({
          tone: "info",
          text: "This repertoire has no chapters yet. Import a PGN to add some."
        });
        return;
      }
      onStudy({
        repertoireId: id,
        chapterId: chapter.id,
        nodeId: chapter.id === last ? (detail.workspace?.lastNodeId ?? null) : null
      });
    } catch (error) {
      onNotice({
        tone: "danger",
        text: ipcErrorMessage(error) || "Couldn't open that repertoire."
      });
    }
  };
}
