import { describe, expect, it } from "vitest";
import { useAppNoticeStore } from "./app-notice-store";
import { usePlayDraftStore } from "./play-draft-store";

describe("app notice store", () => {
  it("shows the latest message until dismissed", () => {
    useAppNoticeStore.getState().show("first");
    useAppNoticeStore.getState().show("second");
    expect(useAppNoticeStore.getState().message).toBe("second");
    useAppNoticeStore.getState().dismiss();
    expect(useAppNoticeStore.getState().message).toBeNull();
  });
});

describe("play draft store", () => {
  it("keeps the engine-game choices across visits", () => {
    usePlayDraftStore.getState().update({ engineId: "sf", humanColor: "black", clockPreset: "blitz5_3" });
    usePlayDraftStore.getState().update({ depth: 12 });
    expect(usePlayDraftStore.getState().draft).toMatchObject({ engineId: "sf", humanColor: "black", clockPreset: "blitz5_3", depth: 12 });
  });
});
