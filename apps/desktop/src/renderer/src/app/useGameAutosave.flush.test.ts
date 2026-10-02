import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import type { GameReview } from "@chaturanga/shared/types/engine";

// The hook's effect runs once, outside React; writes go to `saveGame`.
let cleanup: (() => void) | void;
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | void) => {
    cleanup = effect();
  }
}));
const saveGame = vi.fn<(input: SaveGameInput) => Promise<unknown>>();
vi.mock("../queries/api", () => ({
  useSaveGameMutation: () => ({ mutateAsync: saveGame }),
  isSaveSuppressed: () => false
}));
vi.stubGlobal("window", globalThis);

const { AUTOSAVE_DELAY_MS, flushGameAutosave, useGameAutosave } = await import("./useGameAutosave");
const { useGameStore } = await import("../stores/game-store");
const { useReviewStore } = await import("../stores/review-store");
const { useSaveStatusStore } = await import("../stores/save-status-store");

function loadSaved(id: string) {
  const { game } = importPgnText("1. e4 e5 *");
  useGameStore.getState().loadGame({ ...game, id });
}

/** Moves the cursor back a move: an edit autosave writes. */
function edit() {
  const game = useGameStore.getState();
  const current = game.moveTree.find((node) => node.id === game.currentNodeId);
  if (current?.parentId) game.goToNode(current.parentId);
}

describe("useGameAutosave flushes", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    saveGame.mockReset().mockResolvedValue({});
    useGameStore.getState().reset();
    useReviewStore.getState().reset();
    useSaveStatusStore.getState().clear();
    await vi.runAllTimersAsync();
    useGameAutosave();
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
  });

  it("writes a review cleared just before the board is replaced with the game it belongs to", async () => {
    loadSaved("a");
    const review = { moves: [] } as unknown as GameReview;
    useReviewStore.getState().setReview(review);
    // Play → Start: the review is cleared, then the board replaced, inside the autosave delay.
    useReviewStore.getState().reset();
    useGameStore.getState().reset();
    await vi.runAllTimersAsync();
    expect(saveGame).toHaveBeenCalledOnce();
    expect(saveGame.mock.calls[0][0]).toMatchObject({ id: "a", review: { moves: [] } });
  });

  it("switching to another analysis first writes one still waiting (a run that just finished)", async () => {
    loadSaved("a");
    await vi.runAllTimersAsync();
    saveGame.mockClear();
    useReviewStore.getState().startReview("new");
    useReviewStore.getState().setReview({ moves: [], createdAt: 2 } as unknown as GameReview);
    // Switched to an older analysis before the autosave delay passed.
    useReviewStore.getState().loadReview({ reviewId: "old", moves: [], createdAt: 1 } as unknown as GameReview);
    await vi.runAllTimersAsync();
    const saved = saveGame.mock.calls.map((call) => call[0].review?.reviewId);
    expect(saved).toEqual(["new", "old"]);
  });

  it("the board counts as saved for an import even while a game left earlier keeps its failure", async () => {
    useSaveStatusStore.getState().setFailed("disk full", () => undefined, "other-game", 1);
    loadSaved("a");
    expect(await flushGameAutosave()).toBe(true);
    useSaveStatusStore.getState().setFailed("disk full", () => undefined, "a", 2);
    expect(await flushGameAutosave()).toBe(false);
    useSaveStatusStore.getState().clear();
  });

  it("keeps the stored review of a game left with no review of its own", async () => {
    loadSaved("a");
    edit();
    useGameStore.getState().reset();
    await vi.runAllTimersAsync();
    expect(saveGame).toHaveBeenCalledOnce();
    expect(saveGame.mock.calls[0][0]).not.toHaveProperty("review");
  });

  it("doesn't write the previous game's review with the next game", async () => {
    loadSaved("a");
    useReviewStore.getState().setReview({ moves: [] } as unknown as GameReview);
    await vi.runAllTimersAsync();
    // Opening "b" loads its board, then its review (none).
    loadSaved("b");
    useReviewStore.getState().loadReview(null);
    edit();
    loadSaved("c");
    await vi.runAllTimersAsync();
    expect(saveGame.mock.calls.at(-1)?.[0]).toMatchObject({ id: "b" });
    expect(saveGame.mock.calls.at(-1)?.[0]).not.toHaveProperty("review");
  });

  it("keeps a left game's failed save until that game is saved", async () => {
    saveGame.mockRejectedValueOnce(new Error("disk full"));
    loadSaved("a");
    edit();
    loadSaved("b");
    await vi.runAllTimersAsync();
    expect(useSaveStatusStore.getState().failures.map((failure) => failure.gameId)).toEqual(["a"]);

    edit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saveGame.mock.calls.at(-1)?.[0]).toMatchObject({ id: "b" });
    expect(useSaveStatusStore.getState().error).not.toBeNull();

    useSaveStatusStore.getState().retry();
    await vi.runAllTimersAsync();
    expect(saveGame.mock.calls.at(-1)?.[0]).toMatchObject({ id: "a" });
    expect(useSaveStatusStore.getState().error).toBeNull();
  });

  it("keeps a left game's failed save when the next game's save fails too, and retries both", async () => {
    saveGame.mockRejectedValueOnce(new Error("disk full")).mockRejectedValueOnce(new Error("read-only"));
    loadSaved("a");
    edit();
    loadSaved("b");
    edit();
    await vi.runAllTimersAsync();
    expect(useSaveStatusStore.getState().failures.map((failure) => failure.gameId)).toEqual(["a", "b"]);
    expect(useSaveStatusStore.getState().error).toBe("read-only");

    useSaveStatusStore.getState().retry();
    await vi.runAllTimersAsync();
    const retried = saveGame.mock.calls.slice(2).map(([input]) => input.id);
    expect(retried).toContain("a");
    expect(retried).toContain("b");
    expect(useSaveStatusStore.getState().error).toBeNull();
  });
});
