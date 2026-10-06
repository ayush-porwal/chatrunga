import { useEffect } from "react";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type { ChesscomEvent } from "@chaturanga/shared/types/chesscom";
import { useEventCallback } from "@/lib/use-event-callback";
import { useRefreshGames } from "../queries/api";
import { useChesscomStore } from "../stores/chesscom-store";

/**
 * Keeps the renderer in step with the chess.com account: its status and import progress go to the
 * chess.com store, and new games are imported each time the app opens.
 */
export function useChesscom(): void {
  const refreshGames = useEventCallback(useRefreshGames());
  useEffect(() => {
    const bridge = window.chaturanga;
    if (!bridge?.chesscom) return;
    return startChesscomSync({ api: bridge.chesscom, events: bridge.events, refreshGames });
  }, [refreshGames]);
}

/** useChesscom without React (testable): wires the bridge to the store; returns the teardown. */
export function startChesscomSync({
  api,
  events,
  refreshGames
}: {
  api: ChaturangaApi["chesscom"];
  events: Pick<ChaturangaApi["events"], "onChesscomEvent">;
  refreshGames: () => void;
}): () => void {
  const store = useChesscomStore.getState;
  let disposed = false;

  function handle(event: ChesscomEvent): void {
    if (event.type === "status") {
      store().setStatus(event.status);
      return;
    }
    store().setSync({ running: event.running, imported: event.imported, error: event.error });
    // Games came in: the library lists (and their counts) read again.
    if (!event.running && event.imported > 0) refreshGames();
  }

  const unsubscribe = events.onChesscomEvent(handle);
  void api.status().then(
    (status) => {
      if (disposed) return;
      store().setStatus(status);
      // New games played elsewhere come in at every launch.
      if (status.account) void api.syncGames().catch(() => undefined);
    },
    () => store().setStatus({ account: null, connecting: false })
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}
