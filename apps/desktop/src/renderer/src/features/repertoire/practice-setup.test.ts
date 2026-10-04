import { describe, expect, it } from "vitest";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type {
  RepertoireChapterSummary,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { addLine, chapterOf, detailOf, rootNode } from "./__fixtures__/repertoire";
import { pathLabel } from "./repertoire-model";
import {
  autoStartPracticeInput,
  boundedInt,
  DEFAULT_CARD_LIMIT,
  EXPLAINED_CHAPTER_LIMIT,
  explainedChapterIds,
  initialPracticeInput,
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  practiceInputFromForm,
  practicableChapterIds,
  presetForSetup,
  isExtraPractice,
  rehearsePreset,
  rehearseStarts,
  retryMissedPreset,
  savesPracticeDraft,
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
  chapter("R", { kind: "reference" })
];

describe("practice setup", () => {
  it("only offers enabled opening chapters", () => {
    expect([...practicableChapterIds(chapters)]).toEqual(["A"]);
  });

  it("starts from the defaults without a saved draft", () => {
    expect(initialPracticeInput(detailOf({ chapters }), null)).toEqual({
      repertoireId: "r1",
      mode: "review-due",
      cardLimit: DEFAULT_CARD_LIMIT,
      newCardLimit: 5
    });
  });

  it("drops saved chapters that are gone, disabled or reference", () => {
    const detail = detailOf({
      chapters,
      workspace: {
        lastChapterId: null,
        lastNodeId: null,
        orientation: "white",
        practiceDraft: { repertoireId: "r1", mode: "learn-new", chapterIds: ["A", "B", "R", "C"] }
      }
    });
    expect(initialPracticeInput(detail, null)).toEqual({
      repertoireId: "r1",
      mode: "learn-new",
      chapterIds: ["A"]
    });
    const none = initialPracticeInput(detail, { chapterIds: ["C"] });
    expect(none).not.toHaveProperty("chapterIds");
  });

  it("applies a preset and clamps a saved draft to the main's limits", () => {
    const detail = detailOf({
      chapters,
      workspace: {
        lastChapterId: null,
        lastNodeId: null,
        orientation: "white",
        practiceDraft: {
          repertoireId: "r1",
          mode: "review-due",
          cardLimit: 9999,
          newCardLimit: -3,
          maxDepthPlies: 900
        }
      }
    });
    expect(initialPracticeInput(detail, { mode: "learn-new", chapterIds: ["A"] })).toEqual({
      repertoireId: "r1",
      mode: "learn-new",
      chapterIds: ["A"],
      cardLimit: MAX_CARD_LIMIT,
      newCardLimit: 0,
      maxDepthPlies: MAX_DEPTH_PLIES
    });
    // A draft of another repertoire is ignored.
    const other = detailOf({ ...detail, id: "r2" });
    expect(initialPracticeInput(other, null).repertoireId).toBe("r2");
  });

  it("reads bounded whole numbers from the fields", () => {
    expect(boundedInt("12", 1, 500)).toBe(12);
    expect(boundedInt("9000", 1, 500)).toBe(500);
    expect(boundedInt("0", 1, 500)).toBeUndefined();
    expect(boundedInt("", 0, 500)).toBeUndefined();
    expect(boundedInt("0", 0, 500)).toBe(0);
  });

  it("builds a start input within the limits", () => {
    expect(
      practiceInputFromForm({
        repertoireId: "r1",
        mode: "review-due",
        chapterIds: [],
        depth: "2000",
        cards: "abc",
        fresh: "800"
      })
    ).toEqual({
      repertoireId: "r1",
      mode: "review-due",
      maxDepthPlies: MAX_DEPTH_PLIES,
      cardLimit: DEFAULT_CARD_LIMIT,
      newCardLimit: MAX_CARD_LIMIT
    });
    expect(
      practiceInputFromForm({
        repertoireId: "r1",
        mode: "learn-new",
        chapterIds: ["A"],
        depth: "",
        cards: "10",
        fresh: ""
      })
    ).toEqual({
      repertoireId: "r1",
      mode: "learn-new",
      chapterIds: ["A"],
      cardLimit: 10,
      newCardLimit: 0
    });
  });
});

describe("targeted practice presets", () => {
  it("starts exactly the named decisions, whether due or new", () => {
    expect(
      targetedPracticeInput("r1", {
        mode: "review-due",
        positionKeys: ["k1", "k1", "k2"],
        autoStart: true
      })
    ).toEqual({
      repertoireId: "r1",
      mode: "review-due",
      positionKeys: ["k1", "k2"],
      cardLimit: 2,
      newCardLimit: 2
    });
  });

  it("is no targeted start without autoStart or keys", () => {
    expect(targetedPracticeInput("r1", { positionKeys: ["k1"] })).toBeNull();
    expect(targetedPracticeInput("r1", { autoStart: true, positionKeys: [] })).toBeNull();
    expect(targetedPracticeInput("r1", null)).toBeNull();
  });

  it("never puts the targeted keys into the setup form", () => {
    const detail = detailOf({
      workspace: {
        lastChapterId: null,
        lastNodeId: null,
        orientation: "white",
        practiceDraft: { repertoireId: "r1", mode: "learn-new", positionKeys: ["stale"] }
      }
    });
    const initial = initialPracticeInput(detail, {
      positionKeys: ["k1"],
      autoStart: true
    });
    expect(initial.positionKeys).toBeUndefined();
    expect(initial.mode).toBe("learn-new");
  });

  it("retries a session's misses as an ungraded targeted queue", () => {
    const preset = retryMissedPreset({ missedPositionKeys: ["k2", "k1", "k2"] });
    expect(preset).toEqual({
      mode: "review-due",
      positionKeys: ["k2", "k1"],
      ungraded: true,
      autoStart: true
    });
    expect(targetedPracticeInput("r1", preset)).toEqual({
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
      targetedPracticeInput("r1", { mode: "review-due", positionKeys: ["k1"], autoStart: true })
    ).not.toHaveProperty("ungraded");
  });

  it("calls a targeted session extra practice", () => {
    expect(isExtraPractice({ positionKeys: ["k1"] })).toBe(true);
    expect(isExtraPractice({ positionKeys: [] })).toBe(false);
    expect(isExtraPractice({})).toBe(false);
  });

  it("opens Practice again on the setup, keeping only chapters and mode", () => {
    expect(presetForSetup({ mode: "review-due", positionKeys: ["k1"], autoStart: true })).toEqual({
      mode: "review-due"
    });
    expect(presetForSetup({ positionKeys: ["k1"], autoStart: true })).toBeNull();
    const chapters = { chapterIds: ["c1"] };
    expect(presetForSetup(chapters)).toBe(chapters);
    expect(presetForSetup(null)).toBeNull();
  });
});

describe("rehearse lines setup", () => {
  const rehearseDetail = (practiceDraft: StartPracticeInput | null = null) =>
    detailOf({
      chapters,
      workspace: { lastChapterId: null, lastNodeId: null, orientation: "white", practiceDraft }
    });

  it("builds a rehearse scope with chapter, branch and depth, and no card limits", () => {
    const form = {
      repertoireId: "r1",
      mode: "rehearse-lines" as const,
      chapterIds: ["A"],
      depth: "12",
      cards: "20",
      fresh: "5"
    };
    expect(
      practiceInputFromForm({ ...form, rehearseChapterId: "A", rehearseFromNodeId: "n4" })
    ).toEqual({
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "n4" },
      maxDepthPlies: 12
    });
    expect(
      practiceInputFromForm({ ...form, depth: "", rehearseChapterId: "A", rehearseFromNodeId: "" })
    ).toEqual({ repertoireId: "r1", mode: "rehearse-lines", rehearse: { chapterId: "A" } });
  });

  it("restores a saved rehearsal draft and drops a chapter that can't be rehearsed", () => {
    const draft: StartPracticeInput = {
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "n4" },
      maxDepthPlies: 8
    };
    expect(initialPracticeInput(rehearseDetail(draft), null)).toEqual(draft);
    const stale = { ...draft, rehearse: { chapterId: "B" } };
    expect(initialPracticeInput(rehearseDetail(stale), null).rehearse).toBeUndefined();
  });

  it("preselects a rehearse preset over the draft", () => {
    const initial = initialPracticeInput(
      rehearseDetail({ repertoireId: "r1", mode: "review-due", cardLimit: 10 }),
      { mode: "rehearse-lines", rehearse: { chapterId: "A", fromNodeId: "x" }, maxDepthPlies: 6 }
    );
    expect(initial).toMatchObject({
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "x" },
      maxDepthPlies: 6,
      cardLimit: 10
    });
  });

  it("auto-starts a rehearse preset, and keeps it on the setup for Practice again", () => {
    const preset = rehearsePreset({ chapterId: "A", fromNodeId: "n4" }, 10);
    expect(preset).toEqual({
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "n4" },
      maxDepthPlies: 10,
      autoStart: true
    });
    expect(autoStartPracticeInput("r1", preset)).toEqual({
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "n4" },
      maxDepthPlies: 10
    });
    expect(autoStartPracticeInput("r1", rehearsePreset({ chapterId: "A" }))).toEqual({
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "A" }
    });
    expect(autoStartPracticeInput("r1", { ...preset, autoStart: false })).toBeNull();
    expect(presetForSetup(preset)).toEqual({
      mode: "rehearse-lines",
      rehearse: { chapterId: "A", fromNodeId: "n4" },
      maxDepthPlies: 10
    });
  });

  it("lists branch starts where the player has an active continuation", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "w"));
    ({ tree } = addLine(tree, "root", ["d2d4"], "d"));
    ({ tree } = addLine(tree, "w0", ["c7c5"], "s"));
    const chapter = chapterOf(tree);
    const { starts, truncated } = rehearseStarts(chapter, "white", pathLabel);
    expect(starts.map((start) => start.nodeId)).toEqual(["w1"]);
    expect(starts[0].path).toContain("e5");
    expect(truncated).toBe(false);
    expect(rehearseStarts(chapter, "white", pathLabel, 0)).toEqual({
      starts: [],
      truncated: true
    });
    // The move after 1.e4 e5 is ply 3: a depth of 2 leaves nothing to start from.
    expect(rehearseStarts(chapter, "white", pathLabel, undefined, 3).starts).toHaveLength(1);
    expect(rehearseStarts(chapter, "white", pathLabel, undefined, 2).starts).toEqual([]);
  });

  it("lists no branch starts in the lead-up above a start marker or past a stop", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"], "w"));
    const chapter = {
      ...chapterOf(tree),
      nodeMeta: {
        w1: { edge: "included" as const, trainingStart: true },
        w2: { edge: "included" as const, trainingStop: true }
      }
    };
    // w1 (1.e4 e5) is the start; w2 (2.Nf3) stops, so 2...Nc6 is out of scope.
    expect(rehearseStarts(chapter, "white", pathLabel).starts.map((start) => start.nodeId)).toEqual(
      ["w1"]
    );
  });

  it("lists no branch start at a paused decision (played as context, never asked)", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"], "w"));
    const chapter = chapterOf(tree);
    const keys = buildChapterLookup(chapter).positionKeys;
    expect(rehearseStarts(chapter, "white", pathLabel).starts.map((start) => start.nodeId)).toEqual(
      ["w1", "w3"]
    );
    const paused = new Set([keys.get("w1")!]);
    expect(
      rehearseStarts(chapter, "white", pathLabel, undefined, undefined, paused).starts.map(
        (start) => start.nodeId
      )
    ).toEqual(["w3"]);
  });
});

describe("savesPracticeDraft", () => {
  it("saves only a start from the setup form", () => {
    const rehearse: StartPracticeInput = {
      repertoireId: "r1",
      mode: "rehearse-lines",
      rehearse: { chapterId: "c1" }
    };
    expect(savesPracticeDraft(rehearse, false)).toBe(true);
    // Study's "Rehearse from here" and the summary's "Rehearse again" are presets.
    expect(savesPracticeDraft(rehearse, true)).toBe(false);
    const targeted: StartPracticeInput = {
      repertoireId: "r1",
      mode: "review-due",
      positionKeys: ["k1"]
    };
    expect(savesPracticeDraft(targeted, false)).toBe(false);
  });
});

describe("explainedChapterIds", () => {
  const chapters = [chapter("b", { sortOrder: 1 }), chapter("a", { sortOrder: 0 })];
  const rehearse = (chapterId: string) =>
    ({ mode: "rehearse-lines", rehearse: { chapterId } }) as const;

  it("names the rehearsed chapter, or every chapter in scope", () => {
    const detail = detailOf({ chapters, decisionCount: 3 });
    expect(explainedChapterIds(detail, rehearse("b"))).toEqual(["b"]);
    expect(
      explainedChapterIds(detail, { mode: "learn-new", chapterIds: ["b", "gone", "a"] })
    ).toEqual(["b", "a"]);
    // A chapter that is gone names nothing in particular.
    expect(explainedChapterIds(detail, rehearse("gone"))).toEqual([]);
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
      explainedChapterIds(detailOf({ chapters, decisionCount: 3 }), { mode: "review-due" })
    ).toEqual([]);
    expect(
      explainedChapterIds(detailOf({ chapters, decisionCount: 0 }), { mode: "review-due" })
    ).toEqual(["a"]);
    const studied = detailOf({
      chapters,
      decisionCount: 0,
      workspace: {
        lastChapterId: "b",
        lastNodeId: null,
        orientation: "white",
        practiceDraft: null
      }
    });
    expect(explainedChapterIds(studied, { mode: "review-due" })).toEqual(["b"]);
    expect(explainedChapterIds(detailOf({ decisionCount: 0 }), { mode: "review-due" })).toEqual([]);
  });
});
