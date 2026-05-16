import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SAVE_SUPPRESSED_AFTER_DELETE } from "@chaturanga/shared/ipc/game-handling";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import type { CreateEngineInput, UpdateEngineInput } from "@chaturanga/shared/types/engine";
import type { PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { stockfishWasmEngine } from "@chaturanga/shared/engine/bundled";

export const queryKeys = {
  databases: ["databases"] as const,
  engines: ["engines"] as const,
  games: ["games"] as const,
  settings: ["settings"] as const
};

function api() {
  return window.chaturanga;
}

function requireApi() {
  if (!window.chaturanga) throw new Error("Desktop API is unavailable in this environment.");
  return window.chaturanga;
}

export function useEnginesQuery() {
  return useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => api()?.engines.list() ?? [stockfishWasmEngine()]
  });
}

export function useCreateEngineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEngineInput) => requireApi().engines.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engines })
  });
}

export function useUpdateEngineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEngineInput }) =>
      requireApi().engines.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engines })
  });
}

export function useDeleteEngineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requireApi().engines.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engines })
  });
}

export function useGamesQuery() {
  return useQuery({ queryKey: queryKeys.games, queryFn: () => api()?.games.list() ?? [] });
}

export function useSaveGameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveGameInput) => requireApi().games.save(input),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.games }),
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message === SAVE_SUPPRESSED_AFTER_DELETE) return;
      console.warn("games.save failed", error);
    }
  });
}

export function useDeleteGameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requireApi().games.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.games })
  });
}

export function useDatabasesQuery() {
  return useQuery({ queryKey: queryKeys.databases, queryFn: () => api()?.databases.list() ?? [] });
}

export function useDownloadDatabaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => requireApi().databases.download(sourceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.databases })
  });
}

export function useSamplePuzzleMutation() {
  return useMutation({
    mutationFn: (input: PuzzleSampleInput) => requireApi().databases.samplePuzzle(input)
  });
}

export function useDeleteDatabaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requireApi().databases.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.databases })
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api()?.settings.getAll() ?? defaultSettings
  });
}

export function useUpdateSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: keyof AppSettings; value: unknown }) =>
      requireApi().settings.set(key, value),
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings });
      const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
      queryClient.setQueryData<AppSettings>(queryKeys.settings, {
        ...defaultSettings,
        ...previous,
        [key]: value
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  });
}
