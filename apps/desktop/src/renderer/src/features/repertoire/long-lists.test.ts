import { describe, expect, it } from "vitest";
import type { ImportPreview, ImportSelection } from "@chaturanga/shared/types/repertoire";
import {
  chaptersToChange,
  existingSelection,
  filterChapters,
  filterGames,
  matchesTerms,
  searchTerms,
  selectionState,
  setGamesIncluded,
  setGamesKind,
  windowedRows,
  withSelection
} from "./long-lists";

const chapter = (id: string, title: string, patch: object = {}) => ({
  id,
  title,
  enabled: true,
  kind: "opening" as const,
  ...patch
});

describe("search", () => {
  it("matches every word, in any order and case, across the given texts", () => {
    expect(searchTerms("  Najdorf   6.Bg5 ")).toEqual(["najdorf", "6.bg5"]);
    expect(searchTerms(" ")).toEqual([]);
    expect(matchesTerms([], "anything")).toBe(true);
    expect(matchesTerms(["bg5", "najdorf"], "Najdorf: 6.Bg5")).toBe(true);
    expect(matchesTerms(["bg5", "najdorf"], "Najdorf", "6.Bg5 line")).toBe(true);
    expect(matchesTerms(["be3"], "Najdorf: 6.Bg5")).toBe(false);
  });

  it("filters chapters by title, keeping their order (the same array when the box is blank)", () => {
    const chapters = [
      chapter("a", "Najdorf 6.Bg5"),
      chapter("b", "Dragon"),
      chapter("c", "Najdorf 6.Be3")
    ];
    expect(filterChapters(chapters, "najdorf").map((item) => item.id)).toEqual(["a", "c"]);
    expect(filterChapters(chapters, "be3 NAJ").map((item) => item.id)).toEqual(["c"]);
    expect(filterChapters(chapters, "  ")).toBe(chapters);
  });
});

describe("selection", () => {
  it("reports none, some or all of the shown rows as selected", () => {
    const selected = new Set(["a", "hidden"]);
    expect(selectionState(selected, ["a", "b"])).toBe("some");
    expect(selectionState(selected, ["b"])).toBe("none");
    expect(selectionState(selected, ["a"])).toBe("all");
    expect(selectionState(selected, [])).toBe("none");
  });

  it("selects or clears the shown rows and keeps rows a search hides", () => {
    const selected = new Set(["hidden"]);
    const all = withSelection(selected, ["a", "b"], true);
    expect([...all].sort()).toEqual(["a", "b", "hidden"]);
    expect([...withSelection(all, ["a", "b"], false)]).toEqual(["hidden"]);
    // The input is never changed in place.
    expect([...selected]).toEqual(["hidden"]);
  });

  it("drops removed chapters from the selection, returning the same set when none went", () => {
    const selected = new Set(["a", "b"]);
    expect(existingSelection(selected, ["a", "b", "c"])).toBe(selected);
    expect([...existingSelection(selected, ["b", "c"])]).toEqual(["b"]);
  });

  it("names only the selected chapters a bulk change would change, in list order", () => {
    const chapters = [
      chapter("a", "A"),
      chapter("b", "B", { enabled: false }),
      chapter("c", "C", { kind: "reference" }),
      chapter("d", "D")
    ];
    const selected = new Set(["c", "b", "a"]);
    expect(chaptersToChange(chapters, selected, { enabled: false })).toEqual(["a", "c"]);
    expect(chaptersToChange(chapters, selected, { enabled: true })).toEqual(["b"]);
    expect(chaptersToChange(chapters, selected, { kind: "reference" })).toEqual(["a", "b"]);
    expect(chaptersToChange(chapters, selected, {})).toEqual([]);
  });
});

describe("windowedRows", () => {
  it("mounts the visible rows and an overscan either side", () => {
    expect(
      windowedRows({ count: 500, rowHeight: 60, viewport: { top: 600, height: 300 }, overscan: 2 })
    ).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("clamps to the list and mounts nothing for an empty one", () => {
    expect(windowedRows({ count: 3, rowHeight: 60, viewport: { top: -100, height: 900 } })).toEqual(
      [0, 1, 2]
    );
    expect(windowedRows({ count: 0, rowHeight: 60, viewport: { top: 0, height: 900 } })).toEqual(
      []
    );
  });

  it("keeps pinned rows (the open chapter, the focused row) mounted, in list order", () => {
    expect(
      windowedRows({
        count: 500,
        rowHeight: 60,
        viewport: { top: 0, height: 120 },
        overscan: 0,
        pinned: [450, 1, -1, 999]
      })
    ).toEqual([0, 1, 2, 450]);
  });
});

describe("import preview bulk actions", () => {
  const games = [
    { index: 0, proposedTitle: "Najdorf", nodeCount: 10 },
    { index: 1, proposedTitle: "Dragon", nodeCount: 8 },
    { index: 2, proposedTitle: "Empty", nodeCount: 0 },
    { index: 11, proposedTitle: "Najdorf sideline", nodeCount: 4 }
  ] as ImportPreview["games"];
  const selections: ImportSelection[] = games.map((game) => ({
    gameIndex: game.index,
    title: game.proposedTitle,
    kind: "opening",
    include: game.nodeCount > 0,
    excludeNodeIds: []
  }));

  it("finds games by edited title, proposed title or game number", () => {
    const edited = selections.map((selection, index) =>
      index === 1 ? { ...selection, title: "Accelerated Dragon" } : selection
    );
    expect(filterGames(games, edited, "najdorf")).toEqual([0, 3]);
    expect(filterGames(games, edited, "accelerated")).toEqual([1]);
    expect(filterGames(games, edited, "12")).toEqual([3]);
    expect(filterGames(games, edited, " 1 ")).toEqual([0]);
    // A number among words is matched in titles only.
    expect(filterGames(games, edited, "najdorf 12")).toEqual([]);
    expect(filterGames(games, edited, "")).toEqual([0, 1, 2, 3]);
  });

  it("includes or excludes the shown games; one without moves stays excluded", () => {
    const excluded = setGamesIncluded(selections, games, [0, 2, 3], false);
    expect(excluded.map((selection) => selection.include)).toEqual([false, true, false, false]);
    expect(excluded[1]).toBe(selections[1]);
    const included = setGamesIncluded(excluded, games, [0, 1, 2, 3], true);
    expect(included.map((selection) => selection.include)).toEqual([true, true, false, true]);
  });

  it("changes the kind of the shown games that are included", () => {
    const some = setGamesIncluded(selections, games, [1], false);
    const reference = setGamesKind(some, [0, 1, 2], "reference");
    expect(reference.map((selection) => selection.kind)).toEqual([
      "reference",
      "opening",
      "opening",
      "opening"
    ]);
    expect(reference[3]).toBe(some[3]);
  });
});
