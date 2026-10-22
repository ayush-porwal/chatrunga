import { describe, expect, it } from "vitest";
import { hubView } from "./hub-view";

const base = {
  desktop: true,
  filtered: false,
  listed: 0,
  importing: 0,
  archivedCount: 0 as number | undefined,
  archivedFailed: false
};

describe("hubView", () => {
  it("shows the empty state without a card when there is no repertoire at all", () => {
    expect(hubView(base)).toBe("none");
  });

  it("keeps the card while the list loads or failed, and when it has rows", () => {
    expect(hubView({ ...base, listed: undefined, archivedCount: undefined })).toBe("card");
    expect(hubView({ ...base, listed: 1, archivedCount: undefined })).toBe("card");
  });

  it("keeps the card for an empty search or archived view (its title bar holds both)", () => {
    expect(hubView({ ...base, filtered: true })).toBe("card");
  });

  it("keeps the card when only archived repertoires exist, so the archived view stays reachable", () => {
    expect(hubView({ ...base, archivedCount: 2 })).toBe("card");
  });

  it("keeps the card while a book is being imported (its row is listed)", () => {
    expect(hubView({ ...base, importing: 1 })).toBe("card");
  });

  it("waits for the archived count before choosing between the card and the empty state", () => {
    expect(hubView({ ...base, archivedCount: undefined })).toBe("loading");
  });

  it("shows the card when asking for archived repertoires failed, instead of waiting for ever", () => {
    expect(hubView({ ...base, archivedCount: undefined, archivedFailed: true })).toBe("card");
  });

  it("has no card without the desktop app", () => {
    expect(hubView({ ...base, desktop: false, listed: undefined })).toBe("none");
  });
});
