import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { COMPLETED_PROGRESS_MS, useDownloadStore } from "../stores/download-store";

/** Follows database downloads for the whole app, and picks up any already running. */
export function useDatabaseDownloads(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const api = window.chaturanga;
    if (!api) return;
    const store = useDownloadStore.getState();
    const timers = new Set<number>();
    const unsubscribe = api.events.onDatabaseDownloadProgress((progress) => {
      store.apply(progress);
      if (progress.state !== "completed") return;
      void queryClient.invalidateQueries({ queryKey: ["databases"] });
      // Keep "Download complete" visible briefly, then drop it.
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        const current = useDownloadStore.getState().progress[progress.sourceId];
        if (current?.state === "completed") store.clear(progress.sourceId);
      }, COMPLETED_PROGRESS_MS);
      timers.add(timer);
    });
    void api.databases
      .activeDownloads?.()
      .then((running) => store.applySnapshot(running))
      .catch(() => undefined);
    return () => {
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [queryClient]);
}
