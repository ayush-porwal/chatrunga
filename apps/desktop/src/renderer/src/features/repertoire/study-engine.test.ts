import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { addLine, chapterOf, rootNode } from "./__fixtures__/repertoire";
import { sanLineToUcis, studyAnalysisTarget } from "./study-engine";

describe("studyAnalysisTarget", () => {
  it("searches the selected move with the chapter's route to it from its root", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "w"));
    ({ tree } = addLine(tree, "w0", ["c7c5"], "s"));
    const chapter = chapterOf(tree);
    const node = tree.find((item) => item.id === "s0")!;
    expect(studyAnalysisTarget(chapter, node)).toEqual({
      owner: `study:${chapter.id}`,
      nodeId: "s0",
      rootFen: chapter.rootFen,
      moves: ["e2e4", "c7c5"],
      fen: node.fenAfter
    });
  });

  it("searches the chapter's starting position with no moves at its root", () => {
    const chapter = chapterOf([rootNode()]);
    expect(studyAnalysisTarget(chapter, chapter.tree[0]!)).toMatchObject({
      nodeId: "root",
      moves: [],
      fen: START_FEN
    });
  });
});

describe("sanLineToUcis", () => {
  it("reads a line's SAN moves as UCI, castling as the king's move", () => {
    expect(sanLineToUcis(START_FEN, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O"])).toEqual([
      "e2e4",
      "e7e5",
      "g1f3",
      "b8c6",
      "f1c4",
      "g8f6",
      "e1g1"
    ]);
  });

  it("is empty for an empty line and null once a move doesn't fit the position", () => {
    expect(sanLineToUcis(START_FEN, [])).toEqual([]);
    expect(sanLineToUcis(START_FEN, ["e4", "e4"])).toBeNull();
    expect(sanLineToUcis(START_FEN, ["not a move"])).toBeNull();
  });
});
