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
});
