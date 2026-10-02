import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { GameReview, MoveReview } from "@chaturanga/shared/types/engine";

// The hook's effect runs once, outside React, against fake review events.
let cleanup: (() => void) | void;
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | void) => {
    cleanup = effect();
  }
}));
type Listener = (event: never) => void;
const listeners: Record<string, Listener> = {};
const on = (name: string) => (listener: Listener) => {
  listeners[name] = listener;
  return () => delete listeners[name];
};
const cancelReview = vi.fn(async () => undefined);
vi.stubGlobal("window", {
  ...globalThis,
  chaturanga: {
    engines: { cancelReview },
    events: {
      onReviewProgress: on("progress"),
      onReviewMoveCompleted: on("move"),
      onReviewCompleted: on("completed"),
      onReviewFailed: on("failed")
    }
  }
});

const { useReviewEventSubscription } = await import("./useReviewEventSubscription");
const { mainlineReviewInput } = await import("../features/game-review/review-utils");
const { useGameStore } = await import("../stores/game-store");
const { useReviewStore } = await import("../stores/review-store");

const emit = (name: string, event: unknown) => listeners[name](event as never);
const nodeBySan = (san: string) => useGameStore.getState().moveTree.find((node) => node.san === san)!;

/** A review run of the board's main line, as useReviewRunner starts one. */
function startRun(reviewId: string) {
  const input = mainlineReviewInput(useGameStore.getState().moveTree);
  useReviewStore.getState().startReview(reviewId, input.map((move) => ({ nodeId: move.nodeId, uci: move.uci })));
  const moves = input.map((move) => ({
    nodeId: move.nodeId,
    ply: move.ply,
    san: move.san,
    playedMove: move.uci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter
  }) as MoveReview);
  return { moves, review: { moves, createdAt: 1 } as unknown as GameReview };
}

describe("a running review and edits to the game", () => {
  beforeEach(() => {
    cancelReview.mockClear();
    useReviewStore.getState().reset();
    const { game } = importPgnText("1. e4 e5 *");
    useGameStore.getState().loadGame({ ...game, id: "g" });
    useReviewEventSubscription();
  });

  afterEach(() => cleanup?.());

  it("stops the run when analysed moves are deleted, and ignores its late result", () => {
    const { review } = startRun("run-1");
    useGameStore.getState().deleteLineFromNode(nodeBySan("e4").id);
    expect(cancelReview).toHaveBeenCalledWith("run-1");
    expect(useReviewStore.getState()).toMatchObject({ status: "idle", reviewId: null });

    emit("completed", { reviewId: "run-1", review });
    expect(useReviewStore.getState().review).toBeNull();
    expect(useReviewStore.getState().analyses).toEqual([]);
  });

  it("keeps the run going when the line is extended or a variation is added", () => {
    const { review } = startRun("run-1");
    useGameStore.getState().goToNode(nodeBySan("e5").id);
    useGameStore.getState().makeUciMove("g1f3");
    useGameStore.getState().goToNode(nodeBySan("e4").id);
    useGameStore.getState().makeUciMove("c7c5");
    expect(cancelReview).not.toHaveBeenCalled();
    expect(useReviewStore.getState().status).toBe("running");

    emit("completed", { reviewId: "run-1", review });
    expect(useReviewStore.getState()).toMatchObject({ status: "ready", review: { reviewId: "run-1" } });
  });

  it("rejects a result that arrives for a line the game no longer has", () => {
    const { review } = startRun("run-1");
    // The edit lands without the store update reaching the watcher (e.g. a whole new tree loaded
    // in one go before the result): the completion is still checked against the board.
    useReviewStore.setState({ status: "ready" });
    useGameStore.getState().deleteLineFromNode(nodeBySan("e5").id);
    useReviewStore.setState({ status: "running" });
    emit("completed", { reviewId: "run-1", review });
    expect(useReviewStore.getState().review).toBeNull();
    expect(useReviewStore.getState().reviewId).toBeNull();
  });
});
