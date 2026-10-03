import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  AddFromGameInput,
  AddFromGamePreview,
  ArchiveRepertoireInput,
  ChapterSaveResult,
  CompareGameInput,
  CreateRepertoireInput,
  DecisionSaveResult,
  DuplicateRepertoireInput,
  ExportInput,
  ImportCommitInput,
  LinkGameInput,
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
import { useEventCallback } from "@/lib/use-event-callback";
import { hashAddInput } from "../features/repertoire/add-from-game";

/**
 * Repertoire data through the typed `window.chaturanga.repertoires` API (main process is the
 * authority for content, grading and scheduling). Keys are narrow so a chapter save never re-reads
 * the hub list's trees: `['repertoires','list',filters]`, `['repertoires',id]`,
 * `['repertoires',id,'chapter',chapterId]`, `['repertoires','due']`,
 * `['repertoires',id,'compare',color,gameHash]`, `['repertoires',id,'add-preview',inputHash]`,
 * `['repertoires',id,'links',chapterId|'all']`.
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
    ["repertoires", id, "occurrences", positionKey] as const,
  comparison: (id: string, color: string, gameHash: string) =>
    ["repertoires", id, "compare", color, gameHash] as const,
  addPreview: (id: string, inputHash: string) =>
    ["repertoires", id, "add-preview", inputHash] as const,
  links: (id: string) => ["repertoires", id, "links"] as const,
  chapterLinks: (id: string, chapterId: string | null) =>
    ["repertoires", id, "links", chapterId ?? "all"] as const
};

/**
 * FNV-1a, 64-bit, as 16 hex digits (computed on two 32-bit halves; UTF-16 code units, so ASCII
 * input matches the byte-wise reference values).
 */
export function fnv1a64(text: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let index = 0; index < text.length; index += 1) {
    lo ^= text.charCodeAt(index);
    // × 0x100000001b3 mod 2^64: every partial product stays below 2^53, so it is exact.
    const low = (lo >>> 0) * 0x1b3;
    hi = (hi * 0x1b3 + (lo >>> 0) * 0x100 + Math.floor(low / 0x100000000)) >>> 0;
    lo = low >>> 0;
  }
  return `${hi.toString(16).padStart(8, "0")}${(lo >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The content hash of a game's root and mainline for the comparison key (FNV-1a 64-bit plus the
 * ply count): the same game content keys the same comparison, whatever its node ids or cursor.
 */
export function gameContentHash(rootFen: string, moves: readonly string[]): string {
  return `${fnv1a64(`${rootFen}|${moves.join(" ")}`)}-${moves.length}`;
}

function repertoires(): ChaturangaApi["repertoires"] | undefined {
  return window.chaturanga?.repertoires;
}

function requireRepertoires(): ChaturangaApi["repertoires"] {
  const api = repertoires();
  if (!api) throw new Error("Repertoires need the desktop app.");
  return api;
}

const EMPTY_DUE: RepertoireDueSummary = {
  dueCount: 0,
  repertoireCount: 0,
  continue: null,
  resume: null
};

/** Re-reads the hub lists and the due summary (last studied, where to continue, due counts). */
export function invalidateSummaries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.lists });
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
}

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
          query.queryKey[2] === "occurrences" ||
          query.queryKey[2] === "compare" ||
          query.queryKey[2] === "links")
    });
  }
}

/**
 * Re-reads the cached decisions, occurrence lists, game comparisons and game links of a repertoire (a chapter
 * save can reconcile any of them).
 */
export function invalidateDecisions(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["repertoires", id, "decision"] });
  void queryClient.invalidateQueries({ queryKey: ["repertoires", id, "occurrences"] });
  void queryClient.invalidateQueries({ queryKey: ["repertoires", id, "compare"] });
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.links(id) });
}

/** Stores a detail the main process returned, and refreshes the summaries that depend on it. */
function adoptDetail(queryClient: QueryClient, detail: RepertoireDetail) {
  queryClient.setQueryData(repertoireKeys.detail(detail.id), detail);
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.lists });
  void queryClient.invalidateQueries({ queryKey: repertoireKeys.due });
}

/**
 * Re-reads the chapter trees of a repertoire (every repertoire when null): a decision change can
 * rewrite edges in chapters other than the one saved.
 */
export function invalidateChapters(queryClient: QueryClient, id: string | null) {
  void queryClient.invalidateQueries(
    id
      ? { queryKey: ["repertoires", id, "chapter"] }
      : {
          predicate: (query) =>
            query.queryKey[0] === "repertoires" && query.queryKey[2] === "chapter"
        }
  );
}

/** Keeps cached repertoire summaries and open chapters in step with the main process. Mount once. */
export function useRepertoireChangedSubscription() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      repertoires()?.onChanged?.((event) => {
        if (event.kind === "workspace") {
          invalidateSummaries(queryClient);
          return;
        }
        invalidateRepertoire(queryClient, event.repertoireId);
        invalidateChapters(queryClient, event.repertoireId);
      }),
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

/**
 * A game's mainline against one repertoire (§6.3). Keyed by the game's content, so cursor moves
 * never recompute it; a change to the repertoire re-reads it (see invalidateDecisions).
 */
export function useRepertoireComparisonQuery(input: CompareGameInput | null) {
  const gameHash = input ? gameContentHash(input.rootFen, input.moves) : "";
  // The key names the input by its content hash (a long mainline doesn't belong in a key).
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery({
    queryKey: repertoireKeys.comparison(input?.repertoireId ?? "", input?.color ?? "", gameHash),
    queryFn: () => requireRepertoires().compareGame(input!),
    enabled: Boolean(input && repertoires()),
    retry: false
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
  // Accepting or removing a move rewrites edges in whichever chapters hold it.
  invalidateChapters(queryClient, result.repertoire.id);
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
      invalidateSummaries(queryClient);
    }
  });
}

export function useStartPracticeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartPracticeInput) => requireRepertoires().startPractice(input),
    retry: false,
    // Home and the hub offer the new session's "Resume practice".
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: repertoireKeys.due })
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

/** A preview with the hash of the input it describes. */
export type AddFromGamePreviewResult = AddFromGamePreview & { inputHash: string };

/**
 * What adding part of a game would change (§6.2); nothing is written. The input settles for a
 * moment first (a title being typed, moves being ticked) and the key names it by its content
 * hash, which the result carries (`inputHash`) so a caller can tell a preview of the input it
 * holds now from an older one still shown while the next loads.
 */
export function useAddFromGamePreviewQuery(input: AddFromGameInput | null) {
  const current = input ? hashAddInput(input) : null;
  const [settledInput, setSettledInput] = useState<{
    hash: string;
    input: AddFromGameInput;
  } | null>(null);
  // Runs with the input of the render that scheduled it (`current` names its content).
  const settle = useEventCallback(() => {
    if (input && current) setSettledInput({ hash: current, input });
  });
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(settle, 250);
    return () => window.clearTimeout(timer);
  }, [current, settle]);
  const settled = current ? settledInput : null;
  const hash = settled?.hash ?? null;
  // The key names the input by its hash (a whole game tree doesn't belong in a key).
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery({
    queryKey: repertoireKeys.addPreview(settled?.input.repertoireId ?? "", hash ?? ""),
    queryFn: async (): Promise<AddFromGamePreviewResult> => ({
      ...(await requireRepertoires().previewAddFromGame(settled!.input)),
      inputHash: hash!
    }),
    enabled: Boolean(settled && hash && repertoires()),
    placeholderData: (previous) => previous,
    retry: false
  });
}

/** Copies part of a game into a chapter; the repertoire's detail, chapter and decisions follow. */
export function useAddFromGameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFromGameInput) => requireRepertoires().addFromGame(input),
    retry: false,
    onSuccess: (result) => {
      adoptChapterSave(queryClient, result);
      void queryClient.invalidateQueries({
        queryKey: ["repertoires", result.repertoire.id, "add-preview"]
      });
    }
  });
}

/** The games a repertoire's material came from, optionally only one chapter's. */
export function useGameLinksQuery(id: string | null, chapterId?: string | null) {
  return useQuery({
    queryKey: repertoireKeys.chapterLinks(id ?? "", chapterId ?? null),
    queryFn: () =>
      requireRepertoires().listGameLinks({
        repertoireId: id!,
        ...(chapterId ? { chapterId } : {})
      }),
    enabled: Boolean(id && repertoires())
  });
}

/** Forgets where some material came from; the copied moves stay. */
export function useRemoveGameLinkMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { repertoireId: string; linkId: string }) =>
      requireRepertoires().removeGameLink(input),
    onSuccess: (_result, input) =>
      queryClient.invalidateQueries({ queryKey: repertoireKeys.links(input.repertoireId) })
  });
}

/**
 * Attaches a library game to a repertoire (a model game, or one played from it). Idempotent per
 * repertoire, game and kind in the main process; the repertoire's link lists follow.
 */
export function useLinkGameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkGameInput) => requireRepertoires().linkGame(input),
    retry: false,
    onSuccess: (_link, input) =>
      queryClient.invalidateQueries({ queryKey: repertoireKeys.links(input.repertoireId) })
  });
}
