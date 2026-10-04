import { beforeEach, describe, expect, it } from "vitest";
import { useDownloadStore } from "./download-store";

const progress = (
  sourceId: string,
  state: "downloading" | "completed" | "failed" | "cancelled",
  downloadedBytes = 0
) => ({
  sourceId,
  downloadedBytes,
  totalBytes: 100,
  percent: null,
  state
});

describe("download store", () => {
  beforeEach(() => useDownloadStore.setState({ progress: {}, reported: {} }));

  it("tracks each source's latest progress; a cancel clears it", () => {
    const store = useDownloadStore.getState();
    store.apply(progress("a", "downloading", 10));
    store.apply(progress("a", "downloading", 50));
    expect(useDownloadStore.getState().progress.a?.downloadedBytes).toBe(50);
    store.apply(progress("a", "cancelled"));
    expect(useDownloadStore.getState().progress.a).toBeUndefined();
  });

  it("a snapshot never overwrites newer progress", () => {
    const store = useDownloadStore.getState();
    store.apply(progress("a", "completed", 100));
    store.applySnapshot([progress("a", "downloading", 20), progress("b", "downloading", 5)]);
    expect(useDownloadStore.getState().progress.a?.state).toBe("completed");
    expect(useDownloadStore.getState().progress.b?.downloadedBytes).toBe(5);
    store.clear("b");
    expect(useDownloadStore.getState().progress.b).toBeUndefined();
  });

  it("a snapshot taken before a cancel or clear doesn't bring the download back", () => {
    const store = useDownloadStore.getState();
    store.apply(progress("a", "cancelled"));
    store.apply(progress("b", "completed", 100));
    store.clear("b");
    store.applySnapshot([progress("a", "downloading", 20), progress("b", "downloading", 90)]);
    expect(useDownloadStore.getState().progress).toEqual({});
  });
});
