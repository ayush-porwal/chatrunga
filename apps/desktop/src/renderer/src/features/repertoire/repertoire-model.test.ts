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
  transpositionsOf,
  hintStageText,
  isMissingTargetError,
  isNotFoundError,
  decisionDraftKey,
  decisionTextStatus,
  decisionTextValue,
  type DecisionTextDraft,
  occurrencesInOtherChapters,
  pieceNameAt,
  resumedHintText,
  revealText,
  sanOf
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

  it("marks nothing preferred when the stored preference is played at another occurrence", () => {
    // The position is shared with another chapter, where 1. c4 is accepted and preferred.
    const chapter = chapterOf(sampleChapter());
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", {
      acceptedUcis: ["c2c4", "e2e4", "d2d4"],
      preferredUci: "c2c4"
    });
    expect(view.rows.map((row) => row.state)).toEqual(["accepted", "accepted"]);
  });

  it("names covered and reference replies at an opponent-to-move position", () => {
    const chapter = chapterOf(sampleChapter(), {
      w1: { edge: "covered" },
      s0: { edge: "reference" }
    });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "w0", "white", null);
    expect(view.side).toBe("opponent");
    expect(view.rows.map((row) => [row.san, row.state, row.disabled])).toEqual([
      ["e5", "covered", false],
      ["c5", "reference", false]
    ]);
  });

  it("marks moves outside training scope as not trained here", () => {
    const tree = sampleChapter();
    const states = (chapter: ReturnType<typeof chapterOf>, nodeId: string) =>
      deriveChoices(chapter, buildChapterLookup(chapter), nodeId, "white", {
        acceptedUcis: ["e2e4"],
        preferredUci: "e2e4"
      }).rows.map((row) => [row.san, row.state, row.edge]);

    // A reference or disabled chapter trains nothing.
    expect(states(chapterOf(tree, {}, { kind: "reference" }), "root")).toEqual([
      ["e4", "untrained", "included"],
      ["d4", "untrained", "included"]
    ]);
    expect(states(chapterOf(tree, {}, { enabled: false }), "root")[0][1]).toBe("untrained");
    // Before a start marker further down the line.
    expect(
      states(chapterOf(tree, { w2: { edge: "included", trainingStart: true } }), "root")[0][1]
    ).toBe("untrained");
    // After a stop: the stop node's position is no card.
    expect(states(chapterOf(tree, { w1: { edge: "covered", trainingStop: true } }), "w1")).toEqual([
      ["Nf3", "untrained", "included"]
    ]);
    // Under a reference branch, and a disabled move.
    expect(states(chapterOf(tree, { w0: { edge: "reference" } }), "w1")[0][1]).toBe("untrained");
    expect(states(chapterOf(tree, { d0: { edge: "included", disabled: true } }), "root")).toEqual([
      ["e4", "preferred", "included"],
      ["d4", "untrained", "included"]
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
    expect(
      isStaleRevisionError("Invalid chapter.revision: chapter changed (stored 3, expected 2)")
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

  it("never says Saved while a prompt or hint is unsaved, saving or refused", () => {
    const idle = { dirty: false, saveState: { status: "idle" } } as const;
    const text = { dirty: true, saving: false, errorMessage: null, errorStale: false };
    expect(saveStatusLabel({ ...idle, decisionText: { ...text, dirty: false } })).toBe("Saved");
    expect(saveStatusLabel({ ...idle, decisionText: text })).toBe("Unsaved changes");
    expect(saveStatusLabel({ ...idle, decisionText: { ...text, saving: true } })).toBe("Saving…");
    expect(saveStatusLabel({ ...idle, decisionText: { ...text, errorMessage: "disk full" } })).toBe(
      "Unsaved — disk full"
    );
    // The chapter's own failure is named first.
    expect(
      saveStatusLabel({
        dirty: true,
        saveState: { status: "error", message: "chapter refused", stale: false },
        decisionText: { ...text, errorMessage: "prompt refused" }
      })
    ).toBe("Unsaved — chapter refused");
  });

  it("tells a deleted repertoire or chapter from other read failures", () => {
    expect(isNotFoundError("Invalid repertoireId: not found", "repertoire")).toBe(true);
    expect(isNotFoundError("Invalid chapterId: not found", "chapter")).toBe(true);
    expect(isNotFoundError("Invalid chapterId: not found", "repertoire")).toBe(false);
    expect(
      isNotFoundError(
        "Repertoire chapter c1 is damaged and can't be opened: the move tree is missing",
        "chapter"
      )
    ).toBe(false);
    expect(isNotFoundError("Invalid positionKey: not found in this repertoire", "chapter")).toBe(
      false
    );
    expect(isNotFoundError("SQLITE_BUSY: database is locked", "repertoire")).toBe(false);
  });
});

describe("decision text drafts", () => {
  const draftOf = (overrides: Partial<DecisionTextDraft>): DecisionTextDraft => ({
    repertoireId: "r1",
    positionKey: "k1",
    field: "prompt",
    text: "Develop",
    generation: 1,
    status: "pending",
    ...overrides
  });

  it("sends trimmed text, or null for a blank field", () => {
    expect(decisionTextValue("  Develop with tempo ")).toBe("Develop with tempo");
    expect(decisionTextValue("   ")).toBeNull();
  });

  it("keys a draft by repertoire, position and field", () => {
    expect(decisionDraftKey("r1", "k1", "prompt")).not.toBe(decisionDraftKey("r1", "k1", "hint"));
    expect(decisionDraftKey("r1", "k1", "hint")).not.toBe(decisionDraftKey("r2", "k1", "hint"));
  });

  it("summarises one repertoire's drafts for the save status", () => {
    const drafts = {
      a: draftOf({ status: "saving" }),
      b: draftOf({ field: "hint", status: "error", error: { message: "refused", stale: true } }),
      c: draftOf({ repertoireId: "r2", status: "error", error: { message: "x", stale: false } })
    };
    expect(decisionTextStatus(drafts, "r1")).toEqual({
      dirty: true,
      saving: true,
      errorMessage: "refused",
      errorStale: true
    });
    expect(decisionTextStatus(drafts, "r2")).toMatchObject({ errorStale: false, saving: false });
    expect(decisionTextStatus(drafts, "r3")).toEqual({
      dirty: false,
      saving: false,
      errorMessage: null,
      errorStale: false
    });
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

describe("cross-chapter occurrences", () => {
  it("keeps other chapters' occurrences once each", () => {
    const occurrence = (chapterId: string, nodeId: string) => ({
      chapterId,
      chapterTitle: chapterId,
      nodeId,
      path: "1. e4",
      ply: 1
    });
    expect(
      occurrencesInOtherChapters(
        [
          occurrence("c1", "n1"),
          occurrence("c2", "n4"),
          occurrence("c2", "n4"),
          occurrence("c3", "n2")
        ],
        "c1"
      ).map((item) => `${item.chapterId}:${item.nodeId}`)
    ).toEqual(["c2:n4", "c3:n2"]);
  });

  it("treats a deleted repertoire's refusal as a draft to drop", () => {
    expect(isMissingTargetError("Repertoire not found: r1")).toBe(true);
    expect(isMissingTargetError("Invalid expectedRevision: repertoire changed")).toBe(false);
  });
});

describe("practice text", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const promotion = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";

  it("names pieces and moves", () => {
    expect(pieceNameAt(start, "g1")).toBe("knight");
    expect(pieceNameAt(start, "e8")).toBe("king");
    expect(pieceNameAt(start, "e4")).toBeNull();
    expect(pieceNameAt(start, "z9")).toBeNull();
    expect(sanOf(start, "g1f3")).toBe("Nf3");
    expect(sanOf(start, "e2e5")).toBe("e2e5");
    expect(sanOf(promotion, "e7e8n")).toBe("e8=N");
  });

  it("describes a reveal in words", () => {
    expect(revealText(start, ["e2e4", "g1f3", "c2c4"], "g1f3")).toBe(
      "Preferred: Nf3 · also accepted: e4, c4"
    );
    expect(revealText(start, ["e2e4"], null)).toBe("Preferred: e4");
    expect(revealText(start, [], null)).toMatch(/No accepted move/);
  });

  it("describes board hints in words", () => {
    expect(hintStageText(start, 1, "g1f3")).toBeNull();
    expect(hintStageText(start, 2, "g1f3")).toBe("Move the knight");
    expect(hintStageText(start, 2, "e4e5")).toBe("Move the piece on e4");
    expect(hintStageText(start, 3, "g1f3")).toBe("g1 to f3");
    expect(hintStageText(start, 3, null)).toBeNull();
  });

  it("says which hints a resumed card already used", () => {
    expect(resumedHintText({ hintStage: 0, prompt: null })).toBeNull();
    expect(resumedHintText({ hintStage: 3, prompt: null })).toBe("Hints used earlier: the move.");
    expect(resumedHintText({ hintStage: 2, prompt: "Develop" })).toBe(
      "Develop · Hints used earlier: the piece to move."
    );
  });
});
