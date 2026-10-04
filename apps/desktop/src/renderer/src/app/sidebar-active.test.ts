import { describe, expect, it } from "vitest";
import { sidebarActiveFor } from "./sidebar-active";

const active = (overrides: Partial<Parameters<typeof sidebarActiveFor>[0]> = {}) =>
  sidebarActiveFor({
    view: "game",
    gameMode: "freeplay",
    gameSource: "analysis",
    reviewPickerOpen: false,
    ...overrides
  });

describe("sidebarActiveFor", () => {
  it("highlights Analyze on the Analyze page with the Analysis switch off or on", () => {
    expect(active().analyze).toBe(true);
    expect(active({ gameMode: "analysis" }).analyze).toBe(true);
    // A loaded game or a free board shown there too.
    expect(active({ gameSource: "pgn-import" }).analyze).toBe(true);
    expect(active({ gameSource: "new" }).analyze).toBe(true);
  });

  it("doesn't highlight Analyze for a game being played or a puzzle, solved or analysed", () => {
    expect(active({ gameMode: "engine", gameSource: "engine-game" }).analyze).toBe(false);
    expect(active({ gameMode: "online", gameSource: "lichess" }).analyze).toBe(false);
    expect(active({ gameMode: "puzzle", gameSource: "puzzle" }).analyze).toBe(false);
    expect(active({ gameMode: "analysis", gameSource: "puzzle" }).analyze).toBe(false);
    expect(active({ gameMode: "freeplay", gameSource: "puzzle" }).analyze).toBe(false);
  });

  it("highlights only the current page's item off the game view", () => {
    for (const view of ["play", "game-review", "puzzles", "home", "settings"] as const) {
      const items = active({ view });
      expect(items.analyze).toBe(false);
      expect(Object.values(items).filter(Boolean)).toHaveLength(1);
    }
    expect(active({ view: "play" }).play).toBe(true);
    expect(active({ view: "game-review" }).review).toBe(true);
    expect(active({ view: "repertoire-study" }).repertoire).toBe(true);
  });

  it("highlights Game review while its picker is open over another page", () => {
    expect(active({ view: "home", reviewPickerOpen: true })).toMatchObject({
      home: true,
      review: true
    });
  });
});
