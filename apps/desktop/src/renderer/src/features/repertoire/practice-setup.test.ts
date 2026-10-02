import { describe, expect, it } from "vitest";
import type { RepertoireChapterSummary } from "@chaturanga/shared/types/repertoire";
import { detailOf } from "./__fixtures__/repertoire";
import {
  boundedInt,
  DEFAULT_CARD_LIMIT,
  initialPracticeInput,
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  practiceInputFromForm,
  practicableChapterIds
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
