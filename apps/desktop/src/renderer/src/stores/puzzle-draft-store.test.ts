import { describe, expect, it } from "vitest";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { DEFAULT_PUZZLE_FILTERS, draftFromSessionConfig, usePuzzleDraftStore } from "./puzzle-draft-store";

describe("puzzle draft store", () => {
  it("keeps the filters, and a reset keeps the chosen database", () => {
    const store = usePuzzleDraftStore.getState();
    store.update({ databaseId: "db1", themes: ["fork"], ratingMin: 1500 });
    expect(usePuzzleDraftStore.getState().draft).toMatchObject({ databaseId: "db1", themes: ["fork"], ratingMin: 1500 });
    usePuzzleDraftStore.getState().resetFilters();
    expect(usePuzzleDraftStore.getState().draft).toEqual({ databaseId: "db1", ...DEFAULT_PUZZLE_FILTERS });
  });

  it("prefills from a running set's config, so Edit set reopens the same filters", () => {
    const config: PuzzleSessionConfig = {
      databaseId: "db2",
      mode: "position-training",
      lichess: { ratingMin: 1000, ratingMax: 1900, popularityMin: 20, lengths: ["short"], themes: ["fork"], openings: ["Ruy_Lopez"], side: "white" },
      position: { difficultyMin: 2, difficultyMax: 3, tags: ["space"] }
    };
    const draft = draftFromSessionConfig(config);
    expect(draft).toEqual({
      databaseId: "db2",
      themes: ["fork"],
      lengths: ["short"],
      openings: ["Ruy_Lopez"],
      side: "white",
      ratingMin: 1000,
      ratingMax: 1900,
      popularityMin: 20,
      difficultyMin: 2,
      difficultyMax: 3,
      positionTags: ["space"]
    });
    // A copy: editing the draft never changes the running set.
    draft.positionTags.push("trading");
    expect(config.position.tags).toEqual(["space"]);
    usePuzzleDraftStore.getState().update(draftFromSessionConfig(config));
    expect(usePuzzleDraftStore.getState().draft).toMatchObject({ databaseId: "db2", positionTags: ["space"], difficultyMax: 3 });
    expect(draftFromSessionConfig({ ...config, databaseId: null }).databaseId).toBe("");
  });
});
