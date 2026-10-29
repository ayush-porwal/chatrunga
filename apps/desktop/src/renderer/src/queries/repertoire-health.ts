import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  RepertoireHealthEvent,
  RepertoireHealthFlag,
  RepertoireHealthQueueStatus
} from "@chaturanga/shared/types/repertoire-health";

/**
 * The repertoire health check (docs/repertoire-games-and-practice.md §6.3) through
 * `window.chaturanga.repertoireExplorer`: main runs the queue and stores the flags. Keys:
 * `['repertoireHealth','flags',id]`, `['repertoireHealth','summaries']`,
 * `['repertoireHealth','status']`. The queue's events keep the status live and read a
 * repertoire's flags again once they are rewritten; a repertoire edit reads its flags again too
 * (a flag whose position is gone isn't listed). Nothing is available in the web preview.
 */
const healthKeys = {
  all: ["repertoireHealth"] as const,
  flags: (repertoireId: string) => ["repertoireHealth", "flags", repertoireId] as const,
  summaries: ["repertoireHealth", "summaries"] as const,
  status: ["repertoireHealth", "status"] as const
};

const NO_FLAGS: readonly RepertoireHealthFlag[] = [];

function explorerApi(): ChaturangaApi["repertoireExplorer"] | undefined {
  return window.chaturanga?.repertoireExplorer;
}

function requireExplorerApi(): ChaturangaApi["repertoireExplorer"] {
  const api = explorerApi();
  if (!api) throw new Error("The health check needs the desktop app.");
  return api;
}

function applyEvent(queryClient: QueryClient, event: RepertoireHealthEvent): void {
  queryClient.setQueryData(healthKeys.status, event.status);
  if (event.flagsChanged === null) return;
  void queryClient.invalidateQueries({ queryKey: healthKeys.flags(event.flagsChanged) });
  void queryClient.invalidateQueries({ queryKey: healthKeys.summaries });
}

/**
 * Keeps the queue's status and the flags live: the queue's events, and repertoire edits (a flag
 * at a deleted position drops out). Each health hook mounts it, so a page shows current flags
 * whichever of them it uses.
 */
function useHealthEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const api = window.chaturanga;
    const offProgress = api?.repertoireExplorer.onHealthProgress((event) =>
      applyEvent(queryClient, event)
    );
    const offChanged = api?.repertoires.onChanged((event) => {
      if (event.kind === "workspace" || event.kind === "progress") return;
      void queryClient.invalidateQueries({
        queryKey: event.repertoireId ? healthKeys.flags(event.repertoireId) : healthKeys.all
      });
      void queryClient.invalidateQueries({ queryKey: healthKeys.summaries });
    });
    return () => {
      offProgress?.();
      offChanged?.();
    };
  }, [queryClient]);
}

/**
 * The health check's flags of a repertoire (§6.3), as Study's choices panel, move tree and
 * Explorer show them; none while they load, without a repertoire, or in the web preview.
 */
export function useRepertoireHealthFlags(
  repertoireId: string | null
): readonly RepertoireHealthFlag[] {
  useHealthEvents();
  const query = useQuery({
    queryKey: healthKeys.flags(repertoireId ?? ""),
    queryFn: () => requireExplorerApi().healthFlags(repertoireId!),
    enabled: Boolean(repertoireId && explorerApi())
  });
  return query.data ?? NO_FLAGS;
}

/** Insights' Repertoire health card: each repertoire's flag counts and last check. */
export function useRepertoireHealthSummaries() {
  useHealthEvents();
  return useQuery({
    queryKey: healthKeys.summaries,
    queryFn: () => requireExplorerApi().healthSummaries(),
    enabled: Boolean(explorerApi())
  });
}

/** The queue as main last reported it (kept live by its events). */
export function useRepertoireHealthStatus() {
  useHealthEvents();
  return useQuery({
    queryKey: healthKeys.status,
    queryFn: () => requireExplorerApi().healthStatus(),
    enabled: Boolean(explorerApi()),
    staleTime: Number.POSITIVE_INFINITY
  });
}

type HealthQueueAction =
  | { action: "check"; repertoireIds: string[] }
  | { action: "pause" | "resume" | "cancel" };

/** Run check (the repertoires named), Pause, Resume or Cancel. */
export function useRepertoireHealthQueueMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HealthQueueAction): Promise<RepertoireHealthQueueStatus> => {
      const api = requireExplorerApi();
      switch (input.action) {
        case "check":
          return api.checkHealth(input.repertoireIds);
        case "pause":
          return api.pauseHealth();
        case "resume":
          return api.resumeHealth();
        case "cancel":
          return api.cancelHealth();
      }
    },
    onSuccess: (status) => {
      queryClient.setQueryData(healthKeys.status, status);
      void queryClient.invalidateQueries({ queryKey: healthKeys.summaries });
    }
  });
}
