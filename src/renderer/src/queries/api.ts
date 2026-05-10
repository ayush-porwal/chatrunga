import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveGameInput } from "../../../shared/types/chess";
import type { CreateEngineInput, UpdateEngineInput } from "../../../shared/types/engine";
import type { AppSettings } from "../../../shared/types/settings";

export const queryKeys = {
  engines: ["engines"] as const,
  games: ["games"] as const,
  settings: ["settings"] as const
};

export function useEnginesQuery() {
  return useQuery({ queryKey: queryKeys.engines, queryFn: () => window.chaturanga.engines.list() });
}

export function useCreateEngineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEngineInput) => window.chaturanga.engines.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engines })
  });
}

export function useUpdateEngineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEngineInput }) =>
      window.chaturanga.engines.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engines })
  });
}

export function useDeleteEngineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.chaturanga.engines.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engines })
  });
}

export function useGamesQuery() {
  return useQuery({ queryKey: queryKeys.games, queryFn: () => window.chaturanga.games.list() });
}

export function useSaveGameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveGameInput) => window.chaturanga.games.save(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.games })
  });
}

export function useSettingsQuery() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => window.chaturanga.settings.getAll() });
}

export function useUpdateSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: keyof AppSettings; value: unknown }) =>
      window.chaturanga.settings.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  });
}
