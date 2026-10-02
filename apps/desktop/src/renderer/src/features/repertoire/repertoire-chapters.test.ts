import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { addLine, cardOf, rootNode } from "./__fixtures__/repertoire";
import {
  fenError,
  mostDue,
  nextSortOrder,
  plural,
  relativeDay,
  rootNodeFor,
  sortedChapters
} from "./repertoire-chapters";
import { firstMissedTarget, nodeIdForPathLabel } from "./repertoire-model";

describe("chapter helpers", () => {
  it("builds a root node with the position's real ply", () => {
    expect(rootNodeFor(START_FEN)).toMatchObject({ id: "root", ply: 0, fenAfter: START_FEN });
    const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(rootNodeFor(blackToMove).ply).toBe(1);
  });

  it("orders chapters and appends after the last", () => {
    const chapters = [
      { id: "b", sortOrder: 2 },
      { id: "a", sortOrder: 0 }
    ];
    expect(sortedChapters(chapters).map((chapter) => chapter.id)).toEqual(["a", "b"]);
    expect(nextSortOrder(chapters)).toBe(3);
    expect(nextSortOrder([])).toBe(0);
  });

  it("validates a custom starting FEN", () => {
    expect(fenError(START_FEN)).toBeNull();
    expect(fenError("  ")).toBe("Enter a FEN.");
    expect(fenError("not a fen")).toMatch(/^Not a legal position/);
  });

  it("describes when a repertoire was last studied", () => {
    const now = new Date(2026, 9, 2, 15).getTime();
    expect(relativeDay(null, now)).toBe("Never");
    expect(relativeDay(new Date(2026, 9, 2, 8).getTime(), now)).toBe("Today");
    expect(relativeDay(new Date(2026, 9, 1, 23).getTime(), now)).toBe("Yesterday");
    expect(relativeDay(new Date(2026, 8, 29).getTime(), now)).toBe("3 days ago");
    expect(relativeDay(new Date(2026, 0, 5).getTime(), now)).toMatch(/2026/);
  });

  it("pluralises counts and finds the repertoire with the most due", () => {
    expect(plural(1, "chapter")).toBe("1 chapter");
    expect(plural(0, "decision")).toBe("0 decisions");
    expect(
      mostDue([
        { id: "a", dueCount: 2 },
        { id: "b", dueCount: 5 }
      ])?.id
    ).toBe("b");
    expect(mostDue([{ id: "a", dueCount: 0 }])).toBeNull();
  });
});

describe("import and summary targets", () => {
  it("finds the preview node an import report names", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "n"));
    const lookup = buildChapterLookup({ tree });
    expect(nodeIdForPathLabel(lookup, "1. e4 e5 2. Nf3")).toBe("n2");
    expect(nodeIdForPathLabel(lookup, "1. d4")).toBeNull();
    expect(nodeIdForPathLabel(lookup, "")).toBeNull();
  });

  it("opens study at the first missed card it can place", () => {
    const cards = [cardOf("a", { chapterId: "c2", nodeId: "n7" })];
    expect(firstMissedTarget({ missedPositionKeys: ["unknown", "key-a"] }, cards)).toEqual({
      chapterId: "c2",
      nodeId: "n7"
    });
    expect(firstMissedTarget({ missedPositionKeys: ["unknown"] }, cards)).toBeNull();
  });
});
