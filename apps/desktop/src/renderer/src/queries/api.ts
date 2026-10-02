import { useCallback, useEffect } from "react";
import { mutationOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { SAVE_SUPPRESSED_AFTER_DELETE } from "@chaturanga/shared/ipc/game-handling";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import type { CreateEngineInput, UpdateEngineInput } from "@chaturanga/shared/types/engine";
import type { PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { settlePendingSettings, withPendingSettings } from "./settings-pending";

const queryKeys = {
  databases: ["databases"] as const,
  engines: ["engines"] as const,
  games: ["games"] as const,
  settings: ["settings"] as const,
  openRouter: ["openrouter"] as const
};

function api() {
  return window.chaturanga;
}

function requireApi() {
  if (!window.chaturanga) throw new Error("Desktop API is unavailable in this environment.");
  return window.chaturanga;
}

/** Keeps the cached engine list in step with the main process's registry. Mount once. */
export function useEngineRegistrySubscription() {
  const queryClient = useQueryClient();
  useEffect(
    () => api()?.onEnginesChanged?.(() => void queryClient.invalidateQueries({ queryKey: queryKeys.engines })),
    [queryClient]
  );
}

export function useEnginesQuery() {
  return useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => api()?.engines.list() ?? []
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

/** Re-reads the saved games list (after games were added outside the renderer, e.g. a Lichess import). */
export function useRefreshGames(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKeys.games });
}

export function useSaveGameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveGameInput) => requireApi().games.save(input),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.games }),
    onError: (error) => {
      // Saving a game that was just deleted is refused on purpose; anything else is worth a trace.
      if (isSaveSuppressed(error)) return;
      console.warn("games.save failed", error);
    }
  });
}

/** The save was refused on purpose: the game was just deleted (not a failure to report). */
export function isSaveSuppressed(error: unknown): boolean {
  return ipcErrorMessage(error) === SAVE_SUPPRESSED_AFTER_DELETE;
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
    queryFn: () => api()?.settings.getAll() ?? defaultSettings,
    // A drag not written yet stays on screen through reads caused by other writes.
    select: withPendingSettings
  });
}

type SettingsPatch = Partial<AppSettings>;
type SettingsWrite = {
  patch: SettingsPatch;
  /** The values before this write (when the cache already shows it, e.g. a batched slider drag). */
  previous?: SettingsPatch;
};

const SETTINGS_MUTATION_KEY = ["settings", "write"] as const;

/**
 * Writes settings (optimistic: the cache shows them at once). A failed write puts back only its
 * own keys, and only those still showing its value — a newer edit to the same key, or an edit to
 * another key, is never reverted. The settings are read again once no write is left running.
 */
export function useUpdateSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation(settingsWriteOptions(queryClient));
}

/** The options of useUpdateSettingsMutation (outside the hook for tests). */
export function settingsWriteOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: SETTINGS_MUTATION_KEY,
    mutationFn: ({ patch }: SettingsWrite) => requireApi().settings.patch(patch),
    onMutate: async ({ patch, previous }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings });
      const current = { ...defaultSettings, ...queryClient.getQueryData<AppSettings>(queryKeys.settings) };
      const before: SettingsPatch = previous ?? pickSettings(current, patch);
      queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...current, ...patch });
      return { before };
    },
    onError: (_error, { patch }, context) => {
      // Before the rollback, which re-runs `select`: else the failed drag value stays on screen.
      settlePendingSettings(patch);
      if (!context) return;
      queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
        current ? revertFailedWrite(current, patch, context.before) : current
      );
    },
    onSettled: () => {
      // This write still counts as running here: read back once the last one settles.
      if (queryClient.isMutating({ mutationKey: SETTINGS_MUTATION_KEY }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      }
    }
  });
}

/** After a failed write: its keys go back to `before`, unless a newer value replaced them meanwhile. */
export function revertFailedWrite(current: AppSettings, patch: SettingsPatch, before: SettingsPatch): AppSettings {
  const next = { ...current };
  for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
    if (Object.is(current[key], patch[key])) Object.assign(next, { [key]: before[key] });
  }
  return next;
}

function pickSettings(settings: AppSettings, patch: SettingsPatch): SettingsPatch {
  const picked: SettingsPatch = {};
  for (const key of Object.keys(patch) as (keyof AppSettings)[]) Object.assign(picked, { [key]: settings[key] });
  return picked;
}

/** One setting (see useUpdateSettingsMutation). `mutate` / `mutateAsync` keep their identity. */
export function useUpdateSettingMutation() {
  const update = useUpdateSettingsMutation();
  const { mutate: mutatePatch, mutateAsync: mutatePatchAsync } = update;
  // Per-call options (onSuccess, onError…) are passed on; their variables are the patch written.
  const mutate = useCallback(
    ({ key, value }: { key: keyof AppSettings; value: unknown }, options?: Parameters<typeof mutatePatch>[1]) =>
      mutatePatch({ patch: { [key]: value } as SettingsPatch }, options),
    [mutatePatch]
  );
  const mutateAsync = useCallback(
    ({ key, value }: { key: keyof AppSettings; value: unknown }, options?: Parameters<typeof mutatePatchAsync>[1]) =>
      mutatePatchAsync({ patch: { [key]: value } as SettingsPatch }, options),
    [mutatePatchAsync]
  );
  return { ...update, mutate, mutateAsync };
}

export function useOpenRouterConfigQuery() {
  return useQuery({
    queryKey: queryKeys.openRouter,
    queryFn: () => api()?.commentary.getOpenRouterConfig() ?? { model: "", hasApiKey: false }
  });
}
