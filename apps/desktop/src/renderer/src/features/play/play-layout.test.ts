import { describe, expect, it } from "vitest";
import { isFirstRun, playEngineOrder, resolvePlayMode, topRowSlots } from "./play-layout";

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

  it("fills the columns left over with the Your move card", () => {
    expect(topRowSlots({ inProgress: true, repertoire: false, puzzle: true })).toEqual([
      { kind: "play", span: 1 },
      { kind: "in-progress" },
      { kind: "puzzle" },
      { kind: "your-move", span: 1 }
    ]);
    expect(topRowSlots({ inProgress: false, repertoire: false, puzzle: true })).toEqual([
      { kind: "play", span: 2 },
      { kind: "puzzle" },
      { kind: "your-move", span: 1 }
    ]);
  });

  it("first run is the wide Play card and Your move across the other two columns", () => {
    expect(topRowSlots({ inProgress: false, repertoire: false, puzzle: false })).toEqual([
      { kind: "play", span: 2 },
      { kind: "your-move", span: 2 }
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
