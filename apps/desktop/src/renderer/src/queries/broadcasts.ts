import { useEffect } from "react";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useLongHidden } from "@/lib/use-long-hidden";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useBroadcastStore } from "../stores/broadcast-store";

/**
 * Lichess broadcasts (main/broadcasts). Lichess limits anonymous requests (about 30 per 3 minutes
 * for tournaments and rounds), so answers are kept a while and a round's boards are read once:
 * after that its live stream (`useRoundStream`) brings every change.
 */
const keys = {
  top: ["broadcasts", "top"] as const,
  search: (query: string) => ["broadcasts", "search", query] as const,
  tournament: (tourId: string) => ["broadcasts", "tournament", tourId] as const,
  round: (roundId: string) => ["broadcasts", "round", roundId] as const,
  players: (tourId: string) => ["broadcasts", "players", tourId] as const
};

function requireApi() {
  if (!window.chaturanga) throw new Error("Broadcasts need the desktop app.");
  return window.chaturanga.broadcasts;
}

/** Shortest search Lichess is asked about (one letter matches nearly everything). */
export const MIN_SEARCH_LENGTH = 2;

/** Tournaments in progress and recently finished; refreshed every minute while shown. */
export function useBroadcastTopQuery() {
  return useQuery({
    queryKey: keys.top,
    queryFn: () => requireApi().top(),
    staleTime: 60_000,
    refetchInterval: 60_000
  });
}

export function useBroadcastSearchQuery(query: string) {
  const text = query.trim();
  return useQuery({
    queryKey: keys.search(text),
    queryFn: () => requireApi().search(text),
    enabled: text.length >= MIN_SEARCH_LENGTH,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData
  });
}

/** How often a tournament with rounds still to finish is read again while shown. */
const TOURNAMENT_REFRESH_MS = 2 * 60_000;

export function useBroadcastTournamentQuery(tourId: string | null) {
  return useQuery({
    queryKey: keys.tournament(tourId ?? ""),
    queryFn: () => requireApi().tournament(tourId ?? ""),
    enabled: Boolean(tourId),
    staleTime: 2 * 60_000,
    // Read again now and then while rounds are still to finish (one ends, the next starts).
    refetchInterval: (query) =>
      query.state.data?.rounds.some((round) => !round.finished) ? TOURNAMENT_REFRESH_MS : false
  });
}
/** A round's boards as they stood when read (prefetching uses the same options). */
export function roundQueryOptions(roundId: string) {
  return queryOptions({
    queryKey: keys.round(roundId),
    queryFn: () => requireApi().round(roundId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false
  });
}

/**
 * A round's boards. On the tournament page the live stream keeps them current after the first
 * read; elsewhere (the hub's previews) `refetchIntervalMs` reads them again now and then.
 */
export function useBroadcastRoundQuery(
  roundId: string | null,
  { refetchIntervalMs }: { refetchIntervalMs?: number } = {}
) {
  return useQuery({
    ...roundQueryOptions(roundId ?? ""),
    enabled: Boolean(roundId),
    refetchInterval: refetchIntervalMs
  });
}

export function useBroadcastPlayersQuery(tourId: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.players(tourId ?? ""),
    queryFn: () => requireApi().players(tourId ?? ""),
    enabled: Boolean(tourId) && enabled,
    staleTime: 2 * 60_000
  });
}

/**
 * Feeds the broadcast store from the main process's live games. Mount once, above the views (a
 * followed game keeps moving while you're elsewhere).
 */
export function useBroadcastEventSubscription() {
  useEffect(
    () =>
      window.chaturanga?.events.onBroadcastEvent((event) => {
        const store = useBroadcastStore.getState();
        if (event.type === "game") store.receiveGame(event.game);
        else
          store.setConnection(
            event.roundId,
            event.connected ? null : { error: event.error, retrying: event.retrying }
          );
      }),
    []
  );
}

/** How long a hidden window keeps its live streams (a quick switch away doesn't drop them). */
const HIDDEN_GRACE_MS = 60_000;

/**
 * Keeps the rounds' live streams open while mounted (the main process shares each between its
 * watchers). Unless `whileHidden`, they close once the window has been hidden a minute, and open
 * again (every game sent anew) when it shows: nobody is looking, and Lichess's limits are shared.
 */
export function useRoundStreams(
  roundIds: readonly string[],
  { whileHidden = false }: { whileHidden?: boolean } = {}
) {
  const longHidden = useLongHidden(HIDDEN_GRACE_MS);
  const watched = longHidden && !whileHidden ? "" : [...new Set(roundIds)].sort().join(" ");
  useEffect(() => {
    const api = window.chaturanga?.broadcasts;
    if (!api || !watched) return;
    const ids = watched.split(" ");
    let mounted = true;
    for (const roundId of ids) {
      // A watch starts clean: the main process says if its stream (still) has trouble.
      useBroadcastStore.getState().setConnection(roundId, null);
      api.watchRound(roundId).catch((error: unknown) => {
        if (!mounted) return;
        useBroadcastStore
          .getState()
          .setConnection(roundId, { error: ipcErrorMessage(error), retrying: false });
      });
    }
    return () => {
      mounted = false;
      for (const roundId of ids) api.unwatchRound(roundId).catch(() => undefined);
    };
  }, [watched]);
}

/** Keeps one round's live stream open while mounted (see useRoundStreams). */
export function useRoundStream(roundId: string | null) {
  useRoundStreams(roundId ? [roundId] : []);
}
