import { beforeEach, describe, expect, it } from "vitest";
import { HISTORY_LIMIT, selectCanGoBack, selectCanGoForward, useHistoryStore } from "./history-store";

const history = () => useHistoryStore.getState();

describe("history store", () => {
  beforeEach(() => useHistoryStore.setState({ entries: [{ view: "home" }], index: 0 }));

  it("steps back and forward through pushed screens", () => {
    history().push({ view: "play", opponent: "lichess" });
    history().push({ view: "databases" });
    expect(history().index).toBe(2);
    history().moveTo(1);
    expect(selectCanGoBack(history())).toBe(true);
    expect(selectCanGoForward(history())).toBe(true);
    expect(history().entries[history().index]).toEqual({ view: "play", opponent: "lichess" });
  });

  it("drops the screens ahead when a new one is pushed after going back, like a browser", () => {
    history().push({ view: "play", opponent: null });
    history().push({ view: "databases" });
    history().moveTo(1);
    history().push({ view: "puzzles" });
    expect(history().entries.map((entry) => entry.view)).toEqual(["home", "play", "puzzles"]);
    expect(selectCanGoForward(history())).toBe(false);
  });

  it("ignores a push of the screen you're already on", () => {
    history().push({ view: "home" });
    expect(history().entries).toHaveLength(1);
  });

  it("keeps the screen as it was left, and replaces without adding a step", () => {
    history().push({ view: "settings", section: null });
    history().commitCurrent({ view: "settings", section: "engines" });
    history().replaceCurrent({ view: "settings", section: "lichess" });
    expect(history().entries).toEqual([{ view: "home" }, { view: "settings", section: "lichess" }]);
  });

  it("forgets the oldest screens past the limit", () => {
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) history().push({ view: "settings", section: String(index) });
    expect(history().entries).toHaveLength(HISTORY_LIMIT);
    expect(history().index).toBe(HISTORY_LIMIT - 1);
  });

  it("drops an entry that can't be shown, keeping the current screen current", () => {
    history().push({ view: "play", opponent: "engine" });
    history().push({ view: "databases" });
    history().removeAt(1);
    expect(history().entries.map((entry) => entry.view)).toEqual(["home", "databases"]);
    expect(history().index).toBe(1);
    history().removeAt(1);
    expect(history().entries).toHaveLength(2);
  });
});
