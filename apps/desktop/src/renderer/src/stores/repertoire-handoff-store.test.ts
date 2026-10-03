import { beforeEach, describe, expect, it } from "vitest";
import {
  handoffForSave,
  isHandoffSave,
  useRepertoireHandoffStore
} from "./repertoire-handoff-store";

const handoff = {
  repertoireId: "r1",
  chapterId: "c1",
  nodeId: "n2",
  capturedPath: "1. e4 e5",
  gameNodeId: "g2",
  color: "black" as const,
  board: 7
};

describe("isHandoffSave", () => {
  beforeEach(() => useRepertoireHandoffStore.setState({ played: null, earlier: [] }));

  it("matches the board the game was loaded as until a save binds its id", () => {
    useRepertoireHandoffStore.getState().begin(handoff);
    const played = useRepertoireHandoffStore.getState().played;
    expect(isHandoffSave(played, { gameId: "g1", board: 7 })).toBe(true);
    expect(isHandoffSave(played, { gameId: "g9", board: 8 })).toBe(false);
  });

  it("matches the board even after another board replaced it (its first save as it leaves)", () => {
    useRepertoireHandoffStore.getState().begin(handoff);
    useRepertoireHandoffStore.getState().leaveBoard();
    expect(
      isHandoffSave(useRepertoireHandoffStore.getState().played, { gameId: "g1", board: 7 })
    ).toBe(true);
  });

  it("matches only the bound id afterwards", () => {
    useRepertoireHandoffStore.getState().begin(handoff);
    useRepertoireHandoffStore.getState().bindGame("g1");
    useRepertoireHandoffStore.getState().bindGame("g2");
    const played = useRepertoireHandoffStore.getState().played;
    expect(played?.gameId).toBe("g1");
    expect(isHandoffSave(played, { gameId: "g1", board: 12 })).toBe(true);
    expect(isHandoffSave(played, { gameId: "g2", board: 7 })).toBe(false);
  });

  it("keeps a replaced handoff for its first save until that save binds it", () => {
    const store = () => useRepertoireHandoffStore.getState();
    store().begin(handoff);
    store().begin({ ...handoff, chapterId: "c2", board: 9 });
    expect(store().played?.board).toBe(9);
    // The first game's save is answered after the second handoff started.
    const first = handoffForSave(store(), { gameId: "g1", board: 7 });
    expect(first).toMatchObject({ chapterId: "c1", board: 7 });
    store().bindGame("g1", 7);
    expect(store().earlier).toEqual([]);
    expect(store().played).toMatchObject({ board: 9, gameId: null });
    expect(handoffForSave(store(), { gameId: "g1", board: 7 })).toBeNull();
    expect(handoffForSave(store(), { gameId: "g2", board: 9 })).toMatchObject({ chapterId: "c2" });
    // A bound handoff isn't kept when replaced.
    store().bindGame("g2", 9);
    store().begin({ ...handoff, board: 11 });
    expect(store().earlier).toEqual([]);
  });

  it("matches nothing without a handoff", () => {
    expect(isHandoffSave(null, { gameId: "g1", board: 7 })).toBe(false);
  });
});
