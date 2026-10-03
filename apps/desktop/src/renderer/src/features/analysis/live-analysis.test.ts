import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { liveAnalysisSubject, type AnalysisBoard } from "./live-analysis";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
/** Fool's mate: White is mated. */
const MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

function node(input: Partial<MoveNode> & Pick<MoveNode, "id" | "parentId">): MoveNode {
  return {
    san: null,
    uci: null,
    fenBefore: START,
    fenAfter: START,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: [],
    ...input
  };
}

function board(patch: Partial<AnalysisBoard> = {}): AnalysisBoard {
  return {
    mode: "analysis",
    rootFen: START,
    currentNodeId: "a",
    currentFen: AFTER_E4,
    moveTree: [
      node({ id: "root", parentId: null, children: ["a"] }),
      node({ id: "a", parentId: "root", san: "e4", uci: "e2e4", fenAfter: AFTER_E4 })
    ],
    gameOutcome: null,
    ...patch
  };
}

describe("liveAnalysisSubject", () => {
  it("searches the board's position in analysis mode, keyed by its root, node and position", () => {
    const subject = liveAnalysisSubject(board());
    expect(subject?.key).toBe(`${START}|a|${AFTER_E4}`);
    expect(subject?.rootFen).toBe(START);
    expect(subject?.fen).toBe(AFTER_E4);
    expect(subject?.moves()).toEqual(["e2e4"]);
  });

  it("searches nothing outside analysis mode, in a decided game or at a finished position", () => {
    expect(liveAnalysisSubject(board({ mode: "freeplay" }))).toBeNull();
    expect(liveAnalysisSubject(board({ mode: "engine" }))).toBeNull();
    expect(liveAnalysisSubject(board({ gameOutcome: { result: "1-0" } }))).toBeNull();
    expect(liveAnalysisSubject(board({ currentFen: MATED }))).toBeNull();
  });
});
