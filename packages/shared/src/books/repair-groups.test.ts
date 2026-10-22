import { describe, expect, it } from "vitest";
import type { BookLine } from "./llm-output";
import { mergeBookChapter } from "./merge";
import {
  applyBookRepairEdits,
  bookLineId,
  bookRepairEdits,
  groupBookFailures
} from "./repair-groups";

function line(moves: string, kind: BookLine["kind"] = "variation"): BookLine {
  return { label: null, kind, role: "opponent", moves, notes: [] };
}

/** The failures of one page of `lines` (as the import's merge reports them). */
const failuresOf = (lines: BookLine[]) =>
  mergeBookChapter({
    color: "white",
    pages: [{ pageIndex: 0, printedPage: null, lines: { game: null, lines } }]
  }).failures;

/** "Bb5" misread as "Nb5" on the main line, copied into its sub-variations. */
const MAIN = "1. e4 e5 2. Nf3 Nc6 3. Nb5 a6";
const SUB = "1. e4 e5 2. Nf3 Nc6 3. Nb5 a6 4. Ba4 Nf6";
const SUB_SHORT = "1. e4 e5 2. Nf3 Nc6 3. Nb5";

describe("groupBookFailures", () => {
  it("groups lines failing on the same move in the same position, preferring the main line", () => {
    const groups = groupBookFailures(
      failuresOf([line(SUB), line(MAIN, "main"), line("1. d4 d5 2. c4 e6 3. Qh9")])
    );
    expect(groups.map((group) => [group.ply, group.members.map(bookLineId)])).toStrictEqual([
      [4, ["0:0", "0:1"]],
      [4, ["0:2"]]
    ]);
    expect(groups[0].representative.moves).toBe(MAIN);
  });

  it("takes the shortest line without a main line, and orders groups shallowest first", () => {
    const groups = groupBookFailures(
      failuresOf([
        line("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. Qz9"),
        line(SUB),
        line(SUB_SHORT)
      ])
    );
    expect(groups.map((group) => group.ply)).toStrictEqual([4, 8]);
    expect(groups[0].representative.moves).toBe(SUB_SHORT);
  });
});

describe("bookRepairEdits / applyBookRepairEdits", () => {
  it("carries a one-move correction over to a line that copied the misread", () => {
    const edits = bookRepairEdits(MAIN, "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6", 4);
    expect(edits).toMatchObject([{ at: 4, remove: ["Nb5"], insert: [{ san: "Bb5" }] }]);
    expect(applyBookRepairEdits("1 e4 e5 2 Nf3 Nc6 3 Nb5!? a6 4 Ba4 Nf6", edits!)).toBe(
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6"
    );
    // A line that doesn't play the misread is left alone.
    expect(applyBookRepairEdits("1. e4 e5 2. Nf3 Nc6 3. Bc4", edits!)).toBeNull();
  });

  it("carries over moves the repair inserted or removed at the failing move", () => {
    const inserted = bookRepairEdits("1. e4 e5 2. Bb5 a6", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6", 2);
    expect(inserted).toMatchObject([
      { at: 2, remove: [], insert: [{ san: "Nf3" }, { san: "Nc6" }] }
    ]);
    expect(applyBookRepairEdits("1. e4 e5 2. Bb5 a6 3. Ba4", inserted!)).toBe(
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4"
    );
    const removed = bookRepairEdits("1. e4 e5 2. e5 Nf3 Nc6", "1. e4 e5 2. Nf3 Nc6", 2);
    expect(removed).toMatchObject([{ at: 2, remove: ["e5"], insert: [] }]);
    expect(applyBookRepairEdits("1. e4 e5 2. e5 Nf3 Nc6 3. Bc4", removed!)).toBe(
      "1. e4 e5 2. Nf3 Nc6 3. Bc4"
    );
  });

  it("carries a deeper correction to a line that never had the shallower misread", () => {
    const edits = bookRepairEdits(
      "1. e4 e5 2. Nf3 Nc6 3. Nb5 a6 4. Ba4 Nf6 5. Qz9",
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O",
      4
    );
    expect(edits?.map((edit) => edit.at)).toStrictEqual([4, 8]);
    expect(
      applyBookRepairEdits("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. Qz9 Be7", edits!)
    ).toBe("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7");
  });

  it("derives nothing from a repair that changed an earlier move, or nothing", () => {
    expect(bookRepairEdits(MAIN, "1. d4 e5 2. Nf3 Nc6 3. Bb5 a6", 4)).toBeNull();
    expect(bookRepairEdits(MAIN, MAIN, 4)).toBeNull();
  });
});
