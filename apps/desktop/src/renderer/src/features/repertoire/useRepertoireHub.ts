import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RepertoireColor, RepertoireListFilters } from "@chaturanga/shared/types/repertoire";
import { useRepertoireDueSummaryQuery, useRepertoiresQuery } from "../../queries/repertoire";
import { discardDeletedRepertoireTexts } from "./decision-text-drafts";
import { mostDue, resumePracticeTarget } from "./repertoire-chapters";

/** Unfiltered, unarchived repertoires (the same list Home reads). */
const ACTIVE: RepertoireListFilters = {};

/** The hub's list filters: colour, a name or tag search, and archived instead of active ones. */
export function useHubFilters() {
  const [color, setColor] = useState<RepertoireColor | "all">("all");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const filters: RepertoireListFilters = { color, query: query.trim() || undefined, archived };
  return { color, setColor, query, setQuery, archived, setArchived, listFilters: filters };
}

export type HubFilters = ReturnType<typeof useHubFilters>;

/**
 * Where the hub offers to pick up: the study to continue, the unfinished practice session, and
 * the repertoire to review when anything is due.
 */
export function useHubTargets() {
  const queryClient = useQueryClient();
  // Review targets everything due, whatever the hub is filtered to.
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
  const reviewTarget = mostDue(active.data ?? []);
  return {
    continueTarget: due.data?.continue ?? null,
    resume: resumePracticeTarget(due.data),
    review: (due.data?.dueCount ?? 0) > 0 ? reviewTarget : null
  };
}

export type HubTargets = ReturnType<typeof useHubTargets>;
