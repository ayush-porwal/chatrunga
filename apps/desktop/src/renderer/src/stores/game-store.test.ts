import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEngineGoClock, useGameStore } from "./game-store";

describe("game store", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it("deletes a selected move and its descendants", () => {
    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
    const e4NodeId = useGameStore.getState().currentNodeId;

    expect(useGameStore.getState().makeMove({ from: "e7", to: "e5" })).toBe(true);
    const e5NodeId = useGameStore.getState().currentNodeId;

    expect(useGameStore.getState().deleteLineFromNode(e4NodeId)).toBe(true);

    const state = useGameStore.getState();
    expect(state.currentNodeId).toBe("root");
    expect(state.moveTree.some((node) => node.id === e4NodeId || node.id === e5NodeId)).toBe(false);
    expect(state.moveTree.find((node) => node.id === "root")?.children).toEqual([]);
  });

  it("does not delete the root position", () => {
    expect(useGameStore.getState().deleteLineFromNode("root")).toBe(false);
    expect(useGameStore.getState().currentNodeId).toBe("root");
  });

  it("rejects illegal engine moves and accepts legal UCI moves", () => {
    expect(useGameStore.getState().makeUciMove("e2e5")).toBe(false);
    expect(useGameStore.getState().lastError).toContain("illegal move");

    expect(useGameStore.getState().makeUciMove("e2e4")).toBe(true);
    expect(useGameStore.getState().lastError).toBeNull();
    expect(useGameStore.getState().currentFen).toContain(" b ");
  });

  it("supports navigation, annotations, orientation, and session export", () => {
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    const e4NodeId = useGameStore.getState().currentNodeId;
    useGameStore.getState().makeMove({ from: "e7", to: "e5" });
    const e5NodeId = useGameStore.getState().currentNodeId;

    useGameStore.getState().undo();
    expect(useGameStore.getState().currentNodeId).toBe(e4NodeId);
    useGameStore.getState().redo();
    expect(useGameStore.getState().currentNodeId).toBe(e5NodeId);

    useGameStore.getState().flip();
    useGameStore.getState().setNodeAnnotations(e5NodeId, {
      arrows: [{ orig: "e2", dest: "e4", color: "green" }],
      highlights: [{ square: "e4", color: "yellow" }]
    });

    expect(useGameStore.getState().orientation).toBe("black");
    expect(useGameStore.getState().toSession().pgn).toContain("1. e4 e5");
    expect(useGameStore.getState().moveTree.find((node) => node.id === e5NodeId)?.arrows).toHaveLength(1);
  });

  it("finishes engine matches through draw, resign, and timeout paths", () => {
    useGameStore.getState().setMode("engine");
    useGameStore.getState().setEngineSide("black");

    useGameStore.getState().agreeDraw();
    expect(useGameStore.getState().gameOutcome).toEqual({
      result: "1/2-1/2",
      termination: "Draw by agreement"
    });

    useGameStore.getState().reset();
    useGameStore.getState().setMode("engine");
    useGameStore.getState().setEngineSide("black");
    useGameStore.getState().resign();
    expect(useGameStore.getState().gameOutcome).toMatchObject({ result: "0-1" });

    useGameStore.getState().reset();
    useGameStore.getState().resolveTimeout("black");
    expect(useGameStore.getState().gameOutcome).toMatchObject({
      result: "1-0",
      termination: "Time forfeit"
    });
  });

  it("builds UCI clock snapshots and advances live clocks after moves", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_500)
      .mockReturnValueOnce(2_500);

    useGameStore.getState().setEngineMatchClock({ initialMs: 10_000, incrementMs: 500 });
    useGameStore.getState().initEngineClockLive();
    expect(useGameStore.getState().engineClockLive).toMatchObject({
      whiteMs: 10_000,
      blackMs: 10_000,
      sideToMove: "white"
    });

    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
    expect(useGameStore.getState().engineClockLive).toMatchObject({
      whiteMs: 9_000,
      blackMs: 10_000,
      sideToMove: "black"
    });
    vi.restoreAllMocks();
  });

  it("buildEngineGoClock clamps elapsed time and increments", () => {
    expect(
      buildEngineGoClock(
        { whiteMs: 10, blackMs: 20, turnStartedAt: 0, sideToMove: "white" },
        { initialMs: 30, incrementMs: -5 },
        100
      )
    ).toEqual({ wtime: 1, btime: 20, winc: 0, binc: 0 });
  });
});
