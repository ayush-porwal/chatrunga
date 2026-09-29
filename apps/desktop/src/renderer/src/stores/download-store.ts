import { create } from "zustand";
import type { DatabaseDownloadProgress } from "@chaturanga/shared/types/database";

/** How long a finished download keeps showing "Download complete". */
export const COMPLETED_PROGRESS_MS = 1800;

type DownloadStore = {
  /** Per database source: its running download, or its outcome (completed / failed). */
  progress: Record<string, DatabaseDownloadProgress>;
  apply: (progress: DatabaseDownloadProgress) => void;
  clear: (sourceId: string) => void;
};

/**
 * Database downloads, fed once for the whole app (see useDatabaseDownloads), so leaving the
 * Databases page and coming back still shows a download that is running.
 */
export const useDownloadStore = create<DownloadStore>((set) => ({
  progress: {},
  apply: (progress) =>
    set((state) => {
      const next = { ...state.progress };
      // A cancelled download just goes back to its Download button.
      if (progress.state === "cancelled") delete next[progress.sourceId];
      else next[progress.sourceId] = progress;
      return { progress: next };
    }),
  clear: (sourceId) =>
    set((state) => {
      const next = { ...state.progress };
      delete next[sourceId];
      return { progress: next };
    })
}));
