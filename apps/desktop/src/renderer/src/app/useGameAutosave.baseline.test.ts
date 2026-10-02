import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";

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

const {
  AUTOSAVE_DELAY_MS,
  holdUntilChanged,
  isHeldUnchanged,
  unchangedSinceBaseline,
  useGameAutosave
} = await import("./useGameAutosave");
const { useGameStore } = await import("../stores/game-store");
const { useReviewStore } = await import("../stores/review-store");
const { useSaveStatusStore } = await import("../stores/save-status-store");

/** An unsaved copy with moves (like Study → Analyze), held until it changes. */
function loadHeldCopy() {
  const { game } = importPgnText("1. e4 e5 2. Nf3 *");
  useGameStore.getState().loadGame({ ...game, id: null, source: "analysis" });
  holdUntilChanged();
}

async function settle() {
  await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
}

describe("unchangedSinceBaseline", () => {
  const { game } = importPgnText("1. e4 *");
  const baseline = { moveTree: game.moveTree, headers: game.headers };
  const board = { gameId: null, moveTree: game.moveTree, headers: game.headers, gameOutcome: null };

  it("holds the same unsaved tree and headers", () => {
    expect(unchangedSinceBaseline(baseline, board)).toBe(true);
  });

  it("lets go once the tree, the headers, a result or a library id changes", () => {
    expect(unchangedSinceBaseline(null, board)).toBe(false);
    expect(unchangedSinceBaseline(baseline, { ...board, moveTree: [...game.moveTree] })).toBe(
      false
    );
    expect(unchangedSinceBaseline(baseline, { ...board, headers: { ...game.headers } })).toBe(
      false
    );
    expect(unchangedSinceBaseline(baseline, { ...board, gameId: "g1" })).toBe(false);
    expect(
      unchangedSinceBaseline(baseline, {
        ...board,
        gameOutcome: { result: "1-0", termination: "Player resign" }
      })
    ).toBe(false);
  });
});

describe("useGameAutosave with a held copy", () => {
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

  it("doesn't save the copy as loaded, nor for moving through it or switching mode", async () => {
    loadHeldCopy();
    await settle();
    const game = useGameStore.getState();
    game.goToNode(game.moveTree[1].id);
    game.setMode("analysis");
    await settle();
    expect(saveGame).not.toHaveBeenCalled();
    expect(useGameStore.getState().gameId).toBeNull();
    expect(isHeldUnchanged()).toBe(true);
  });

  it("saves it once a move is added", async () => {
    loadHeldCopy();
    await settle();
    expect(useGameStore.getState().makeUciMove("b8c6")).toBe(true);
    await settle();
    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(saveGame.mock.calls[0][0].source).toBe("analysis");
    expect(useGameStore.getState().gameId).not.toBeNull();
    expect(isHeldUnchanged()).toBe(false);
  });

  it("doesn't write the unchanged copy when another board replaces it", async () => {
    loadHeldCopy();
    // A save is still waiting (the load scheduled one) when the board is replaced.
    useGameStore.getState().reset();
    await settle();
    expect(saveGame).not.toHaveBeenCalled();
  });

  it("forgets the hold when another unsaved board loads", async () => {
    loadHeldCopy();
    const { game } = importPgnText("1. d4 d5 *");
    useGameStore.getState().loadGame({ ...game, id: null });
    await settle();
    expect(saveGame).toHaveBeenCalledTimes(1);
  });
});
