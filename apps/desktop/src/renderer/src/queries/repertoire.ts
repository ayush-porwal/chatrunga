import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  ArchiveRepertoireInput,
  ChapterSaveResult,
  CreateRepertoireInput,
  DecisionSaveResult,
  DuplicateRepertoireInput,
  ExportInput,
  ImportCommitInput,
  PracticeActionInput,
  PreviewImportInput,
  RecordAttemptInput,
  RemoveChapterInput,
  RemoveRepertoireInput,
  RepertoireDetail,
  RepertoireDueSummary,
  RepertoireListFilters,
  SaveChapterInput,
  SaveWorkspaceInput,
  StartPracticeInput,
  UpdateDecisionInput,
  UpdateRepertoireMetadataInput
} from "@chaturanga/shared/types/repertoire";

/**
 * Repertoire data through the typed `window.chaturanga.repertoires` API (main process is the
 * authority for content, grading and scheduling). Keys are narrow so a chapter save never re-reads
 * the hub list's trees: `['repertoires','list',filters]`, `['repertoires',id]`,
 * `['repertoires',id,'chapter',chapterId]`, `['repertoires','due']`.
 *
 * The detail key is a prefix of the chapter key, so detail invalidations pass `exact: true`.
 * Everything degrades to empty/disabled in the web preview (no `window.chaturanga`).
 */
export const repertoireKeys = {
  all: ["repertoires"] as const,
  lists: ["repertoires", "list"] as const,
  list: (filters: RepertoireListFilters) => ["repertoires", "list", filters] as const,
  due: ["repertoires", "due"] as const,
  detail: (id: string) => ["repertoires", id] as const,
  chapter: (id: string, chapterId: string) => ["repertoires", id, "chapter", chapterId] as const,
  decision: (id: string, positionKey: string) =>
    ["repertoires", id, "decision", positionKey] as const,
  occurrences: (id: string, positionKey: string) =>
    ["repertoires", id, "occurrences", positionKey] as const
};

function repertoires(): ChaturangaApi["repertoires"] | undefined {
  return window.chaturanga?.repertoires;
}

function requireRepertoires(): ChaturangaApi["repertoires"] {
  const api = repertoires();
  if (!api) throw new Error("Repertoires need the desktop app.");
  return api;
}

const EMPTY_DUE: RepertoireDueSummary = { dueCount: 0, repertoireCount: 0, continue: null };

/** Re-reads summaries and the detail of a repertoire (not its chapter trees). */
export function invalidateRepertoire(queryClient: QueryClient, id: string | null) {
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.lists });
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
  if (id) {
    void queryClient.invalidateQueries({ queryKey: repertoireKeys.detail(id), exact: true });
    invalidateDecisions(queryClient, id);
  } else {
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "repertoires" &&
        ((query.queryKey.length === 2 && query.queryKey[1] !== "due") ||
          query.queryKey[2] === "decision" ||
          query.queryKey[2] === "occurrences")
    });
  }
}

/**
 * Re-reads the cached decisions and occurrence lists of a repertoire (a chapter save can
 * reconcile any of them).
 */
export function invalidateDecisions(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["repertoires", id, "decision"] });
  void queryClient.invalidateQueries({ queryKey: ["repertoires", id, "occurrences"] });
}

/** Stores a detail the main process returned, and refreshes the summaries that depend on it. */
function adoptDetail(queryClient: QueryClient, detail: RepertoireDetail) {
  queryClient.setQueryData(repertoireKeys.detail(detail.id), detail);
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.lists });
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
}

/** Keeps cached repertoire summaries in step with the main process. Mount once. */
export function useRepertoireChangedSubscription() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      repertoires()?.onChanged?.((event) => invalidateRepertoire(queryClient, event.repertoireId)),
    [queryClient]
  );
}

/** Due counts change as time passes, with no write to announce it, so they're polled. */
const DUE_REFRESH_MS = 60_000;

export function useRepertoiresQuery(filters: RepertoireListFilters) {
  return useQuery({
    queryKey: repertoireKeys.list(filters),
    queryFn: () => repertoires()?.list(filters) ?? [],
    refetchInterval: DUE_REFRESH_MS
  });
}

export function useRepertoireQuery(id: string | null) {
  return useQuery({
    queryKey: repertoireKeys.detail(id ?? ""),
    queryFn: () => requireRepertoires().get(id!),
    enabled: Boolean(id && repertoires())
  });
}

export function useRepertoireChapterQuery(id: string | null, chapterId: string | null) {
  return useQuery({
    queryKey: repertoireKeys.chapter(id ?? "", chapterId ?? ""),
    queryFn: () => requireRepertoires().getChapter({ repertoireId: id!, chapterId: chapterId! }),
    enabled: Boolean(id && chapterId && repertoires()),
    retry: false
  });
}

/** The stored decision (choices, prompt, hint) at a position; null when there is none yet. */
export function useRepertoireDecisionQuery(id: string | null, positionKey: string | null) {
  return useQuery({
    queryKey: repertoireKeys.decision(id ?? "", positionKey ?? ""),
    queryFn: () =>
      requireRepertoires().getDecision({ repertoireId: id!, positionKey: positionKey! }),
    enabled: Boolean(id && positionKey && repertoires())
  });
}

/** Every chapter node reaching a position (transpositions across the repertoire). */
export function useRepertoireOccurrencesQuery(id: string | null, positionKey: string | null) {
  return useQuery({
    queryKey: repertoireKeys.occurrences(id ?? "", positionKey ?? ""),
    queryFn: () =>
      requireRepertoires().getOccurrences({ repertoireId: id!, positionKey: positionKey! }),
    enabled: Boolean(id && positionKey && repertoires())
  });
}

export function useRepertoireDueSummaryQuery() {
  return useQuery({
    queryKey: repertoireKeys.due,
    queryFn: () => repertoires()?.getDueSummary() ?? EMPTY_DUE,
    refetchInterval: DUE_REFRESH_MS
  });
}

export function useCreateRepertoireMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepertoireInput) => requireRepertoires().create(input),
    onSuccess: (detail) => adoptDetail(queryClient, detail)
  });
}

export function useUpdateRepertoireMetadataMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRepertoireMetadataInput) =>
      requireRepertoires().updateMetadata(input),
    onSuccess: (detail) => adoptDetail(queryClient, detail)
  });
}

/** Writes a saved chapter result into the cache (detail, chapter, summaries). */
export function adoptChapterSave(queryClient: QueryClient, result: ChapterSaveResult) {
  queryClient.setQueryData(
    repertoireKeys.chapter(result.repertoire.id, result.chapter.id),
    result.chapter
  );
  invalidateDecisions(queryClient, result.repertoire.id);
  adoptDetail(queryClient, result.repertoire);
}

export function useSaveChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveChapterInput) => requireRepertoires().saveChapter(input),
    retry: false,
    onSuccess: (result) => adoptChapterSave(queryClient, result)
  });
}

/** Writes a saved decision into the cache. */
export function adoptDecisionSave(queryClient: QueryClient, result: DecisionSaveResult) {
  queryClient.setQueryData(
    repertoireKeys.decision(result.repertoire.id, result.decision.positionKey),
    result.decision
  );
  // Settles the same decision under its stored form (and any other one the write affected).
  invalidateDecisions(queryClient, result.repertoire.id);
  adoptDetail(queryClient, result.repertoire);
}

export function useUpdateDecisionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDecisionInput) => requireRepertoires().updateDecision(input),
    retry: false,
    onSuccess: (result) => adoptDecisionSave(queryClient, result)
  });
}

export function useRemoveChapterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RemoveChapterInput) => requireRepertoires().removeChapter(input),
    onSuccess: ({ repertoire }, input) => {
      queryClient.removeQueries({
        queryKey: repertoireKeys.chapter(input.repertoireId, input.chapterId)
      });
      adoptDetail(queryClient, repertoire);
    }
  });
}

export function useDuplicateRepertoireMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DuplicateRepertoireInput) => requireRepertoires().duplicate(input),
    onSuccess: (detail) => adoptDetail(queryClient, detail)
  });
}

export function useArchiveRepertoireMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveRepertoireInput) => requireRepertoires().archive(input),
    onSuccess: ({ repertoire }) => adoptDetail(queryClient, repertoire)
  });
}

export function useRemoveRepertoireMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RemoveRepertoireInput) => requireRepertoires().remove(input),
    onSuccess: (_result, input) => {
      queryClient.removeQueries({ queryKey: repertoireKeys.detail(input.id) });
      void queryClient.invalidateQueries({ queryKey: repertoireKeys.lists });
      void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
    }
  });
}

export function usePreviewImportMutation() {
  return useMutation({
    mutationFn: (input: PreviewImportInput) => requireRepertoires().previewImport(input),
    retry: false
  });
}

export function useCommitImportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportCommitInput) => requireRepertoires().commitImport(input),
    retry: false,
    onSuccess: ({ repertoire }) => adoptDetail(queryClient, repertoire)
  });
}

export function useCancelImportMutation() {
  return useMutation({
    mutationFn: (jobId: string) => requireRepertoires().cancelImport(jobId)
  });
}

export function useExportRepertoireMutation() {
  return useMutation({
    mutationFn: (input: ExportInput) => requireRepertoires().export(input)
  });
}

export function useSaveRepertoireWorkspaceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWorkspaceInput) => requireRepertoires().saveWorkspace(input),
    onSuccess: (_result, input) => {
      queryClient.setQueryData<RepertoireDetail>(
        repertoireKeys.detail(input.repertoireId),
        (detail) => (detail ? { ...detail, workspace: input.workspace } : detail)
      );
      void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
    }
  });
}

export function useStartPracticeMutation() {
  return useMutation({
    mutationFn: (input: StartPracticeInput) => requireRepertoires().startPractice(input),
    retry: false
  });
}

export function useResumePracticeMutation() {
  return useMutation({
    mutationFn: (sessionId: string) => requireRepertoires().resumePractice(sessionId),
    retry: false
  });
}

export function useRecordAttemptMutation() {
  return useMutation({
    mutationFn: (input: RecordAttemptInput) => requireRepertoires().recordAttempt(input),
    retry: false
  });
}

export function useRecordPracticeActionMutation() {
  return useMutation({
    mutationFn: (input: PracticeActionInput) => requireRepertoires().recordPracticeAction(input),
    retry: false
  });
}

export function useEndPracticeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => requireRepertoires().endPractice(sessionId),
    retry: false,
    onSuccess: (summary) => invalidateRepertoire(queryClient, summary.repertoireId)
  });
}
