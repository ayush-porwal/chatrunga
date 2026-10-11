import { beforeEach, describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  selectCanGoBack,
  selectCanGoForward,
  useHistoryStore
} from "./history-store";

const history = () => useHistoryStore.getState();
/** Where the app opens: Play (its mode not chosen yet). */
const START = { view: "play", opponent: null } as const;
const initial = useHistoryStore.getState();

describe("history store", () => {
  beforeEach(() => useHistoryStore.setState({ entries: [START], index: 0 }));

  it("starts on Play", () => {
    expect(initial.entries).toStrictEqual([START]);
    expect(initial.index).toBe(0);
  });

  it("steps back and forward through pushed screens", () => {
    history().push({ view: "play", opponent: "pool" });
    history().push({ view: "databases" });
    expect(history().index).toBe(2);
    history().moveTo(1);
    expect(selectCanGoBack(history())).toBe(true);
    expect(selectCanGoForward(history())).toBe(true);
    expect(history().entries[history().index]).toStrictEqual({ view: "play", opponent: "pool" });
  });

  it("drops the screens ahead when a new one is pushed after going back, like a browser", () => {
    history().push({ view: "settings", section: null });
    history().push({ view: "databases" });
    history().moveTo(1);
    history().push({ view: "puzzles" });
    expect(history().entries.map((entry) => entry.view)).toStrictEqual([
      "play",
      "settings",
      "puzzles"
    ]);
    expect(selectCanGoForward(history())).toBe(false);
  });

  it("ignores a push of the screen you're already on", () => {
    history().push(START);
    expect(history().entries).toHaveLength(1);
  });

  it("keeps the screen as it was left, and replaces without adding a step", () => {
    history().push({ view: "settings", section: null });
    history().commitCurrent({ view: "settings", section: "engines" });
    history().replaceCurrent({ view: "settings", section: "lichess" });
    expect(history().entries).toStrictEqual([START, { view: "settings", section: "lichess" }]);
  });

  it("records repertoire screens, with node and tab changes replacing the study entry", () => {
    history().push({ view: "repertoire-hub" });
    const study = {
      view: "repertoire-study" as const,
      repertoireId: "r1",
      chapterId: "c1",
      nodeId: null,
      tab: "moves" as const,
      orientation: "white" as const
    };
    history().push(study);
    history().replaceCurrent({ ...study, nodeId: "n4", tab: "notes" });
    history().replaceCurrent({ ...study, nodeId: "n5", tab: "notes", orientation: "black" });
    history().push({ view: "repertoire-practice", repertoireId: "r1", sessionId: null });
    history().replaceCurrent({ view: "repertoire-practice", repertoireId: "r1", sessionId: "s1" });
    expect(history().entries).toStrictEqual([
      START,
      { view: "repertoire-hub" },
      { ...study, nodeId: "n5", tab: "notes", orientation: "black" },
      { view: "repertoire-practice", repertoireId: "r1", sessionId: "s1" }
    ]);
    history().moveTo(2);
    expect(selectCanGoForward(history())).toBe(true);
  });

  it("ignores a push of the same study position", () => {
    const study = {
      view: "repertoire-study" as const,
      repertoireId: "r1",
      chapterId: "c1",
      nodeId: "n1",
      tab: "moves" as const,
      orientation: "white" as const
    };
    history().push(study);
    history().push({ ...study });
    expect(history().entries).toHaveLength(2);
    history().push({ ...study, chapterId: "c2" });
    expect(history().entries).toHaveLength(3);
  });

  it("forgets the oldest screens past the limit", () => {
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1)
      history().push({ view: "repertoire-practice", repertoireId: String(index), sessionId: null });
    expect(history().entries).toHaveLength(HISTORY_LIMIT);
    expect(history().index).toBe(HISTORY_LIMIT - 1);
  });

  it("drops an entry that can't be shown, keeping the current screen current", () => {
    history().push({ view: "puzzles" });
    history().push({ view: "databases" });
    history().removeAt(1);
    expect(history().entries.map((entry) => entry.view)).toStrictEqual(["play", "databases"]);
    expect(history().index).toBe(1);
    history().removeAt(1);
    expect(history().entries).toHaveLength(2);
  });
});
