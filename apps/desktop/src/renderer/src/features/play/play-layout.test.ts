import { describe, expect, it } from "vitest";
import type { PlayOpponent } from "@chaturanga/shared/types/settings";
import {
  boardCardKinds,
  isFirstRun,
  playEngineOrder,
  playGrid,
  resolvePlayMode,
  savePlaySettings,
  widePreviewBoardSize
} from "./play-layout";

describe("boardCardKinds", () => {
  it("lists the cards with something to show, in their order", () => {
    expect(boardCardKinds({ inProgress: true, repertoire: true, puzzle: true })).toStrictEqual([
      "in-progress",
      "repertoire",
      "puzzle"
    ]);
    expect(boardCardKinds({ inProgress: false, repertoire: false, puzzle: true })).toStrictEqual([
      "puzzle"
    ]);
    expect(boardCardKinds({ inProgress: false, repertoire: false, puzzle: false })).toStrictEqual(
      []
    );
  });
});

describe("playGrid", () => {
  // Page content boxes: the smallest window (980×680), 1440×900, 1920×1080.
  const smallest = { width: 732, height: 590 };
  const laptop = { width: 1192, height: 810 };
  const wide = { width: 1672, height: 990 };

  it("makes the side column exactly as wide as the board cards above it", () => {
    for (const size of [smallest, laptop, wide])
      for (const cards of [0, 1, 2, 3]) {
        const grid = playGrid({ ...size, cards });
        const slots = Math.max(1, grid.cards);
        expect(grid.sideWidth).toBe(slots * grid.cardWidth + (slots - 1) * 16);
        expect(grid.playWidth + 16 + grid.sideWidth).toBeLessThanOrEqual(size.width);
      }
  });

  it("takes the row height from the window's, within its bounds", () => {
    expect(playGrid({ width: 1192, height: 900, cards: 3 }).rowHeight).toBe(396);
    expect(playGrid({ ...laptop, cards: 3 }).rowHeight).toBe(372);
    expect(playGrid({ width: 1192, height: 2000, cards: 3 }).rowHeight).toBe(420);
  });

  it("leaves out the last board cards when the Play column would get too narrow", () => {
    expect(playGrid({ ...smallest, cards: 3 }).cards).toBe(1);
    expect(playGrid({ ...laptop, cards: 3 }).cards).toBe(3);
    expect(playGrid({ ...wide, cards: 2 }).cards).toBe(2);
  });

  it("gives the filler one card's place when there is no board card", () => {
    const grid = playGrid({ ...laptop, cards: 0 });
    expect(grid.cards).toBe(0);
    expect(grid.sideWidth).toBe(grid.cardWidth);
  });

  it("draws in the rem a large window steps up to: its gap, the cards' sizes and the bounds", () => {
    // app.css: 18px at ≥2560×1200. The gap is 1rem; the row's floor and the cards scale with it.
    const grid = playGrid({ width: 2200, height: 600, cards: 3, rem: 18 });
    expect(grid.rowHeight).toBe(Math.round((372 * 18) / 16));
    expect(grid.cardWidth).toBe(Math.round(grid.rowHeight - (164 * 18) / 16 + (24 * 18) / 16 + 2));
    expect(grid.sideWidth).toBe(3 * grid.cardWidth + 2 * 18);
    expect(grid.playWidth).toBe(2200 - grid.sideWidth - 18);
  });

  it("goes to one column where the Play column's minimum and a card don't fit side by side", () => {
    // A window zoomed in: the page's content box narrower than the Play column and one card.
    const grid = playGrid({ width: 560, height: 590, cards: 3 });
    expect(grid.stacked).toBe(true);
    expect(grid.playWidth).toBe(560);
    expect(grid.sideWidth).toBe(560);
    // As many cards as fit across it.
    expect(grid.cards).toBe(Math.floor((560 + 16) / (grid.cardWidth + 16)));
    expect(playGrid({ ...smallest, cards: 3 }).stacked).toBe(false);
  });

  it("gives the Play column the rest of the width", () => {
    const grid = playGrid({ ...wide, cards: 1 });
    expect(grid.playWidth).toBe(wide.width - grid.sideWidth - 16);
    expect(grid.wide).toBe(true);
    expect(playGrid({ ...smallest, cards: 1 }).wide).toBe(false);
  });

  it("shows the preview board only where it fits at full height beside the controls", () => {
    // Row 372: the board 346 (less the border and py-3), + 24 gap + 300 controls + 30 chrome = 700.
    const atWidth = (playWidth: number) =>
      playGrid({ width: playWidth + 234 + 16, height: 810, cards: 1 });
    expect(atWidth(700).playWidth).toBe(700);
    expect(atWidth(700).wide).toBe(true);
    expect(atWidth(699).wide).toBe(false);
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
    const save = (
      opponent: PlayOpponent,
      engineId: string | null = null,
      maiaRating: number | null = null
    ) =>
      savePlaySettings(
        { opponent, engineId, maiaRating },
        () => state,
        (variables, options) => writes.push({ patch: variables.patch, fail: options.onError })
      );
    return { state, writes, save };
  }

  it("switches the session's opponent at once and writes the choice", () => {
    const { state, writes, save } = setup("pool");
    save("engine", "sf");
    expect(state.playOpponent).toBe("engine");
    expect(writes.map((write) => write.patch)).toStrictEqual([
      { playOpponent: "engine", playEngineId: "sf" }
    ]);
  });

  it("writes Maia's rating only when it was changed", () => {
    const { writes, save } = setup(null);
    save("engine", "maia", 1800);
    expect(writes.map((write) => write.patch)).toStrictEqual([
      { playOpponent: "engine", playEngineId: "maia", playMaiaRating: 1800 }
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
  it("lists the engines by name, Maia last", () => {
    const engines = [
      { name: "Maia (managed)", runtime: "maia3" as const },
      { name: "Stockfish (managed)", runtime: "custom-uci" as const },
      { name: "Berserk 13", runtime: "custom-uci" as const },
      { name: "Berserk 9", runtime: "custom-uci" as const }
    ];
    expect(playEngineOrder(engines).map((engine) => engine.name)).toStrictEqual([
      "Berserk 9",
      "Berserk 13",
      "Stockfish (managed)",
      "Maia (managed)"
    ]);
  });
});

describe("widePreviewBoardSize", () => {
  it("fills the card's height when the controls keep their 300px", () => {
    expect(widePreviewBoardSize(900, 340)).toBe(340);
  });

  it("only trims what rounding takes from the controls' room", () => {
    expect(widePreviewBoardSize(669.5, 346)).toBe(345);
    expect(widePreviewBoardSize(200, 346)).toBe(0);
  });
});
