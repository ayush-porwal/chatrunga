import { describe, expect, it } from "vitest";
import { useAppNoticeStore } from "./app-notice-store";

describe("app notice store", () => {
  it("shows the latest message until dismissed", () => {
    useAppNoticeStore.getState().show("first");
    useAppNoticeStore.getState().show("second");
    expect(useAppNoticeStore.getState().message).toBe("second");
    useAppNoticeStore.getState().dismiss();
    expect(useAppNoticeStore.getState().message).toBeNull();
  });

  it("offers Maia 3's download only with the notice that asked for it", () => {
    useAppNoticeStore.getState().show("Maia 3 isn't installed", { maia3Download: true });
    expect(useAppNoticeStore.getState().maia3Download).toBe(true);
    useAppNoticeStore.getState().show("next");
    expect(useAppNoticeStore.getState().maia3Download).toBe(false);
    useAppNoticeStore.getState().show("again", { maia3Download: true });
    useAppNoticeStore.getState().dismiss();
    expect(useAppNoticeStore.getState().maia3Download).toBe(false);
  });
});
