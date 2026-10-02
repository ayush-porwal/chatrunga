import { describe, expect, it } from "vitest";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { addLine, cardOf, chapterOf, rootNode } from "./__fixtures__/repertoire";
import {
  autosaveStep,
  decisionCountWithMeta,
  decisionDeltaLabel,
  defaultEdgeForNewMove,
  deriveChoices,
  hintMarks,
  isStaleRevisionError,
  lastMoveOf,
  nextUnansweredIndex,
  numberedSan,
  pathLabel,
  revealArrows,
  saveStatusLabel,
  shouldAdoptSaveResult,
  totalsOf,
  trainableDecisionCount,
  transpositionsOf
} from "./repertoire-model";

/** 1. e4 e5 2. Nf3, with 1. d4 and 1... c5 as alternatives. */
function sampleChapter() {
  let tree = [rootNode()];
  ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "w"));
  ({ tree } = addLine(tree, "root", ["d2d4"], "d"));
  ({ tree } = addLine(tree, "w0", ["c7c5"], "s"));
  return tree;
}

describe("deriveChoices", () => {
  it("names accepted, preferred and reference continuations at a player-to-move position", () => {
    const chapter = chapterOf(sampleChapter(), { d0: { edge: "reference" } });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", null);
    expect(view.side).toBe("player");
    expect(view.rows.map((row) => [row.san, row.state])).toEqual([
      ["e4", "preferred"],
      ["d4", "reference"]
    ]);
  });

  it("follows a stored preference while it is supported", () => {
    const chapter = chapterOf(sampleChapter());
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", {
      acceptedUcis: ["e2e4", "d2d4"],
      preferredUci: "d2d4"
    });
    expect(view.rows.map((row) => row.state)).toEqual(["accepted", "preferred"]);
  });

  it("falls back to the first accepted move when the stored preference is a reference", () => {
    const chapter = chapterOf(sampleChapter(), { d0: { edge: "reference" } });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", {
      acceptedUcis: ["d2d4"],
      preferredUci: "d2d4"
    });
    expect(view.rows.map((row) => row.state)).toEqual(["preferred", "reference"]);
  });

  it("names covered and reference replies at an opponent-to-move position", () => {
    const chapter = chapterOf(sampleChapter(), {
      w1: { edge: "covered" },
      s0: { edge: "reference", disabled: true }
    });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "w0", "white", null);
    expect(view.side).toBe("opponent");
    expect(view.rows.map((row) => [row.san, row.state, row.disabled])).toEqual([
      ["e5", "covered", false],
      ["c5", "reference", true]
    ]);
  });

  it("returns nothing for an unknown node", () => {
    const chapter = chapterOf(sampleChapter());
    expect(deriveChoices(chapter, buildChapterLookup(chapter), "nope", "white", null).rows).toEqual(
      []
    );
  });
});

describe("boundaries", () => {
  it("defaults new own moves to reference and replies to covered", () => {
    const tree = sampleChapter();
    expect(defaultEdgeForNewMove(tree[0].fenAfter, "white")).toBe("reference");
    expect(defaultEdgeForNewMove(tree[0].fenAfter, "black")).toBe("covered");
  });

  it("counts trainable decisions and the effect of a boundary toggle", () => {
    const chapter = chapterOf(sampleChapter());
    // Root (1. e4 / 1. d4) and after 1... e5 (2. Nf3).
    expect(trainableDecisionCount("white", chapter)).toBe(2);
    expect(decisionCountWithMeta("white", chapter, "w0", { disabled: true })).toBe(1);
    expect(decisionCountWithMeta("white", chapter, "w1", { trainingStart: true })).toBe(1);
    expect(decisionDeltaLabel(0)).toBe("no change");
    expect(decisionDeltaLabel(-1)).toBe("−1 decision");
    expect(decisionDeltaLabel(3)).toBe("+3 decisions");
  });
});

describe("positions and labels", () => {
  it("finds transpositions within the chapter", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["g1f3", "g8f6", "b1c3"], "a"));
    ({ tree } = addLine(tree, "root", ["b1c3", "g8f6", "g1f3"], "b"));
    const lookup = buildChapterLookup({ tree });
    expect(transpositionsOf(lookup, "a2")).toEqual(["b2"]);
    expect(transpositionsOf(lookup, "a0")).toEqual([]);
    expect(transpositionsOf(lookup, "missing")).toEqual([]);
  });

  it("labels a path with move numbers", () => {
    const lookup = buildChapterLookup({ tree: sampleChapter() });
    expect(pathLabel(lookup, "root")).toBe("Start");
    expect(pathLabel(lookup, "w2")).toBe("1. e4 e5 2. Nf3");
    expect(pathLabel(lookup, "s0")).toBe("1. e4 c5");
    const afterE4 = lookup.nodesById.get("w0")!.fenAfter;
    expect(numberedSan(afterE4, "e5", true)).toBe("1... e5");
  });

  it("splits a UCI move into squares", () => {
    expect(lastMoveOf("e2e4")).toEqual(["e2", "e4"]);
    expect(lastMoveOf(null)).toBeNull();
  });
});

describe("autosave decisions", () => {
  it("adopts a save result only when nothing was edited meanwhile", () => {
    expect(shouldAdoptSaveResult(3, 3)).toBe(true);
    expect(shouldAdoptSaveResult(3, 4)).toBe(false);
  });

  it("recognises a stale-revision refusal", () => {
    expect(
      isStaleRevisionError("Invalid expectedRevision: repertoire changed (stored 5, expected 4)")
    ).toBe(true);
    expect(isStaleRevisionError("Invalid chapter: tree has no root")).toBe(false);
  });

  it("schedules, waits or blocks", () => {
    expect(autosaveStep({ dirty: false, saveState: { status: "idle" } })).toBe("idle");
    expect(autosaveStep({ dirty: true, saveState: { status: "idle" } })).toBe("schedule");
    expect(autosaveStep({ dirty: true, saveState: { status: "saving" } })).toBe("wait");
    expect(
      autosaveStep({ dirty: true, saveState: { status: "error", message: "x", stale: true } })
    ).toBe("blocked");
  });

  it("labels the save state", () => {
    expect(saveStatusLabel({ dirty: false, saveState: { status: "idle" } })).toBe("Saved");
    expect(saveStatusLabel({ dirty: true, saveState: { status: "idle" } })).toBe("Unsaved changes");
    expect(saveStatusLabel({ dirty: true, saveState: { status: "saving" } })).toBe("Saving…");
    expect(
      saveStatusLabel({
        dirty: true,
        saveState: { status: "error", message: "disk full", stale: false }
      })
    ).toBe("Unsaved — disk full");
  });
});

describe("practice helpers", () => {
  it("recomputes totals from card states", () => {
    const totals = totalsOf([
      cardOf("a", { state: "answered-correct" }),
      cardOf("b", { state: "revealed" }),
      cardOf("c", { state: "skipped" }),
      cardOf("d", { state: "answered-wrong" }),
      cardOf("e")
    ]);
    expect(totals).toEqual({
      total: 5,
      answered: 4,
      correct: 1,
      wrong: 1,
      revealed: 1,
      skipped: 1,
      remaining: 1
    });
  });

  it("finds the next unanswered card, wrapping around", () => {
    const cards = [
      cardOf("a"),
      cardOf("b", { state: "skipped" }),
      cardOf("c", { state: "revealed" })
    ];
    expect(nextUnansweredIndex(cards, 2)).toBe(0);
    // The current card itself comes back last (it is still unanswered after a wrong move).
    expect(nextUnansweredIndex(cards, 0)).toBe(0);
    expect(nextUnansweredIndex([cardOf("a", { state: "skipped" })], 0)).toBe(-1);
  });

  it("marks hint stages and reveals on the board", () => {
    expect(hintMarks(1, "g1f3")).toEqual({ arrows: [], highlights: [] });
    expect(hintMarks(2, "g1f3").highlights).toEqual([{ square: "g1", color: "green" }]);
    expect(hintMarks(3, "g1f3").arrows).toEqual([{ orig: "g1", dest: "f3", color: "green" }]);
    expect(hintMarks(3, null)).toEqual({ arrows: [], highlights: [] });
    expect(revealArrows(["e2e4", "d2d4"], "d2d4")).toEqual([
      { orig: "e2", dest: "e4", color: "blue" },
      { orig: "d2", dest: "d4", color: "green" }
    ]);
  });
});
