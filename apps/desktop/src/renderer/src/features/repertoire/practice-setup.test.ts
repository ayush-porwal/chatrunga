import { describe, expect, it } from "vitest";
import type {
  RepertoireChapterSummary,
  RepertoireWorkspaceState,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { detailOf } from "./__fixtures__/repertoire";
import {
  autoStartPracticeInput,
  boundedInt,
  DEFAULT_CARD_LIMIT,
  EXPLAINED_CHAPTER_LIMIT,
  explainedChapterIds,
  isExtraPractice,
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  practicableChapterIds,
  practiceSettings,
  practiceSettingsForm,
  practiceSettingsFromForm,
  practiceStartInput,
  presetPracticeInput,
  rehearsePreset,
  retryMissedPreset,
  summaryPresets,
  targetedPracticeInput
} from "./practice-setup";

function chapter(
  id: string,
  overrides: Partial<RepertoireChapterSummary> = {}
): RepertoireChapterSummary {
  return {
    id,
    title: id,
    sortOrder: 0,
    kind: "opening",
    enabled: true,
    rootFen: "",
    revision: 1,
    nodeCount: 1,
    dueCount: 0,
    ...overrides
  };
}

const chapters = [
  chapter("A"),
  chapter("B", { enabled: false }),
  chapter("R", { kind: "reference" }),
  chapter("C", { sortOrder: 1 })
];

function workspace(
  practiceDraft: StartPracticeInput | null,
  lastChapterId: string | null = null
): RepertoireWorkspaceState {
  return { lastChapterId, lastNodeId: null, orientation: "white", practiceDraft };
}

describe("practice settings", () => {
  it("only draws from enabled opening chapters", () => {
    expect([...practicableChapterIds(chapters)]).toStrictEqual(["A", "C"]);
  });

  it("start from the defaults without a saved draft", () => {
    expect(practiceSettings(detailOf({ chapters }))).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      cardLimit: DEFAULT_CARD_LIMIT
    });
  });

  it("drop saved chapters that are gone, disabled or reference, and read Learn new as review", () => {
    const detail = detailOf({
      chapters,
      workspace: workspace({
        repertoireId: "r1",
        mode: "learn-new",
        chapterIds: ["A", "B", "R", "X"],
        positionKeys: ["stale"]
      })
    });
    expect(practiceSettings(detail)).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      chapterIds: ["A"]
    });
    const none = detailOf({
      chapters,
      workspace: workspace({ repertoireId: "r1", mode: "review-due", chapterIds: ["X"] })
    });
    expect(practiceSettings(none)).not.toHaveProperty("chapterIds");
  });

  it("clamp a saved draft to the main's limits, drop its own new-card count (the daily limit replaced it), and ignore another repertoire's", () => {
    const detail = detailOf({
      chapters,
      workspace: workspace({
        repertoireId: "r1",
        mode: "review-due",
        cardLimit: 9999,
        newCardLimit: -3,
        maxDepthPlies: 900
      })
    });
    expect(practiceSettings(detail)).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      cardLimit: MAX_CARD_LIMIT,
      maxDepthPlies: MAX_DEPTH_PLIES
    });
    expect(practiceSettings(detailOf({ ...detail, id: "r2" })).cardLimit).toBe(DEFAULT_CARD_LIMIT);
  });

  it("read bounded whole numbers from the fields", () => {
    expect(boundedInt("12", 1, 500)).toBe(12);
    expect(boundedInt("9000", 1, 500)).toBe(500);
    expect(boundedInt("0", 1, 500)).toBeUndefined();
    expect(boundedInt("", 0, 500)).toBeUndefined();
    expect(boundedInt("0", 0, 500)).toBe(0);
  });

  it("round-trip through the dialog's fields within the limits", () => {
    const settings: StartPracticeInput = {
      repertoireId: "r1",
      mode: "rehearse-lines",
      chapterIds: ["A"],
      maxDepthPlies: 12,
      cardLimit: 10
    };
    const form = practiceSettingsForm(settings);
    expect(form).toStrictEqual({
      lines: true,
      chapterIds: ["A"],
      depth: "12",
      cards: "10"
    });
    expect(practiceSettingsFromForm({ repertoireId: "r1", ...form })).toStrictEqual(settings);
    expect(
      practiceSettingsFromForm({
        repertoireId: "r1",
        lines: false,
        chapterIds: [],
        depth: "2000",
        cards: "abc"
      })
    ).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      maxDepthPlies: MAX_DEPTH_PLIES,
      cardLimit: DEFAULT_CARD_LIMIT
    });
  });
});

describe("practiceStartInput", () => {
  it("reviews due positions, then new ones, with the settings", () => {
    const detail = detailOf({
      chapters,
      workspace: workspace({ repertoireId: "r1", mode: "review-due", cardLimit: 7 })
    });
    expect(practiceStartInput(detail, "A")).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      cardLimit: 7
    });
  });

  it("rehearses the open chapter, else the last studied, else the first in scope", () => {
    const lines = (lastChapterId: string | null, chapterIds: string[] = []) =>
      detailOf({
        chapters,
        workspace: workspace(
          {
            repertoireId: "r1",
            mode: "rehearse-lines",
            maxDepthPlies: 8,
            chapterIds
          },
          lastChapterId
        )
      });
    expect(practiceStartInput(lines("C"), "A")).toStrictEqual({
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A" },
      maxDepthPlies: 8
    });
    expect(practiceStartInput(lines("C"), "R").rehearse).toStrictEqual({ chapterId: "C" });
    expect(practiceStartInput(lines(null, ["C"])).rehearse).toStrictEqual({ chapterId: "C" });
    expect(practiceStartInput(lines(null)).rehearse).toStrictEqual({ chapterId: "A" });
  });

  it("is what a plain preset starts, so newly saved settings change it; a named session doesn't", () => {
    const saved = (cardLimit: number) =>
      detailOf({
        chapters,
        workspace: workspace({ repertoireId: "r1", mode: "review-due", cardLimit })
      });
    expect(presetPracticeInput(saved(7), {})).toStrictEqual({
      input: { repertoireId: "r1", mode: "review-due", cardLimit: 7 },
      followsSettings: true
    });
    expect(presetPracticeInput(saved(3), {}).input.cardLimit).toBe(3);
    const targeted = { mode: "review-due" as const, positionKeys: ["k1"] };
    expect(presetPracticeInput(saved(7), targeted)).toStrictEqual({
      input: autoStartPracticeInput("r1", targeted),
      followsSettings: false
    });
  });

  it("falls back to the review when no chapter can be rehearsed", () => {
    const detail = detailOf({
      chapters: [chapter("R", { kind: "reference" })],
      workspace: workspace({ repertoireId: "r1", mode: "rehearse-lines" })
    });
    expect(practiceStartInput(detail, "R").mode).toBe("review-due");
  });
});

describe("practice presets", () => {
  it("start exactly the named decisions, whether due or new", () => {
    expect(
      targetedPracticeInput("r1", { mode: "review-due", positionKeys: ["k1", "k1", "k2"] })
    ).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      positionKeys: ["k1", "k2"],
      cardLimit: 2,
      newCardLimit: 2
    });
    expect(targetedPracticeInput("r1", { positionKeys: [] })).toBeNull();
    expect(targetedPracticeInput("r1", null)).toBeNull();
  });

  it("leave plain Practice to the settings", () => {
    expect(autoStartPracticeInput("r1", {})).toBeNull();
    expect(autoStartPracticeInput("r1", null)).toBeNull();
  });

  it("retry a session's misses as an ungraded targeted queue", () => {
    const preset = retryMissedPreset({ missedPositionKeys: ["k2", "k1", "k2"] });
    expect(preset).toStrictEqual({
      mode: "review-due",
      positionKeys: ["k2", "k1"],
      ungraded: true
    });
    expect(autoStartPracticeInput("r1", preset)).toStrictEqual({
      repertoireId: "r1",
      mode: "review-due",
      positionKeys: ["k2", "k1"],
      cardLimit: 2,
      newCardLimit: 2,
      ungraded: true
    });
    expect(retryMissedPreset({ missedPositionKeys: [] })).toBeNull();
    // "Refresh this decision" stays a graded targeted queue.
    expect(
      targetedPracticeInput("r1", { mode: "review-due", positionKeys: ["k1"] })
    ).not.toHaveProperty("ungraded");
  });

  it("offer Retry missed after a session, and Rehearse again instead after a rehearsal", () => {
    const missed = { missedPositionKeys: ["k1"] };
    expect(
      summaryPresets({ mode: "review-due", scope: { repertoireId: "r1" } }, missed)
    ).toStrictEqual({ retryMissed: retryMissedPreset(missed), rehearseAgain: null });
    const rehearsal = {
      mode: "rehearse-lines" as const,
      scope: {
        repertoireId: "r1",
        rehearse: { chapterId: "A", fromNodeId: "n4" },
        maxDepthPlies: 6
      }
    };
    expect(summaryPresets(rehearsal, missed)).toStrictEqual({
      retryMissed: null,
      rehearseAgain: rehearsePreset({ chapterId: "A", fromNodeId: "n4" }, 6)
    });
    // A summary whose session is no longer held can still retry its misses.
    expect(summaryPresets(null, missed).retryMissed).toStrictEqual(retryMissedPreset(missed));
  });

  it("call a targeted session extra practice", () => {
    expect(isExtraPractice({ positionKeys: ["k1"] })).toBe(true);
    expect(isExtraPractice({ positionKeys: [] })).toBe(false);
    expect(isExtraPractice({})).toBe(false);
  });

  it("start a rehearsal preset with its chapter, branch and depth", () => {
    const preset = rehearsePreset({ chapterId: "A", fromNodeId: "n4" }, 10);
    expect(autoStartPracticeInput("r1", preset)).toStrictEqual({
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "n4" },
      maxDepthPlies: 10
    });
    expect(autoStartPracticeInput("r1", rehearsePreset({ chapterId: "A" }))).toStrictEqual({
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A" }
    });
  });
});

describe("explainedChapterIds", () => {
  const ordered = [chapter("b", { sortOrder: 1 }), chapter("a", { sortOrder: 0 })];
  const rehearse = (chapterId: string) =>
    ({ mode: "rehearse-lines", rehearse: { chapterId } }) as const;

  it("names the rehearsed chapter, or every chapter in scope", () => {
    const detail = detailOf({ chapters: ordered, decisionCount: 3 });
    expect(explainedChapterIds(detail, rehearse("b"))).toStrictEqual(["b"]);
    expect(
      explainedChapterIds(detail, { mode: "review-due", chapterIds: ["b", "gone", "a"] })
    ).toStrictEqual(["b", "a"]);
    // A chapter that is gone names nothing in particular.
    expect(explainedChapterIds(detail, rehearse("gone"))).toStrictEqual([]);
  });

  it("reads at most the limit of a long scope", () => {
    const many = Array.from({ length: EXPLAINED_CHAPTER_LIMIT + 5 }, (_, index) =>
      chapter(`c${index}`, { sortOrder: index })
    );
    const ids = explainedChapterIds(detailOf({ chapters: many, decisionCount: 1 }), {
      mode: "review-due",
      chapterIds: many.map((item) => item.id)
    });
    expect(ids).toHaveLength(EXPLAINED_CHAPTER_LIMIT);
  });

  it("over every chapter names one only when the repertoire has no decision", () => {
    expect(
      explainedChapterIds(detailOf({ chapters: ordered, decisionCount: 3 }), { mode: "review-due" })
    ).toStrictEqual([]);
    expect(
      explainedChapterIds(detailOf({ chapters: ordered, decisionCount: 0 }), { mode: "review-due" })
    ).toStrictEqual(["a"]);
    const studied = detailOf({
      chapters: ordered,
      decisionCount: 0,
      workspace: workspace(null, "b")
    });
    expect(explainedChapterIds(studied, { mode: "review-due" })).toStrictEqual(["b"]);
    expect(
      explainedChapterIds(detailOf({ decisionCount: 0 }), { mode: "review-due" })
    ).toStrictEqual([]);
  });
});
