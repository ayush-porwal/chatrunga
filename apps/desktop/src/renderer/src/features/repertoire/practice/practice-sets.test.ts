import { describe, expect, it } from "vitest";
import type {
  PracticeOverview,
  RepertoirePracticeStats
} from "@chaturanga/shared/types/repertoire-practice";
import { colorMastery, practiceSets, setActions, setPreset, whenText } from "./practice-sets";

const NOW = Date.UTC(2026, 9, 29, 12);
const HOUR = 60 * 60_000;

function stats(patch: Partial<RepertoirePracticeStats>): RepertoirePracticeStats {
  return {
    repertoireId: "r",
    name: "Rep",
    color: "white",
    chapterCount: 2,
    decisions: 10,
    due: 0,
    learned: 0,
    learningNotDue: 0,
    nextDueAt: null,
    mastered: 0,
    learning: 0,
    new: 10,
    perfectLines: 0,
    lines: 3,
    chapters: [],
    firstChapterFen: null,
    ...patch
  };
}

const overview: PracticeOverview = {
  repertoires: [
    stats({ repertoireId: "w1", name: "1.e4", due: 3, new: 4, learning: 2, decisions: 9 }),
    stats({ repertoireId: "w2", name: "London", learningNotDue: 1, learning: 1, new: 0 }),
    stats({
      repertoireId: "b1",
      name: "Caro-Kann",
      color: "black",
      new: 0,
      mastered: 5,
      decisions: 5,
      learned: 5,
      nextDueAt: NOW + 3 * 24 * HOUR
    })
  ],
  newToday: 4,
  newPerDay: 10
};

describe("practice sets", () => {
  it("lists Everything, each colour, then each repertoire, with their counts", () => {
    const sets = practiceSets(overview);
    expect(
      sets.map((set) => [set.title, set.subtitle, set.due, set.new, set.learning])
    ).toStrictEqual([
      ["Everything", "3 repertoires · 24 moves", 3, 4, 3],
      ["All White", "2 repertoires · 19 moves", 3, 4, 3],
      ["All Black", "1 repertoire · 5 moves", 0, 0, 0],
      ["1.e4 (White)", "2 chapters · 9 moves", 3, 4, 2],
      ["London (White)", "2 chapters · 10 moves", 0, 0, 1],
      ["Caro-Kann (Black)", "2 chapters · 5 moves", 0, 0, 0]
    ]);
    expect(practiceSets({ ...overview, repertoires: [] })).toStrictEqual([]);
  });

  it("offers Review when due, else Practice early, else when the next review is", () => {
    const [everything, , black, , london] = practiceSets(overview);
    expect(setActions(everything, overview, NOW)).toStrictEqual({
      main: { kind: "review", count: 3 },
      nothingDue: null,
      learnNew: { count: 4, disabledReason: null }
    });
    expect(setActions(london, overview, NOW).main).toStrictEqual({ kind: "early", count: 1 });
    expect(setActions(black, overview, NOW)).toMatchObject({
      main: null,
      nothingDue: "Nothing due. Next review in 3 days",
      learnNew: null
    });
  });

  it("caps Learn new at today's limit and disables it once reached", () => {
    const [everything] = practiceSets(overview);
    expect(setActions(everything, { newToday: 8, newPerDay: 10 }, NOW).learnNew).toStrictEqual({
      count: 2,
      disabledReason: null
    });
    expect(setActions(everything, { newToday: 10, newPerDay: 10 }, NOW).learnNew).toStrictEqual({
      count: 0,
      disabledReason: "Daily limit reached, 10 of 10"
    });
    expect(setActions(everything, { newToday: 99, newPerDay: null }, NOW).learnNew?.count).toBe(4);
  });

  it("starts a set over its repertoires, one repertoire on its own, back to Practice", () => {
    const [everything, , , single] = practiceSets(overview);
    expect(setPreset(everything, "review")).toStrictEqual({
      repertoireIds: ["w1", "w2", "b1"],
      returnTab: "practice",
      dueOnly: true
    });
    expect(setPreset(single, "learn")).toStrictEqual({ returnTab: "practice", mode: "learn-new" });
    expect(setPreset(single, "early")).toMatchObject({ mode: "practice-early" });
  });

  it("sums a colour's mastery and words when a review falls", () => {
    expect(colorMastery(overview, "black")).toStrictEqual({
      mastered: 5,
      learning: 0,
      new: 0,
      learned: 5,
      total: 5
    });
    expect(colorMastery({ ...overview, repertoires: [] }, "white")).toBeNull();
    expect(
      [10 * 60_000, 3 * HOUR, 24 * HOUR, 5 * 24 * HOUR].map((wait) => whenText(NOW + wait, NOW))
    ).toStrictEqual(["in 10 minutes", "in 3 hours", "tomorrow", "in 5 days"]);
  });
});
