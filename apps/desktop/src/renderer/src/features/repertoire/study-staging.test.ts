import { describe, expect, it } from "vitest";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { addLine, chapterOf, rootNode } from "./__fixtures__/repertoire";
import {
  chapterWithLines,
  chapterWithStaged,
  dropStaged,
  liveStaged,
  moveLabel,
  playUcis,
  shownChapter,
  stagedLines,
  stagedSummary,
  stageLine,
  treeWithStaged
} from "./study-staging";

/** 1. e4 e5 2. Nf3 (w0–w2), with 1... c5 (s0) beside 1... e5. */
function sampleTree() {
  let tree = [rootNode()];
  ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "w"));
  ({ tree } = addLine(tree, "w0", ["c7c5"], "s"));
  return tree;
}

/** `ucis` staged from `fromId` of `tree` (after `staged`). */
function stage(tree: MoveNode[], fromId: string, ucis: string[], staged: MoveNode[] = []) {
  const from = treeWithStaged(tree, staged).find((node) => node.id === fromId)!;
  return stageLine(tree, staged, fromId, playUcis(from.fenAfter, ucis)!)!;
}

describe("staging moves beside the chapter", () => {
  it("hangs staged moves under their parents in the shown tree, leaving the chapter's alone", () => {
    const tree = sampleTree();
    expect(treeWithStaged(tree, [])).toBe(tree);
    const { staged, nodeId } = stage(tree, "w2", ["b8c6", "f1c4"]);
    const shown = treeWithStaged(tree, staged);
    expect(shown.find((node) => node.id === "w2")!.children).toStrictEqual([staged[0].id]);
    expect(staged[0].children).toStrictEqual([nodeId]);
    expect(tree.find((node) => node.id === "w2")!.children).toStrictEqual([]);
    expect(staged.map((node) => node.san)).toStrictEqual(["Nc6", "Bc4"]);
  });

  it("follows moves the chapter or the staged moves have", () => {
    const tree = sampleTree();
    expect(stage(tree, "root", ["e2e4", "e7e5"])).toStrictEqual({ staged: [], nodeId: "w1" });
    const first = stage(tree, "w2", ["b8c6"]);
    const again = stage(tree, "w2", ["b8c6", "f1c4"], first.staged);
    expect(again.staged).toHaveLength(2);
    expect(again.staged[0].id).toBe(first.staged[0].id);
    expect(stageLine(tree, [], "missing", [])).toBeNull();
  });

  it("drops a staged move with what follows it", () => {
    const tree = sampleTree();
    const { staged } = stage(tree, "w2", ["b8c6", "f1c4", "g8f6"]);
    const kept = dropStaged(staged, staged[1].id);
    expect(kept.map((node) => node.san)).toStrictEqual(["Nc6"]);
    expect(kept[0].children).toStrictEqual([]);
  });

  it("keeps only staged moves still hanging from the chapter", () => {
    const tree = sampleTree();
    const { staged } = stage(tree, "w2", ["b8c6", "f1c4"]);
    expect(liveStaged(tree, staged)).toBe(staged);
    // Nf3 deleted (or undone): its staged moves go with it.
    const without = tree.filter((node) => node.id !== "w2");
    expect(liveStaged(without, staged)).toStrictEqual([]);
    // The chapter now has 2...Nc6 itself (a redo): the staged copy goes.
    let redone = sampleTree();
    ({ tree: redone } = addLine(redone, "w2", ["b8c6"], "r"));
    expect(liveStaged(redone, staged)).toStrictEqual([]);
  });

  it("shows staged moves as study-only until they are added", () => {
    const chapter = chapterOf(sampleTree());
    const { staged } = stage(chapter.tree, "w2", ["b8c6"]);
    expect(shownChapter(chapter, [])).toBe(chapter);
    expect(shownChapter(chapter, staged).nodeMeta[staged[0].id]).toStrictEqual({
      edge: "reference"
    });
  });

  it("adds the player's moves as practised (or study-only) and the opponent's as covered", () => {
    const chapter = chapterOf(sampleTree());
    const { staged } = stage(chapter.tree, "w2", ["b8c6", "f1c4"]);
    const added = chapterWithStaged(chapter, staged, "white");
    expect(added.tree).toHaveLength(7);
    expect(added.nodeMeta[staged[0].id]).toStrictEqual({ edge: "covered" });
    expect(added.nodeMeta[staged[1].id]).toStrictEqual({ edge: "included" });
    const studyOnly = chapterWithStaged(chapter, staged, "white", { studyOnly: true });
    expect(studyOnly.nodeMeta[staged[1].id]).toStrictEqual({ edge: "reference" });
    expect(chapterWithStaged(chapter, [], "white")).toBe(chapter);
  });

  it("lists the staged lines from the chapter's start, one per line end", () => {
    const tree = sampleTree();
    let { staged } = stage(tree, "w2", ["b8c6", "f1c4"]);
    ({ staged } = stage(tree, "s0", ["g1f3"], staged));
    expect(stagedLines(tree, staged)).toStrictEqual([
      ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"],
      ["e2e4", "c7c5", "g1f3"]
    ]);
  });
});

describe("adding staged lines to another chapter", () => {
  const line = ["e2e4", "e7e5", "g1f3", "b8c6"];

  it("follows the chapter's moves from a shared start and adds the rest", () => {
    const target = chapterOf(sampleTree(), { w2: { edge: "reference" } }, { id: "c2" });
    const added = chapterWithLines(target, {
      rootFen: target.rootFen,
      lines: [line],
      color: "white"
    })!;
    expect(added.chapter.tree).toHaveLength(6);
    const end = added.chapter.tree.find((node) => node.id === added.nodeId)!;
    expect(end).toMatchObject({ parentId: "w2", san: "Nc6" });
    expect(added.chapter.nodeMeta[end.id]).toStrictEqual({ edge: "covered" });
    // A move the chapter has keeps its kind.
    expect(added.chapter.nodeMeta.w2).toStrictEqual({ edge: "reference" });
  });

  it("returns the chapter itself when it has the lines already (no edit to undo or save)", () => {
    const target = chapterOf(sampleTree(), {}, { id: "c2" });
    const added = chapterWithLines(target, {
      rootFen: target.rootFen,
      lines: [["e2e4", "e7e5", "g1f3"]],
      color: "white"
    })!;
    expect(added.chapter).toBe(target);
    expect(added.nodeId).toBe("w2");
  });

  it("joins a chapter starting later at the line's position (a transposition)", () => {
    const after = playUcis(rootNode().fenAfter, ["e2e4", "e7e5"])!;
    const target = chapterOf([rootNode(after[1].fenAfter)], {}, { rootFen: after[1].fenAfter });
    const added = chapterWithLines(target, {
      rootFen: rootNode().fenAfter,
      lines: [line],
      color: "white"
    })!;
    expect(added.chapter.tree.map((node) => node.san)).toStrictEqual([null, "Nf3", "Nc6"]);
  });

  it("refuses a chapter the line never reaches", () => {
    const elsewhere = playUcis(rootNode().fenAfter, ["d2d4"])!;
    const target = chapterOf(
      [rootNode(elsewhere[0].fenAfter)],
      {},
      {
        rootFen: elsewhere[0].fenAfter
      }
    );
    expect(
      chapterWithLines(target, { rootFen: rootNode().fenAfter, lines: [line], color: "white" })
    ).toBeNull();
  });
});

describe("what the New moves card says", () => {
  it("labels moves as a line reads them", () => {
    const tree = sampleTree();
    expect(moveLabel(tree[0].fenAfter, "e4")).toBe("1.e4");
    expect(moveLabel(tree[1].fenAfter, "e5")).toBe("1…e5");
  });

  it("names a new move of yours, and a reply waiting for your answer", () => {
    const chapter = chapterOf(sampleTree());
    const { staged } = stage(chapter.tree, "w2", ["b8c6"]);
    expect(stagedSummary({ chapter, staged, color: "white" })).toStrictEqual({
      chips: [{ nodeId: staged[0].id, label: "2…Nc6" }],
      sentences: ["2…Nc6 is a reply you'll cover; play your answer to practise it."],
      practiceMoves: 0
    });
    const answered = stage(chapter.tree, "w2", ["b8c6", "f1c4"]);
    expect(stagedSummary({ chapter, staged: answered.staged, color: "white" })).toMatchObject({
      sentences: ["2…Nc6 becomes a reply you prepare for.", "3.Bc4 becomes your move here."],
      practiceMoves: 1
    });
  });

  it("names the moves you already play there, in this chapter and practised elsewhere", () => {
    const chapter = chapterOf(sampleTree());
    // After 1. e4 e5, 2. Bc4 beside the chapter's 2. Nf3; another chapter practises 2. Nc3.
    const { staged } = stage(chapter.tree, "w1", ["f1c4"]);
    const key = buildChapterLookup(chapter).positionKeys.get("w1")!;
    const summary = stagedSummary({
      chapter,
      staged,
      color: "white",
      practisedElsewhere: { [key]: ["b1c3", "g1f3"] }
    });
    expect(summary.sentences).toStrictEqual([
      "2.Bc4 becomes another move of yours here (you also play 2.Nf3, 2.Nc3)."
    ]);
    expect(summary.practiceMoves).toBe(1);
  });

  it("says when the moves stay study-only, and when the line transposes into another chapter", () => {
    const chapter = chapterOf(sampleTree(), {}, { kind: "reference" });
    const { staged } = stage(chapter.tree, "w2", ["b8c6", "f1c4"]);
    const summary = stagedSummary({ chapter, staged, color: "white", transposesTo: "Italian" });
    expect(summary.practiceMoves).toBe(0);
    expect(summary.sentences).toStrictEqual([
      "2…Nc6 is added as study-only: this line isn't practised.",
      "3.Bc4 is added as study-only: this line isn't practised.",
      "Already in Italian — sidelines by transposition."
    ]);
  });

  it("says nothing without staged moves", () => {
    expect(
      stagedSummary({ chapter: chapterOf(sampleTree()), staged: [], color: "white" })
    ).toStrictEqual({
      chips: [],
      sentences: [],
      practiceMoves: 0
    });
  });
});
