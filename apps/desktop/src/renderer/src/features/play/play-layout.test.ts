import { describe, expect, it } from "vitest";
import type { PlayOpponent } from "@chaturanga/shared/types/settings";
import {
  isFirstRun,
  playEngineOrder,
  resolvePlayMode,
  savePlaySettings,
  topRowSlots,
  widePreviewBoardSize
} from "./play-layout";

describe("topRowSlots", () => {
  it("keeps the Play card narrow beside a game in progress, then the cards in order", () => {
    expect(topRowSlots({ inProgress: true, repertoire: true, puzzle: true })).toEqual([
      { kind: "play", span: 1 },
      { kind: "in-progress" },
      { kind: "repertoire" },
      { kind: "puzzle" }
    ]);
  });

  it("widens the Play card when nothing is in progress", () => {
    expect(topRowSlots({ inProgress: false, repertoire: true, puzzle: true })).toEqual([
      { kind: "play", span: 2 },
      { kind: "repertoire" },
      { kind: "puzzle" }
    ]);
  });

  it("fills the columns left over with the filler card", () => {
    expect(topRowSlots({ inProgress: true, repertoire: false, puzzle: true })).toEqual([
      { kind: "play", span: 1 },
      { kind: "in-progress" },
      { kind: "puzzle" },
      { kind: "filler", span: 1 }
    ]);
    expect(topRowSlots({ inProgress: false, repertoire: false, puzzle: true })).toEqual([
      { kind: "play", span: 2 },
      { kind: "puzzle" },
      { kind: "filler", span: 1 }
    ]);
  });

  it("gives the Play card one of the filler's columns when it would take two or more", () => {
    // First run, or nothing to show beside it: Play across three columns, the filler in one.
    expect(topRowSlots({ inProgress: false, repertoire: false, puzzle: false })).toEqual([
      { kind: "play", span: 3 },
      { kind: "filler", span: 1 }
    ]);
    // A game in progress and no other card: the Play card widens (to its preview-board layout).
    expect(topRowSlots({ inProgress: true, repertoire: false, puzzle: false })).toEqual([
      { kind: "play", span: 2 },
      { kind: "in-progress" },
      { kind: "filler", span: 1 }
    ]);
  });
});

describe("resolvePlayMode", () => {
  const signedOut = { hasAccount: false, connected: false };
  const signedIn = { hasAccount: true, connected: true };

  it("keeps the mode chosen this session", () => {
    expect(resolvePlayMode({ session: "board", saved: "pool", ...signedIn })).toBe("board");
  });

  it("opens with the saved choice", () => {
    expect(resolvePlayMode({ session: null, saved: "ai", ...signedIn })).toBe("ai");
    expect(resolvePlayMode({ session: null, saved: "engine", ...signedIn })).toBe("engine");
    expect(resolvePlayMode({ session: null, saved: "board", ...signedOut })).toBe("board");
  });

  it("keeps a saved Lichess mode while the account needs reconnecting", () => {
    expect(
      resolvePlayMode({ session: null, saved: "friend", hasAccount: true, connected: false })
    ).toBe("friend");
  });

  it("drops a saved Lichess mode without an account", () => {
    expect(resolvePlayMode({ session: null, saved: "pool", ...signedOut })).toBe("engine");
  });

  it("defaults to Quick pairing when Lichess is connected, else the engine", () => {
    expect(resolvePlayMode({ session: null, saved: null, ...signedIn })).toBe("pool");
    expect(resolvePlayMode({ session: null, saved: null, ...signedOut })).toBe("engine");
    expect(
      resolvePlayMode({ session: null, saved: null, hasAccount: true, connected: false })
    ).toBe("engine");
  });
});

describe("savePlaySettings", () => {
  /** The session's opponent, and the settings writes (each fails when `fail` is called). */
  function setup(initial: PlayOpponent | null) {
    const state = {
      playOpponent: initial,
      setPlayOpponent: (opponent: PlayOpponent | null) => void (state.playOpponent = opponent)
    };
    const writes: { patch: unknown; fail: () => void }[] = [];
    const save = (opponent: PlayOpponent, engineId: string | null = null) =>
      savePlaySettings(
        { opponent, engineId },
        () => state,
        (variables, options) => writes.push({ patch: variables.patch, fail: options.onError })
      );
    return { state, writes, save };
  }

  it("switches the session's opponent at once and writes the choice", () => {
    const { state, writes, save } = setup("pool");
    save("engine", "sf");
    expect(state.playOpponent).toBe("engine");
    expect(writes.map((write) => write.patch)).toEqual([
      { playOpponent: "engine", playEngineId: "sf" }
    ]);
  });

  it("puts the previous opponent back when the write fails", () => {
    const { state, writes, save } = setup(null);
    save("friend");
    writes[0].fail();
    expect(state.playOpponent).toBeNull();
  });

  it("keeps an opponent chosen while the failed write was in flight", () => {
    const { state, writes, save } = setup("pool");
    save("friend");
    save("ai");
    writes[0].fail();
    expect(state.playOpponent).toBe("ai");
  });
});

describe("isFirstRun", () => {
  it("is only the state with neither an engine nor a Lichess account", () => {
    expect(isFirstRun({ engineCount: 0, hasAccount: false })).toBe(true);
    expect(isFirstRun({ engineCount: 1, hasAccount: false })).toBe(false);
    expect(isFirstRun({ engineCount: 0, hasAccount: true })).toBe(false);
  });
});

describe("playEngineOrder", () => {
  it("lists other engines first, then Maia from the weakest level up", () => {
    const names = [
      "Maia 1700 (managed)",
      "Maia 1900 (managed)",
      "Maia 1300 (managed)",
      "Stockfish (managed)",
      "Maia 1100 (managed)",
      "Berserk"
    ];
    expect(playEngineOrder(names.map((name) => ({ name }))).map((engine) => engine.name)).toEqual([
      "Berserk",
      "Stockfish (managed)",
      "Maia 1100 (managed)",
      "Maia 1300 (managed)",
      "Maia 1700 (managed)",
      "Maia 1900 (managed)"
    ]);
  });
});

describe("widePreviewBoardSize", () => {
  it("fills the card's height when the controls keep their 300px", () => {
    expect(widePreviewBoardSize(900, 340)).toBe(340);
  });

  it("gives the controls their room first", () => {
    // 1440×900, two columns: the mock's 300px board.
    expect(widePreviewBoardSize(630, 300)).toBe(300);
    expect(widePreviewBoardSize(630, 340)).toBe(306);
    expect(widePreviewBoardSize(500, 300)).toBe(176);
  });

  it("never goes under 120px", () => {
    expect(widePreviewBoardSize(300, 400)).toBe(120);
  });
});
