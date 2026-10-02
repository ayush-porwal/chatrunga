import { describe, expect, it } from "vitest";
import { DEFAULT_PUZZLE_FILTERS, usePuzzleDraftStore } from "./puzzle-draft-store";

describe("puzzle draft store", () => {
  it("keeps the filters, and a reset keeps the chosen database", () => {
    const store = usePuzzleDraftStore.getState();
    store.update({ databaseId: "db1", themes: ["fork"], ratingMin: 1500 });
    expect(usePuzzleDraftStore.getState().draft).toMatchObject({ databaseId: "db1", themes: ["fork"], ratingMin: 1500 });
    usePuzzleDraftStore.getState().resetFilters();
    expect(usePuzzleDraftStore.getState().draft).toEqual({ databaseId: "db1", ...DEFAULT_PUZZLE_FILTERS });
  });
});
