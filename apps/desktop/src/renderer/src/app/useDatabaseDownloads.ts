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
    // One "completed" timer per source: any newer event for it (a new download) cancels the old one.
    const timers = new Map<string, number>();
    const unsubscribe = api.events.onDatabaseDownloadProgress((progress) => {
      store.apply(progress);
      const pending = timers.get(progress.sourceId);
      if (pending !== undefined) window.clearTimeout(pending);
      timers.delete(progress.sourceId);
      if (progress.state !== "completed") return;
      void queryClient.invalidateQueries({ queryKey: ["databases"] });
      // Keep "Download complete" visible briefly, then drop that same entry (not a newer one).
      const timer = window.setTimeout(() => {
        timers.delete(progress.sourceId);
        if (useDownloadStore.getState().progress[progress.sourceId] === progress) store.clear(progress.sourceId);
      }, COMPLETED_PROGRESS_MS);
      timers.set(progress.sourceId, timer);
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
