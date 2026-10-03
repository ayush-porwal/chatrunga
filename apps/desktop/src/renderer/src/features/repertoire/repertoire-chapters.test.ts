import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { addLine, cardOf, rootNode } from "./__fixtures__/repertoire";
import {
  chapterOrderAfterMove,
  fenError,
  homeReviewAction,
  mostDue,
  nextSortOrder,
  plural,
  relativeDay,
  resumePracticeTarget,
  rootNodeFor,
  sortedChapters
} from "./repertoire-chapters";
import { missedPositions, nodeIdForPathLabel } from "./repertoire-model";

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

  it("moves a chapter one place, also among shared sort orders", () => {
    const distinct = [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 2 },
      { id: "c", sortOrder: 5 }
    ];
    expect(chapterOrderAfterMove(distinct, "b", 1)).toEqual([
      ["b", 5],
      ["c", 2]
    ]);
    expect(chapterOrderAfterMove(distinct, "a", -1)).toEqual([]);
    const tied = [
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 1 },
      { id: "c", sortOrder: 1 }
    ];
    const moved = new Map(chapterOrderAfterMove(tied, "a", 1));
    const order = tied
      .map((chapter) => ({ ...chapter, sortOrder: moved.get(chapter.id) ?? chapter.sortOrder }))
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((chapter) => chapter.id);
    expect(order).toEqual(["b", "a", "c"]);
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

  describe("homeReviewAction", () => {
    const e4 = { id: "e4", name: "My 1.e4", dueCount: 7 };
    const d4 = { id: "d4", name: "Queen's Gambit", dueCount: 5 };

    it("offers nothing when no decision is due", () => {
      expect(homeReviewAction({ dueCount: 0, repertoireCount: 0 }, [e4])).toBeNull();
      expect(homeReviewAction(undefined, [e4])).toBeNull();
    });

    it("keeps Review now when only one repertoire is due", () => {
      expect(
        homeReviewAction({ dueCount: 7, repertoireCount: 1 }, [e4, { ...d4, dueCount: 0 }])
      ).toEqual({ repertoireId: "e4", label: "Review now", showAll: false });
    });

    it("names the repertoire it opens and offers the hub when several are due", () => {
      expect(homeReviewAction({ dueCount: 12, repertoireCount: 2 }, [d4, e4])).toEqual({
        repertoireId: "e4",
        label: "Review My 1.e4 (7 due)",
        showAll: true
      });
    });

    it("breaks ties like the hub's Review due (first in list order)", () => {
      const tie = { ...d4, dueCount: 7 };
      expect(homeReviewAction({ dueCount: 14, repertoireCount: 2 }, [tie, e4])?.repertoireId).toBe(
        "d4"
      );
      expect(homeReviewAction({ dueCount: 14, repertoireCount: 2 }, [e4, tie])?.repertoireId).toBe(
        "e4"
      );
    });

    it("falls back to the hub while the repertoire list is missing", () => {
      const fallback = { repertoireId: null, label: "Review now", showAll: false };
      expect(homeReviewAction({ dueCount: 12, repertoireCount: 2 }, undefined)).toEqual(fallback);
      expect(homeReviewAction({ dueCount: 12, repertoireCount: 2 }, [])).toEqual(fallback);
    });
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

  it("lists every missed card it can place, in the summary's order, with its moves", () => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const afterE5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const cards = [
      cardOf("a", { chapterId: "c1", nodeId: "root", leadUp: [] }),
      cardOf("b", {
        chapterId: "c2",
        nodeId: "n7",
        leadUp: [
          { san: "e4", uci: "e2e4", fen: afterE4 },
          { san: "e5", uci: "e7e5", fen: afterE5 }
        ]
      })
    ];
    expect(missedPositions({ missedPositionKeys: ["key-b", "unknown", "key-a"] }, cards)).toEqual([
      { positionKey: "key-b", chapterId: "c2", nodeId: "n7", path: "1. e4 e5" },
      { positionKey: "key-a", chapterId: "c1", nodeId: "root", path: "Start" }
    ]);
    expect(missedPositions({ missedPositionKeys: ["unknown"] }, cards)).toEqual([]);
  });
});

describe("resume practice", () => {
  it("offers the unfinished session, for its own repertoire only", () => {
    const resume = { repertoireId: "r1", sessionId: "s1", mode: "rehearse-lines" as const };
    expect(resumePracticeTarget({ resume })).toEqual({
      ...resume,
      label: "Resume practice",
      description: "Pick up your unfinished line rehearsal where you left it"
    });
    expect(resumePracticeTarget({ resume }, "r1")?.sessionId).toBe("s1");
    expect(resumePracticeTarget({ resume }, "r2")).toBeNull();
    expect(resumePracticeTarget({ resume: { ...resume, mode: "review-due" } })?.description).toBe(
      "Pick up your unfinished review where you left it"
    );
    expect(resumePracticeTarget({ resume: null })).toBeNull();
    expect(resumePracticeTarget(undefined)).toBeNull();
  });
});
