import { beforeEach, describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";
import { activeBestLine, openBestLine } from "../game/best-line-cursor";
import { activeScratchLine, nodeBefore, type ScratchLine } from "../game/scratch-line";
import { uciLineSteps } from "./review-utils";
import {
  followGameMoves,
  playOnScratchLine,
  playScratchLine,
  playScratchMove,
  scratchStep
} from "./scratch-moves";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function game(pgn = "1. e4 e5 2. Nf3 Nc6 *"): MoveNode[] {
  return importPgnText(pgn).game.moveTree;
}

function nodeBySan(tree: readonly MoveNode[], san: string): MoveNode {
  const node = tree.find((item) => item.san === san);
  if (!node) throw new Error(`no ${san}`);
  return node;
}

/** `move` played from `fen` (it throws when it is illegal there). */
function stepOf(fen: string, move: string) {
  const step = scratchStep(fen, move);
  if (!step) throw new Error(`illegal ${move}`);
  return step;
}

function line(tree: readonly MoveNode[], from: string, moves: string[], index = moves.length - 1) {
  const anchor = nodeBySan(tree, from);
  const followed = followGameMoves(tree, anchor.id, moves);
  if (!followed) throw new Error("illegal line");
  const scratch: ScratchLine = {
    originNodeId: anchor.id,
    anchorNodeId: followed.node.id,
    moves: followed.rest,
    index
  };
  return scratch;
}

describe("scratchStep", () => {
  it("plays a SAN or UCI move, and refuses an illegal one", () => {
    expect(scratchStep(START, "e4")?.uci).toBe("e2e4");
    expect(scratchStep(START, "g1f3")?.san).toBe("Nf3");
    expect(scratchStep(START, "e5")).toBeNull();
    expect(scratchStep("not a fen", "e4")).toBeNull();
  });
});

describe("followGameMoves", () => {
  it("walks the game's own moves and keeps the rest as moves off the game", () => {
    const tree = game();
    const followed = followGameMoves(tree, "root", ["e4", "e5", "Bc4", "Nf6"]);
    expect(followed?.node.san).toBe("e5");
    expect(followed?.rest.map((step) => step.san)).toStrictEqual(["Bc4", "Nf6"]);
  });

  it("follows a whole line of the game with nothing left over", () => {
    const tree = game();
    const followed = followGameMoves(tree, "root", ["e2e4", "e7e5", "g1f3"]);
    expect(followed?.node.san).toBe("Nf3");
    expect(followed?.rest).toStrictEqual([]);
  });

  it("refuses an unknown start or an illegal move", () => {
    const tree = game();
    expect(followGameMoves(tree, "nope", ["e4"])).toBeNull();
    expect(followGameMoves(tree, "root", ["e4", "e4"])).toBeNull();
  });

  it("stops following the game once the line has left it", () => {
    // 1. d4 leaves the game; the reply e5 is the line's own, though the game also has an e5.
    const tree = game();
    const followed = followGameMoves(tree, "root", ["d4", "e5"]);
    expect(followed?.node.id).toBe("root");
    expect(followed?.rest.map((step) => step.san)).toStrictEqual(["d4", "e5"]);
  });
});

describe("playOnScratchLine", () => {
  it("plays on from the move shown, dropping the moves after it", () => {
    const tree = game();
    const scratch = line(tree, "Nc6", ["Bc4", "Nf6", "Ng5"], 0);
    const next = playOnScratchLine(scratch, stepOf(scratch.moves[0].fenAfter, "Bc5"));
    expect(next.moves.map((move) => move.san)).toStrictEqual(["Bc4", "Bc5"]);
    expect(next.index).toBe(1);
  });

  it("steps on when the move played is the line's next one", () => {
    const tree = game();
    const scratch = line(tree, "Nc6", ["Bc4", "Nf6", "Ng5"], 0);
    expect(playOnScratchLine(scratch, stepOf(scratch.moves[0].fenAfter, "Nf6"))).toStrictEqual({
      ...scratch,
      index: 1
    });
  });
});

describe("activeScratchLine", () => {
  it("is the line while the game is on its origin and the board on its move", () => {
    const tree = game();
    const scratch = line(tree, "Nc6", ["Bc4", "Nf6"], 1);
    const state = {
      scratchLine: scratch,
      currentNodeId: scratch.originNodeId,
      currentFen: scratch.moves[1].fenAfter
    };
    expect(activeScratchLine(state)).toBe(scratch);
    // Another position, or another game move: the line is left behind.
    expect(activeScratchLine({ ...state, currentFen: START })).toBeNull();
    expect(activeScratchLine({ ...state, currentNodeId: "root" })).toBeNull();
    expect(activeScratchLine({ ...state, scratchLine: null })).toBeNull();
  });
});

describe("nodeBefore", () => {
  it("walks back along the game, stopping at the start", () => {
    const tree = game();
    const nc6 = nodeBySan(tree, "Nc6");
    expect(nodeBefore(tree, nc6.id, 2)).toBe(nodeBySan(tree, "e5").id);
    expect(nodeBefore(tree, nc6.id, 0)).toBe(nc6.id);
    expect(nodeBefore(tree, nc6.id, 10)).toBe("root");
  });
});

describe("the review board's scratch line in the game store", () => {
  beforeEach(() => useGameStore.getState().reset());

  const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 *";
  /** The game loaded and on `san`; its tree (which no scratch move may change). */
  function onMove(san: string) {
    useGameStore.getState().loadGame(importPgnText(pgn).game);
    const tree = useGameStore.getState().moveTree;
    const node = tree.find((item) => item.san === san)!;
    useGameStore.getState().goToNode(node.id);
    return { node, tree };
  }
  const shownSan = () => {
    const line = activeScratchLine(useGameStore.getState());
    return line ? line.moves[line.index].san : null;
  };

  it("plays board moves into a scratch line without touching the game's moves", () => {
    const { node, tree } = onMove("Nd4");
    expect(playScratchMove("f3d4")).toBe(true);
    expect(playScratchMove("e5d4")).toBe(true);
    const state = useGameStore.getState();
    expect(state.moveTree).toBe(tree);
    expect(state.currentNodeId).toBe(node.id);
    const line = activeScratchLine(state);
    expect(line?.moves.map((move) => move.san)).toStrictEqual(["Nxd4", "exd4"]);
    expect(line?.anchorNodeId).toBe(node.id);
    expect(state.currentFen).toBe(line?.moves[1].fenAfter);
    // An illegal move is refused and the line stays.
    expect(playScratchMove("a1a8")).toBe(false);
    expect(shownSan()).toBe("exd4");
  });

  it("goes to a game move the board move repeats instead of starting a line", () => {
    const { node, tree } = onMove("Nd4");
    expect(playScratchMove("f3e5")).toBe(true);
    const state = useGameStore.getState();
    expect(state.moveTree).toBe(tree);
    expect(activeScratchLine(state)).toBeNull();
    expect(state.moveTree.find((item) => item.id === state.currentNodeId)?.parentId).toBe(node.id);
  });

  it("steps along the line and back onto the game, ←/→ and the move buttons alike", () => {
    const { node } = onMove("Nd4");
    for (const move of ["f3d4", "e5d4", "e1g1"]) playScratchMove(move);
    useGameStore.getState().undo();
    expect(shownSan()).toBe("exd4");
    expect(useGameStore.getState().stepScratchLine(-1)).toBe(true);
    expect(shownSan()).toBe("Nxd4");
    useGameStore.getState().redo();
    expect(shownSan()).toBe("exd4");
    // Past the end it stays on the last move.
    useGameStore.getState().stepScratchLine(5);
    expect(shownSan()).toBe("O-O");
    // Back before the first move: the game move it hangs off, then on back along the game.
    useGameStore.getState().stepScratchLine(-4);
    const state = useGameStore.getState();
    expect(activeScratchLine(state)).toBeNull();
    expect(state.currentNodeId).toBe(node.parentId);
    expect(useGameStore.getState().stepScratchLine(1)).toBe(false);
  });

  it("plays on from an earlier move of the line, replacing the moves after it", () => {
    onMove("Nd4");
    for (const move of ["f3d4", "e5d4", "e1g1"]) playScratchMove(move);
    useGameStore.getState().stepScratchLine(-2);
    playScratchMove("c7c5");
    const line = activeScratchLine(useGameStore.getState());
    expect(line?.moves.map((move) => move.san)).toStrictEqual(["Nxd4", "c5"]);
    expect(line?.index).toBe(1);
  });

  it("leaves the line for any game move, and forgets it", () => {
    const { node } = onMove("Nd4");
    playScratchMove("f3d4");
    useGameStore.getState().goToNode(node.id);
    const state = useGameStore.getState();
    expect(state.scratchLine).toBeNull();
    expect(state.currentFen).toBe(node.fenAfter);
  });

  it("plays a coach's line as a scratch line, the game staying on the move it was asked from", () => {
    const { tree } = onMove("Nxe5");
    const error = tree.find((item) => item.san === "Nxe5")!;
    // The engine's better 4. Nxd4 exd4 5. O-O, from 3… Nd4.
    expect(playScratchLine(error.id, error.parentId!, ["Nxd4", "exd4", "O-O"])).toBe(true);
    const state = useGameStore.getState();
    expect(state.moveTree).toBe(tree);
    expect(state.currentNodeId).toBe(error.id);
    const line = activeScratchLine(state);
    expect(line?.anchorNodeId).toBe(error.parentId);
    expect(line?.index).toBe(2);
    // A line of the game's own moves just goes there.
    playScratchLine(error.id, "root", ["e4", "e5"]);
    const after = useGameStore.getState();
    expect(activeScratchLine(after)).toBeNull();
    expect(after.moveTree.find((item) => item.id === after.currentNodeId)?.san).toBe("e5");
    // An illegal line changes nothing.
    expect(playScratchLine(error.id, "root", ["e5"])).toBe(false);
    expect(useGameStore.getState().currentNodeId).toBe(after.currentNodeId);
  });

  it("plays on from a BEST line's position into a scratch line, not the game", () => {
    const { tree } = onMove("Nxe5");
    const error = tree.find((item) => item.san === "Nxe5")!;
    const steps = uciLineSteps(error.fenBefore, ["f3d4", "e5d4", "e1g1"]);
    useGameStore.getState().showBestLine(openBestLine(error.id, error.parentId!, steps, 1)!);
    expect(playScratchMove("d2d3")).toBe(true);
    const state = useGameStore.getState();
    expect(state.moveTree).toBe(tree);
    expect(activeBestLine(state)).toBeNull();
    const line = activeScratchLine(state);
    expect(line?.moves.map((move) => move.san)).toStrictEqual(["Nxd4", "exd4", "d3"]);
    expect(line?.originNodeId).toBe(error.id);
    expect(line?.anchorNodeId).toBe(error.parentId);
  });
});
