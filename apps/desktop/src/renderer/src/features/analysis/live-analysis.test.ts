import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  engineHolder,
  liveAnalysisSubject,
  type AnalysisBoard,
  type AnalysisTarget
} from "./live-analysis";

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
    engineSide: null,
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

describe("engineHolder", () => {
  it("is an engine game still being played, or a live Lichess game", () => {
    expect(engineHolder(board({ mode: "engine", engineSide: "black" }), false)).toBe("engine-game");
    expect(engineHolder(board({ mode: "analysis" }), true)).toBe("online-game");
  });

  it("is nobody once the engine game is decided, or outside a game", () => {
    expect(
      engineHolder(
        board({ mode: "engine", engineSide: "black", gameOutcome: { result: "1-0" } }),
        false
      )
    ).toBeNull();
    // An engine game set up without the engine's side yet (nothing asks it for a move).
    expect(engineHolder(board({ mode: "engine", engineSide: null }), false)).toBeNull();
    expect(engineHolder(board({ mode: "analysis" }), false)).toBeNull();
  });
});

describe("liveAnalysisSubject with a target", () => {
  const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
  const target: AnalysisTarget = {
    owner: "chapter-1",
    nodeId: "m2",
    rootFen: START,
    moves: ["e2e4", "e7e5"],
    fen: AFTER_E4_E5
  };

  it("searches the target instead of the board, whatever the board's mode", () => {
    for (const mode of ["analysis", "freeplay"] as const) {
      const subject = liveAnalysisSubject(board({ mode }), { target });
      expect(subject?.key).toBe(`target|chapter-1|${START}|m2|${AFTER_E4_E5}`);
      expect(subject?.rootFen).toBe(START);
      expect(subject?.fen).toBe(AFTER_E4_E5);
      expect(subject?.moves()).toEqual(["e2e4", "e7e5"]);
    }
  });

  it("never shares a key with the board's own search of the same position", () => {
    const sameNode = { ...target, nodeId: "a", moves: ["e2e4"], fen: AFTER_E4 };
    expect(liveAnalysisSubject(board(), { target: sameNode })?.key).not.toBe(
      liveAnalysisSubject(board())?.key
    );
  });

  it("waits while a game holds the engine, and searches no finished position", () => {
    expect(
      liveAnalysisSubject(board({ mode: "engine", engineSide: "white" }), { target })
    ).toBeNull();
    expect(liveAnalysisSubject(board(), { target, onlineGameLive: true })).toBeNull();
    expect(liveAnalysisSubject(board(), { target: { ...target, fen: MATED } })).toBeNull();
  });
});
