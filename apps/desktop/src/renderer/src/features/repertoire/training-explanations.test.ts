import { describe, expect, it } from "vitest";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { TrainingBlocker } from "@chaturanga/shared/chess/repertoire-training";
import { addLine, rootNode } from "./__fixtures__/repertoire";
import {
  blockerExplanation,
  blockerFocusNodeId,
  importPracticeNote,
  markEffect,
  moveLabel,
  practiceEmptyExplanation,
  scopeStatus,
  startUnavailableReason,
  studyPracticeAvailability,
  trainingFix
} from "./training-explanations";

/** 1. e4 c5 2. Nf3 d6: ids s0…s3. */
const lookup = buildChapterLookup({
  tree: addLine([rootNode()], "root", ["e2e4", "c7c5", "g1f3", "d7d6"], "s").tree
});

describe("moveLabel", () => {
  it("numbers a move as it reads on its own", () => {
    expect(moveLabel(lookup, "s0")).toBe("1. e4");
    expect(moveLabel(lookup, "s1")).toBe("1... c5");
    expect(moveLabel(lookup, "root")).toBe("the start");
  });
});

describe("blockerExplanation", () => {
  const explain = (blocker: TrainingBlocker) =>
    blockerExplanation(blocker, "Chapter 1", lookup, "white");

  it("names the chapter when the chapter itself is the cause", () => {
    expect(explain({ kind: "left-out" }).title).toBe("“Chapter 1” is left out of practice");
    expect(explain({ kind: "reference-chapter" }).title).toBe("“Chapter 1” is a reference chapter");
  });

  it("tells the player's reference move from a reply's", () => {
    const own = explain({ kind: "reference-move", nodeId: "s0" });
    expect(own.title).toBe("Your moves here are kept as reference");
    expect(own.detail).toContain("1. e4 is reference only");
    expect(own.detail).toContain("until you accept them");
    const reply = explain({ kind: "reference-move", nodeId: "s1" });
    expect(reply.title).toBe("A reply here is kept as reference");
    expect(reply.detail).toContain("1... c5 is reference only");
  });

  it("names the marked move for the training marks", () => {
    expect(explain({ kind: "disabled-branch", nodeId: "s2" }).detail).toContain(
      "2. Nf3 is marked “Leave out of practice”"
    );
    expect(explain({ kind: "stopped", nodeId: "s1" }).detail).toContain(
      "1... c5 is marked “End practice here”"
    );
    expect(explain({ kind: "before-start", nodeId: "s3" }).detail).toContain(
      "2... d6 is marked “Start practice here”"
    );
  });

  it("asks for moves when there are none of the player's", () => {
    expect(explain({ kind: "no-moves" }).title).toBe("No moves yet");
    expect(
      blockerExplanation({ kind: "no-own-moves" }, "Chapter 1", lookup, "black").detail
    ).toContain("you play Black");
  });
});

describe("trainingFix", () => {
  it("makes the chapter practised for the chapter and reference causes", () => {
    for (const blocker of [
      { kind: "left-out" },
      { kind: "reference-chapter" },
      { kind: "reference-move", nodeId: "s0" }
    ] as const) {
      expect(trainingFix(blocker)).toMatchObject({
        kind: "make-trainable",
        label: "Practise this chapter"
      });
    }
  });

  it("removes the mark in the way", () => {
    expect(trainingFix({ kind: "disabled-branch", nodeId: "s2" })).toMatchObject({
      kind: "clear-mark",
      nodeId: "s2",
      patch: { disabled: false }
    });
    expect(trainingFix({ kind: "stopped", nodeId: "s1" })).toMatchObject({
      patch: { trainingStop: false }
    });
    expect(trainingFix({ kind: "before-start", nodeId: "s3" })).toMatchObject({
      patch: { trainingStart: false }
    });
  });

  it("has nothing to offer when moves are missing", () => {
    expect(trainingFix({ kind: "no-moves" })).toBeNull();
    expect(trainingFix({ kind: "no-own-moves" })).toBeNull();
  });
});

describe("blockerFocusNodeId", () => {
  it("opens the position listing a reference move, or the marked move", () => {
    expect(blockerFocusNodeId({ kind: "reference-move", nodeId: "s2" }, lookup)).toBe("s1");
    expect(blockerFocusNodeId({ kind: "reference-move", nodeId: "s0" }, lookup)).toBe("root");
    expect(blockerFocusNodeId({ kind: "stopped", nodeId: "s1" }, lookup)).toBe("s1");
    expect(blockerFocusNodeId({ kind: "left-out" }, lookup)).toBe("root");
  });
});

describe("scopeStatus", () => {
  it("says whether a position is practised and why not", () => {
    expect(scopeStatus(null, lookup)).toBe("Practised");
    expect(scopeStatus({ kind: "reference-move", nodeId: "s0" }, lookup)).toBe(
      "Not practised: 1. e4 is reference only"
    );
    expect(scopeStatus({ kind: "before-start", nodeId: "s2" }, lookup)).toBe(
      "Played for you: practice starts at 2. Nf3"
    );
    expect(scopeStatus({ kind: "stopped", nodeId: "s1" }, lookup)).toBe(
      "Not practised: practice ends at 1... c5"
    );
    expect(scopeStatus({ kind: "disabled-branch", nodeId: "s1" }, lookup)).toBe(
      "Not practised: 1... c5 is left out of practice"
    );
    expect(scopeStatus({ kind: "left-out" }, lookup)).toBe(
      "Not practised: the chapter is left out of practice"
    );
    expect(scopeStatus({ kind: "reference-chapter" }, lookup)).toBe(
      "Not practised: this is a reference chapter"
    );
  });
});

describe("markEffect", () => {
  it("states the change in decisions, or that there is none", () => {
    expect(markEffect(false, 2)).toBe("Turning it on: +2 decisions");
    expect(markEffect(true, -1)).toBe("Turning it off: −1 decision");
    expect(markEffect(false, 0)).toBe("No change to what this chapter practises");
  });
});

describe("practiceEmptyExplanation", () => {
  it("names the chapter and the cause when the chapter has nothing to practise", () => {
    const empty = practiceEmptyExplanation(
      "rehearse-lines",
      { title: "Your moves here are kept as reference", detail: "1. e4 is reference only." },
      "Chapter 1"
    );
    expect(empty).toEqual({
      title: "Nothing to practise in “Chapter 1”",
      detail: "Your moves here are kept as reference. 1. e4 is reference only.",
      offerLearnNew: false
    });
    expect(practiceEmptyExplanation("review-due", { title: "T", detail: "D" }, null).title).toBe(
      "Nothing to practise yet"
    );
  });

  it("otherwise explains what each mode found", () => {
    expect(practiceEmptyExplanation("review-due", null, null)).toMatchObject({
      title: "No reviews due",
      offerLearnNew: true
    });
    expect(practiceEmptyExplanation("learn-new", null, null).detail).toContain("paused");
    expect(practiceEmptyExplanation("rehearse-lines", null, null).detail).toContain("max depth");
  });
});

describe("startUnavailableReason", () => {
  const ready = {
    decisionCount: 3,
    practicableChapters: 1,
    rehearsing: false,
    rehearseChapterId: ""
  };

  it("names what keeps Start from running", () => {
    expect(startUnavailableReason(ready)).toBeNull();
    expect(startUnavailableReason({ ...ready, decisionCount: 0 })).toContain("see why above");
    expect(startUnavailableReason({ ...ready, practicableChapters: 0 })).toContain("see why");
    expect(startUnavailableReason({ ...ready, rehearsing: true })).toBe(
      "Choose a chapter to rehearse."
    );
    expect(
      startUnavailableReason({ ...ready, rehearsing: true, rehearseChapterId: "c1" })
    ).toBeNull();
  });
});

describe("studyPracticeAvailability", () => {
  const paused = new Set(["k1"]);

  it("gives the blocker as the reason for both actions", () => {
    expect(
      studyPracticeAvailability({
        blocker: { title: "Your moves here are kept as reference", detail: "" },
        decisionKeys: [],
        paused,
        rehearsableLines: 0
      })
    ).toEqual({
      practice: "Nothing to practise yet: your moves here are kept as reference.",
      rehearse: "Nothing to practise yet: your moves here are kept as reference."
    });
    expect(
      studyPracticeAvailability({
        blocker: { title: "“Chapter 1” is left out of practice", detail: "" },
        decisionKeys: [],
        paused,
        rehearsableLines: 0
      }).practice
    ).toBe("Nothing to practise yet: “Chapter 1” is left out of practice.");
  });

  it("says when every decision is paused, or no line asks a move", () => {
    expect(
      studyPracticeAvailability({
        blocker: null,
        decisionKeys: ["k1"],
        paused,
        rehearsableLines: 0
      })
    ).toEqual({
      practice: "Every decision in this chapter is paused (see Notes).",
      rehearse: "Every decision in this chapter is paused (see Notes)."
    });
    expect(
      studyPracticeAvailability({
        blocker: null,
        decisionKeys: ["k1", "k2"],
        paused,
        rehearsableLines: 0
      })
    ).toEqual({ practice: null, rehearse: "No line in this chapter asks a move of yours." });
    expect(
      studyPracticeAvailability({
        blocker: null,
        decisionKeys: ["k2"],
        paused,
        rehearsableLines: 2
      })
    ).toEqual({ practice: null, rehearse: null });
  });
});

describe("importPracticeNote", () => {
  it("says what a game will practise as each kind of chapter", () => {
    expect(importPracticeNote("reference", 4, "white")).toEqual({
      text: "Reference: kept for study only, never practised.",
      warn: false
    });
    expect(importPracticeNote("opening", 4, "white").text).toMatch(/^4 decisions to practise/);
    expect(importPracticeNote("opening", 1, "white").text).toMatch(/^1 decision to practise/);
    expect(importPracticeNote("opening", 0, "black")).toEqual({
      text: "No moves of yours (Black) to practise in this game.",
      warn: true
    });
  });
});
