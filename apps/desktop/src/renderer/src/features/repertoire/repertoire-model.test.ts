import { describe, expect, it } from "vitest";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { addLine, cardOf, chapterOf, rootNode } from "./__fixtures__/repertoire";
import {
  answerView,
  autoAdvanceDelay,
  autosaveStep,
  choiceActions,
  hasAnswerNotes,
  isPracticeNextKey,
  leadUpLabel,
  decisionCountWithMeta,
  decisionDeltaLabel,
  defaultEdgeForNewMove,
  deriveChoices,
  hintMarks,
  isStaleRevisionError,
  lastMoveOf,
  nextUnansweredIndex,
  numberedSan,
  pathLabel,
  revealArrows,
  saveStatusLabel,
  totalsOf,
  trainableDecisionCount,
  transpositionsOf,
  hintStageText,
  isMissingTargetError,
  isNotFoundError,
  decisionDraftHoldsBack,
  decisionDraftKey,
  decisionDraftMatches,
  decisionDraftName,
  decisionDraftPatch,
  decisionDraftWritable,
  decisionTextStatus,
  wrongMoveOptions,
  decisionTextValue,
  decisionWriteFailure,
  type DecisionTextDraft,
  nextDecisionDraft,
  occurrencesInOtherChapters,
  pieceNameAt,
  resumedHintText,
  revealText,
  sanOf,
  type ChoiceRow
} from "./repertoire-model";

/** 1. e4 e5 2. Nf3, with 1. d4 and 1... c5 as alternatives. */
function sampleChapter() {
  let tree = [rootNode()];
  ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "w"));
  ({ tree } = addLine(tree, "root", ["d2d4"], "d"));
  ({ tree } = addLine(tree, "w0", ["c7c5"], "s"));
  return tree;
}

describe("deriveChoices", () => {
  it("names accepted, preferred and reference continuations at a player-to-move position", () => {
    const chapter = chapterOf(sampleChapter(), { d0: { edge: "reference" } });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", null);
    expect(view.side).toBe("player");
    expect(view.rows.map((row) => [row.san, row.state])).toEqual([
      ["e4", "preferred"],
      ["d4", "reference"]
    ]);
  });

  it("follows a stored preference while it is supported", () => {
    const chapter = chapterOf(sampleChapter());
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", {
      acceptedUcis: ["e2e4", "d2d4"],
      preferredUci: "d2d4"
    });
    expect(view.rows.map((row) => row.state)).toEqual(["accepted", "preferred"]);
  });

  it("falls back to the first accepted move when the stored preference is a reference", () => {
    const chapter = chapterOf(sampleChapter(), { d0: { edge: "reference" } });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", {
      acceptedUcis: ["d2d4"],
      preferredUci: "d2d4"
    });
    expect(view.rows.map((row) => row.state)).toEqual(["preferred", "reference"]);
  });

  it("marks nothing preferred when the stored preference is played at another occurrence", () => {
    // The position is shared with another chapter, where 1. c4 is accepted and preferred.
    const chapter = chapterOf(sampleChapter());
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "root", "white", {
      acceptedUcis: ["c2c4", "e2e4", "d2d4"],
      preferredUci: "c2c4"
    });
    expect(view.rows.map((row) => row.state)).toEqual(["accepted", "accepted"]);
  });

  it("names covered and reference replies at an opponent-to-move position", () => {
    const chapter = chapterOf(sampleChapter(), {
      w1: { edge: "covered" },
      s0: { edge: "reference" }
    });
    const lookup = buildChapterLookup(chapter);
    const view = deriveChoices(chapter, lookup, "w0", "white", null);
    expect(view.side).toBe("opponent");
    expect(view.rows.map((row) => [row.san, row.state, row.disabled])).toEqual([
      ["e5", "covered", false],
      ["c5", "reference", false]
    ]);
  });

  it("marks moves outside training scope as not trained here", () => {
    const tree = sampleChapter();
    const states = (chapter: ReturnType<typeof chapterOf>, nodeId: string) =>
      deriveChoices(chapter, buildChapterLookup(chapter), nodeId, "white", {
        acceptedUcis: ["e2e4"],
        preferredUci: "e2e4"
      }).rows.map((row) => [row.san, row.state, row.edge]);

    // A reference or disabled chapter trains nothing.
    expect(states(chapterOf(tree, {}, { kind: "reference" }), "root")).toEqual([
      ["e4", "untrained", "included"],
      ["d4", "untrained", "included"]
    ]);
    expect(states(chapterOf(tree, {}, { enabled: false }), "root")[0][1]).toBe("untrained");
    // Before a start marker further down the line.
    expect(
      states(chapterOf(tree, { w2: { edge: "included", trainingStart: true } }), "root")[0][1]
    ).toBe("untrained");
    // After a stop: the stop node's position is no card.
    expect(states(chapterOf(tree, { w1: { edge: "covered", trainingStop: true } }), "w1")).toEqual([
      ["Nf3", "untrained", "included"]
    ]);
    // Under a reference branch, and a disabled move.
    expect(states(chapterOf(tree, { w0: { edge: "reference" } }), "w1")[0][1]).toBe("untrained");
    expect(states(chapterOf(tree, { d0: { edge: "included", disabled: true } }), "root")).toEqual([
      ["e4", "preferred", "included"],
      ["d4", "untrained", "included"]
    ]);
  });

  it("returns nothing for an unknown node", () => {
    const chapter = chapterOf(sampleChapter());
    expect(deriveChoices(chapter, buildChapterLookup(chapter), "nope", "white", null).rows).toEqual(
      []
    );
  });
});

describe("choiceActions", () => {
  const kinds = (row: Pick<ChoiceRow, "state" | "edge">, side: "player" | "opponent") =>
    choiceActions(row, side).map((action) => `${action.kind}:${action.variant}`);

  it("offers the player's moves accept, prefer and make reference by state", () => {
    expect(kinds({ state: "preferred", edge: "included" }, "player")).toEqual([
      "make-reference:ghost"
    ]);
    expect(kinds({ state: "accepted", edge: "included" }, "player")).toEqual([
      "prefer:outline",
      "make-reference:ghost"
    ]);
    expect(kinds({ state: "reference", edge: "reference" }, "player")).toEqual([
      "accept:outline",
      "prefer:outline"
    ]);
  });

  it("toggles an opponent's reply between covered and reference", () => {
    expect(kinds({ state: "covered", edge: "covered" }, "opponent")).toEqual([
      "make-reference:ghost"
    ]);
    expect(kinds({ state: "reference", edge: "reference" }, "opponent")).toEqual(["cover:outline"]);
  });

  it("outside training scope only keeps a move as reference (or covers a reply again)", () => {
    expect(kinds({ state: "untrained", edge: "included" }, "player")).toEqual([
      "make-reference:ghost"
    ]);
    expect(kinds({ state: "untrained", edge: "reference" }, "player")).toEqual([]);
    expect(kinds({ state: "untrained", edge: "reference" }, "opponent")).toEqual(["cover:ghost"]);
    expect(kinds({ state: "untrained", edge: "covered" }, "opponent")).toEqual([
      "make-reference:ghost"
    ]);
  });
});

describe("boundaries", () => {
  it("defaults new own moves to reference and replies to covered", () => {
    const tree = sampleChapter();
    expect(defaultEdgeForNewMove(tree[0].fenAfter, "white")).toBe("reference");
    expect(defaultEdgeForNewMove(tree[0].fenAfter, "black")).toBe("covered");
  });

  it("counts trainable decisions and the effect of a boundary toggle", () => {
    const chapter = chapterOf(sampleChapter());
    // Root (1. e4 / 1. d4) and after 1... e5 (2. Nf3).
    expect(trainableDecisionCount("white", chapter)).toBe(2);
    expect(decisionCountWithMeta("white", chapter, "w0", { disabled: true })).toBe(1);
    expect(decisionCountWithMeta("white", chapter, "w1", { trainingStart: true })).toBe(1);
    expect(decisionDeltaLabel(0)).toBe("no change");
    expect(decisionDeltaLabel(-1)).toBe("−1 decision");
    expect(decisionDeltaLabel(3)).toBe("+3 decisions");
  });
});

describe("positions and labels", () => {
  it("finds transpositions within the chapter", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["g1f3", "g8f6", "b1c3"], "a"));
    ({ tree } = addLine(tree, "root", ["b1c3", "g8f6", "g1f3"], "b"));
    const lookup = buildChapterLookup({ tree });
    expect(transpositionsOf(lookup, "a2")).toEqual(["b2"]);
    expect(transpositionsOf(lookup, "a0")).toEqual([]);
    expect(transpositionsOf(lookup, "missing")).toEqual([]);
  });

  it("labels a path with move numbers", () => {
    const lookup = buildChapterLookup({ tree: sampleChapter() });
    expect(pathLabel(lookup, "root")).toBe("Start");
    expect(pathLabel(lookup, "w2")).toBe("1. e4 e5 2. Nf3");
    expect(pathLabel(lookup, "s0")).toBe("1. e4 c5");
    const afterE4 = lookup.nodesById.get("w0")!.fenAfter;
    expect(numberedSan(afterE4, "e5", true)).toBe("1... e5");
  });

  it("splits a UCI move into squares", () => {
    expect(lastMoveOf("e2e4")).toEqual(["e2", "e4"]);
    expect(lastMoveOf(null)).toBeNull();
  });
});

describe("autosave decisions", () => {
  it("recognises a stale-revision refusal", () => {
    expect(
      isStaleRevisionError("Invalid expectedRevision: repertoire changed (stored 5, expected 4)")
    ).toBe(true);
    expect(
      isStaleRevisionError("Invalid chapter.revision: chapter changed (stored 3, expected 2)")
    ).toBe(true);
    expect(isStaleRevisionError("Invalid chapter: tree has no root")).toBe(false);
  });

  it("doesn't take another refusal of a revision for a stale one (reloading wouldn't help)", () => {
    // A replace from a backup with no expected revision (backup-restore.ts).
    expect(isStaleRevisionError("Invalid expectedRevision: required to replace a repertoire")).toBe(
      false
    );
    // Malformed input, refused by the IPC validators.
    expect(isStaleRevisionError("Invalid expectedRevision: must be a whole number")).toBe(false);
    expect(isStaleRevisionError("Invalid backup: chapter revision is not a number")).toBe(false);
    // The words alone, from some other message.
    expect(isStaleRevisionError("The opponent's repertoire changed")).toBe(false);
  });

  it("schedules, waits or blocks", () => {
    expect(autosaveStep({ dirty: false, saveState: { status: "idle" } })).toBe("idle");
    expect(autosaveStep({ dirty: true, saveState: { status: "idle" } })).toBe("schedule");
    expect(autosaveStep({ dirty: true, saveState: { status: "saving" } })).toBe("wait");
    expect(
      autosaveStep({ dirty: true, saveState: { status: "error", message: "x", stale: true } })
    ).toBe("blocked");
  });

  it("labels the save state", () => {
    expect(saveStatusLabel({ dirty: false, saveState: { status: "idle" } })).toBe("Saved");
    expect(saveStatusLabel({ dirty: true, saveState: { status: "idle" } })).toBe("Unsaved changes");
    expect(saveStatusLabel({ dirty: true, saveState: { status: "saving" } })).toBe("Saving…");
    expect(
      saveStatusLabel({
        dirty: true,
        saveState: { status: "error", message: "disk full", stale: false }
      })
    ).toBe("Unsaved — disk full");
  });

  it("never says Saved while a prompt or hint is unsaved, saving or refused", () => {
    const idle = { dirty: false, saveState: { status: "idle" } } as const;
    const text = { dirty: true, saving: false, errorMessage: null, errorStale: false };
    expect(saveStatusLabel({ ...idle, decisionText: { ...text, dirty: false } })).toBe("Saved");
    expect(saveStatusLabel({ ...idle, decisionText: text })).toBe("Unsaved changes");
    expect(saveStatusLabel({ ...idle, decisionText: { ...text, saving: true } })).toBe("Saving…");
    expect(saveStatusLabel({ ...idle, decisionText: { ...text, errorMessage: "disk full" } })).toBe(
      "Unsaved — disk full"
    );
    // The chapter's own failure is named first.
    expect(
      saveStatusLabel({
        dirty: true,
        saveState: { status: "error", message: "chapter refused", stale: false },
        decisionText: { ...text, errorMessage: "prompt refused" }
      })
    ).toBe("Unsaved — chapter refused");
  });

  it("tells a deleted repertoire or chapter from other read failures", () => {
    expect(isNotFoundError("Invalid repertoireId: not found", "repertoire")).toBe(true);
    expect(isNotFoundError("Invalid chapterId: not found", "chapter")).toBe(true);
    expect(isNotFoundError("Invalid chapterId: not found", "repertoire")).toBe(false);
    expect(
      isNotFoundError(
        "Repertoire chapter c1 is damaged and can't be opened: the move tree is missing",
        "chapter"
      )
    ).toBe(false);
    expect(isNotFoundError("Invalid positionKey: not found in this repertoire", "chapter")).toBe(
      false
    );
    expect(isNotFoundError("Invalid positionKey: not found in this repertoire", "position")).toBe(
      true
    );
    expect(isNotFoundError("Invalid chapterId: not found", "position")).toBe(false);
    expect(isNotFoundError("SQLITE_BUSY: database is locked", "repertoire")).toBe(false);
  });
});

describe("decision text drafts", () => {
  const draftOf = (overrides: Partial<DecisionTextDraft>): DecisionTextDraft =>
    ({
      repertoireId: "r1",
      positionKey: "k1",
      field: "prompt",
      text: "Develop",
      generation: 1,
      status: "pending",
      ...overrides
    }) as DecisionTextDraft;

  it("sends trimmed text, or null for a blank field", () => {
    expect(decisionTextValue("  Develop with tempo ")).toBe("Develop with tempo");
    expect(decisionTextValue("   ")).toBeNull();
  });

  it("keys a draft by repertoire, position and field, and feedback per wrong move", () => {
    expect(decisionDraftKey("r1", "k1", "prompt")).not.toBe(decisionDraftKey("r1", "k1", "hint"));
    expect(decisionDraftKey("r1", "k1", "hint")).not.toBe(decisionDraftKey("r2", "k1", "hint"));
    expect(decisionDraftKey("r1", "k1", "feedback", "d2d4")).not.toBe(
      decisionDraftKey("r1", "k1", "feedback", "c2c4")
    );
    expect(decisionDraftKey("r1", "k1", "paused")).not.toBe(
      decisionDraftKey("r1", "k1", "feedback", "paused")
    );
  });

  it("writes text fields, the pause, and feedback merged into the stored map", () => {
    expect(decisionDraftPatch(draftOf({ text: " Develop " }), null)).toEqual({
      prompt: "Develop"
    });
    expect(decisionDraftPatch(draftOf({ field: "hint", text: " " }), null)).toEqual({
      hint: null
    });
    expect(decisionDraftPatch(draftOf({ field: "paused", text: "", paused: true }), null)).toEqual({
      paused: true
    });
    const stored = { wrongMoveFeedback: { c2c4: "Not the English", d2d4: "Old" } };
    expect(
      decisionDraftPatch(draftOf({ field: "feedback", uci: "d2d4", text: " We play e4 " }), stored)
    ).toEqual({ wrongMoveFeedback: { c2c4: "Not the English", d2d4: "We play e4" } });
    // Blank text removes that move's feedback only.
    expect(
      decisionDraftPatch(draftOf({ field: "feedback", uci: "d2d4", text: "" }), stored)
    ).toEqual({ wrongMoveFeedback: { c2c4: "Not the English" } });
    expect(stored.wrongMoveFeedback.d2d4).toBe("Old");
    expect(
      decisionDraftPatch(draftOf({ field: "feedback", uci: "g1f3", text: "No" }), null)
    ).toEqual({ wrongMoveFeedback: { g1f3: "No" } });
  });

  it("tells when a draft holds what the decision stores", () => {
    const decision = {
      prompt: "Develop",
      hint: null,
      wrongMoveFeedback: { d2d4: "We play e4" },
      paused: false
    };
    expect(decisionDraftMatches(draftOf({ text: " Develop " }), decision)).toBe(true);
    expect(decisionDraftMatches(draftOf({ field: "hint", text: "" }), decision)).toBe(true);
    expect(decisionDraftMatches(draftOf({ field: "hint", text: "Nf3" }), decision)).toBe(false);
    const feedback = (uci: string, text: string) => draftOf({ field: "feedback", uci, text });
    expect(decisionDraftMatches(feedback("d2d4", "We play e4"), decision)).toBe(true);
    expect(decisionDraftMatches(feedback("d2d4", ""), decision)).toBe(false);
    expect(decisionDraftMatches(feedback("c2c4", ""), decision)).toBe(true);
    const pause = (paused: boolean) => draftOf({ field: "paused", text: "", paused });
    expect(decisionDraftMatches(pause(false), decision)).toBe(true);
    expect(decisionDraftMatches(pause(true), decision)).toBe(false);
    expect(decisionDraftMatches(pause(false), null)).toBe(true);
  });

  it("names a draft's change for notices", () => {
    expect(decisionDraftName(draftOf({}))).toBe("practice prompt");
    expect(decisionDraftName(draftOf({ field: "hint" }))).toBe("hint");
    expect(decisionDraftName(draftOf({ field: "feedback", uci: "d2d4" }), "d4")).toBe(
      "feedback for d4"
    );
    expect(decisionDraftName(draftOf({ field: "feedback", uci: "d2d4" }))).toBe(
      "feedback for d2d4"
    );
    expect(decisionDraftName(draftOf({ field: "paused", paused: true }))).toBe("pause");
    expect(decisionDraftName(draftOf({ field: "paused", paused: false }))).toBe("resume");
  });

  it("summarises one repertoire's drafts for the save status", () => {
    const drafts = {
      a: draftOf({ status: "saving" }),
      b: draftOf({ field: "hint", status: "error", error: { message: "refused", stale: true } }),
      c: draftOf({ repertoireId: "r2", status: "error", error: { message: "x", stale: false } })
    };
    expect(decisionTextStatus(drafts, "r1")).toEqual({
      dirty: true,
      saving: true,
      errorMessage: "refused",
      errorStale: true,
      holdsBack: "stale"
    });
    expect(decisionTextStatus(drafts, "r2")).toMatchObject({ errorStale: false, saving: false });
    expect(decisionTextStatus(drafts, "r3")).toEqual({
      dirty: false,
      saving: false,
      errorMessage: null,
      errorStale: false,
      holdsBack: null
    });
    // A change whose position left the repertoire is unsaved but holds nothing back.
    const gone = {
      d: draftOf({
        status: "error",
        error: {
          message: "This position is no longer in the repertoire.",
          stale: false,
          missing: true
        }
      })
    };
    expect(decisionTextStatus(gone, "r1")).toMatchObject({ dirty: true, holdsBack: null });
    expect(decisionTextStatus({ ...gone, a: drafts.a }, "r1").holdsBack).toBe("unsaved");
  });

  describe("state machine (nextDecisionDraft)", () => {
    const change = { repertoireId: "r1", positionKey: "k1", field: "prompt" as const, text: "A" };
    const failure = { message: "disk full", stale: false };
    const stale = { message: "repertoire changed", stale: true };

    it("creates a draft on the first edit and keeps its state on later ones", () => {
      const created = nextDecisionDraft(undefined, { type: "edit", change }).draft!;
      expect(created).toEqual({ ...change, generation: 1, status: "pending" });
      const failed = nextDecisionDraft(created, { type: "failed", error: failure }).draft!;
      expect(nextDecisionDraft(failed, { type: "edit", change: { ...change, text: "B" } })).toEqual(
        {
          draft: { ...change, text: "B", generation: 2, status: "error", error: failure },
          writeAgain: false
        }
      );
      const paused = nextDecisionDraft(undefined, {
        type: "edit",
        change: { ...change, field: "paused", text: "", paused: true }
      }).draft!;
      expect(paused).toMatchObject({ paused: true });
      expect(created).not.toHaveProperty("uci");
      expect(created).not.toHaveProperty("paused");
    });

    it("drops a draft saved as sent, and keeps one typed while it saved", () => {
      const saving = nextDecisionDraft(draftOf({}), { type: "saving" }).draft!;
      expect(saving.status).toBe("saving");
      expect(nextDecisionDraft(saving, { type: "saved", generation: 1 })).toEqual({
        draft: null,
        writeAgain: false
      });
      const edited = { ...saving, generation: 2 };
      expect(nextDecisionDraft(edited, { type: "saved", generation: 1 }).draft).toEqual({
        ...draftOf({ generation: 2 })
      });
      expect(nextDecisionDraft(undefined, { type: "saved", generation: 1 }).draft).toBeNull();
    });

    it("writes again after a write that ran while it was committed again, unless refused as stale", () => {
      const saving = nextDecisionDraft(draftOf({}), { type: "saving" }).draft!;
      const marked = nextDecisionDraft(saving, { type: "commit" }).draft!;
      expect(marked).toMatchObject({ status: "saving", saveAgain: true });
      expect(
        nextDecisionDraft({ ...marked, generation: 2 }, { type: "saved", generation: 1 })
      ).toEqual({ draft: draftOf({ generation: 2 }), writeAgain: true });
      // Committed again but unchanged: saved as sent, nothing left to write.
      expect(nextDecisionDraft(marked, { type: "saved", generation: 1 }).writeAgain).toBe(false);
      expect(nextDecisionDraft(marked, { type: "failed", error: failure })).toEqual({
        draft: draftOf({ status: "error", error: failure }),
        writeAgain: true
      });
      expect(nextDecisionDraft(marked, { type: "failed", error: stale }).writeAgain).toBe(false);
      // Only a running write takes the mark; a new write clears it.
      expect(nextDecisionDraft(draftOf({}), { type: "commit" }).draft).toEqual(draftOf({}));
      expect(nextDecisionDraft(marked, { type: "saving" }).draft).toEqual(
        draftOf({ status: "saving" })
      );
    });

    it("retries a failure that isn't stale; Keep mine any failure", () => {
      const failed = draftOf({ status: "error", error: failure });
      const refused = draftOf({ status: "error", error: stale });
      expect(nextDecisionDraft(failed, { type: "retry" }).draft).toEqual(draftOf({}));
      expect(nextDecisionDraft(refused, { type: "retry" }).draft).toBe(refused);
      expect(nextDecisionDraft(refused, { type: "retry", stale: true }).draft).toEqual(draftOf({}));
      expect(nextDecisionDraft(draftOf({}), { type: "retry", stale: true }).draft).toEqual(
        draftOf({})
      );
    });

    it("writes a pending draft; a failed one only on Retry, never a stale one, always a gone position", () => {
      const missing = {
        message: "This position is no longer in the repertoire.",
        stale: false,
        missing: true
      };
      expect(decisionDraftWritable(draftOf({}), false)).toBe(true);
      expect(decisionDraftWritable(draftOf({ status: "error", error: failure }), false)).toBe(
        false
      );
      expect(decisionDraftWritable(draftOf({ status: "error", error: failure }), true)).toBe(true);
      expect(decisionDraftWritable(draftOf({ status: "error", error: stale }), true)).toBe(false);
      expect(decisionDraftWritable(draftOf({ status: "error", error: missing }), false)).toBe(true);
      expect(decisionDraftHoldsBack(draftOf({ status: "error", error: missing }))).toBe(false);
      expect(decisionDraftHoldsBack(draftOf({ status: "error", error: stale }))).toBe(true);
    });

    it("reads a refused write's message in one place", () => {
      expect(decisionWriteFailure("Invalid repertoireId: not found")).toBe("repertoire-gone");
      expect(decisionWriteFailure("Invalid positionKey: not found in this repertoire")).toEqual({
        message: "This position is no longer in the repertoire.",
        stale: false,
        missing: true
      });
      expect(decisionWriteFailure("Invalid expectedRevision: repertoire changed")).toEqual({
        message: "Invalid expectedRevision: repertoire changed",
        stale: true
      });
      expect(decisionWriteFailure("disk full")).toEqual({ message: "disk full", stale: false });
      expect(decisionWriteFailure("read failed", { stale: true })).toEqual({
        message: "read failed",
        stale: true
      });
    });
  });
});

describe("wrongMoveOptions", () => {
  it("lists the legal moves left once accepted moves and existing feedback are excluded", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const options = wrongMoveOptions(start, new Set(["e2e4", "d2d4"]));
    expect(options).toHaveLength(18);
    expect(options.map((option) => option.uci)).not.toContain("e2e4");
    expect(options).toContainEqual({ uci: "g1f3", san: "Nf3" });
    expect(options.map((option) => option.san)).toEqual(
      [...options.map((option) => option.san)].sort((a, b) => a.localeCompare(b))
    );
    expect(wrongMoveOptions("not a fen", new Set())).toEqual([]);
  });

  it("lists castling king-two-squares and each promotion piece", () => {
    const castling = wrongMoveOptions("4k3/8/8/8/8/8/8/4K2R w K - 0 1", new Set());
    expect(castling).toContainEqual({ uci: "e1g1", san: "O-O" });
    expect(castling.map((option) => option.uci)).not.toContain("e1h1");
    const promotion = wrongMoveOptions("8/P6k/8/8/8/8/8/K7 w - - 0 1", new Set(["a7a8q"]));
    expect(promotion.filter((option) => option.uci.startsWith("a7a8")).map((o) => o.san)).toEqual([
      "a8=B",
      "a8=N",
      "a8=R"
    ]);
  });
});

describe("practice helpers", () => {
  it("recomputes totals from card states", () => {
    const totals = totalsOf([
      cardOf("a", { state: "answered-correct" }),
      cardOf("b", { state: "revealed" }),
      cardOf("c", { state: "skipped" }),
      cardOf("d", { state: "answered-wrong" }),
      cardOf("e")
    ]);
    expect(totals).toEqual({
      total: 5,
      answered: 4,
      correct: 1,
      wrong: 1,
      revealed: 1,
      skipped: 1,
      remaining: 1
    });
  });

  it("finds the next unanswered card, wrapping around", () => {
    const cards = [
      cardOf("a"),
      cardOf("b", { state: "skipped" }),
      cardOf("c", { state: "revealed" })
    ];
    expect(nextUnansweredIndex(cards, 2)).toBe(0);
    // The current card itself comes back last (it is still unanswered after a wrong move).
    expect(nextUnansweredIndex(cards, 0)).toBe(0);
    expect(nextUnansweredIndex([cardOf("a", { state: "skipped" })], 0)).toBe(-1);
  });

  it("marks hint stages and reveals on the board", () => {
    expect(hintMarks(1, "g1f3")).toEqual({ arrows: [], highlights: [] });
    expect(hintMarks(2, "g1f3").highlights).toEqual([{ square: "g1", color: "green" }]);
    expect(hintMarks(3, "g1f3").arrows).toEqual([{ orig: "g1", dest: "f3", color: "green" }]);
    expect(hintMarks(3, null)).toEqual({ arrows: [], highlights: [] });
    expect(revealArrows(["e2e4", "d2d4"], "d2d4")).toEqual([
      { orig: "e2", dest: "e4", color: "blue" },
      { orig: "d2", dest: "d4", color: "green" }
    ]);
  });
});

describe("cross-chapter occurrences", () => {
  it("keeps other chapters' occurrences once each", () => {
    const occurrence = (chapterId: string, nodeId: string) => ({
      chapterId,
      chapterTitle: chapterId,
      nodeId,
      path: "1. e4",
      ply: 1
    });
    expect(
      occurrencesInOtherChapters(
        [
          occurrence("c1", "n1"),
          occurrence("c2", "n4"),
          occurrence("c2", "n4"),
          occurrence("c3", "n2")
        ],
        "c1"
      ).map((item) => `${item.chapterId}:${item.nodeId}`)
    ).toEqual(["c2:n4", "c3:n2"]);
  });

  it("treats a deleted repertoire's refusal as a draft to drop", () => {
    expect(isMissingTargetError("Repertoire not found: r1")).toBe(true);
    expect(isMissingTargetError("Invalid expectedRevision: repertoire changed")).toBe(false);
  });
});

describe("practice text", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const promotion = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";

  it("names pieces and moves", () => {
    expect(pieceNameAt(start, "g1")).toBe("knight");
    expect(pieceNameAt(start, "e8")).toBe("king");
    expect(pieceNameAt(start, "e4")).toBeNull();
    expect(pieceNameAt(start, "z9")).toBeNull();
    expect(sanOf(start, "g1f3")).toBe("Nf3");
    expect(sanOf(start, "e2e5")).toBe("e2e5");
    expect(sanOf(promotion, "e7e8n")).toBe("e8=N");
  });

  it("describes a reveal in words", () => {
    expect(revealText(start, ["e2e4", "g1f3", "c2c4"], "g1f3")).toBe(
      "Preferred: Nf3 · also accepted: e4, c4"
    );
    expect(revealText(start, ["e2e4"], null)).toBe("Preferred: e4");
    expect(revealText(start, [], null)).toMatch(/No accepted move/);
  });

  it("describes board hints in words", () => {
    expect(hintStageText(start, 1, "g1f3")).toBeNull();
    expect(hintStageText(start, 2, "g1f3")).toBe("Move the knight");
    expect(hintStageText(start, 2, "e4e5")).toBe("Move the piece on e4");
    expect(hintStageText(start, 3, "g1f3")).toBe("g1 to f3");
    expect(hintStageText(start, 3, null)).toBeNull();
  });

  it("after a correct answer, names the move played, the other accepted moves and the notes", () => {
    const answer = {
      ucis: ["e2e4", "g1f3", "c2c4"],
      preferredUci: "g1f3",
      explanation: " The centre first. ",
      moveComments: { e2e4: "Open games.", c2c4: " ", g1f3: "Flexible." }
    };
    expect(answerView(start, answer, "e2e4")).toEqual({
      answer: "You played e4.",
      alternatives: "Also accepted: Nf3 (preferred), c4",
      explanation: "The centre first.",
      moveNotes: [
        { uci: "g1f3", san: "Nf3", text: "Flexible." },
        { uci: "e2e4", san: "e4", text: "Open games." }
      ]
    });
    expect(answerView(start, { ...answer, ucis: ["g1f3"] }, "g1f3").alternatives).toBeNull();
  });

  it("after a reveal, words the answer as the reveal always has", () => {
    const view = answerView(
      start,
      { ucis: ["e2e4", "g1f3"], preferredUci: null, explanation: null },
      null
    );
    expect(view).toEqual({
      answer: "Preferred: e4 · also accepted: Nf3",
      alternatives: null,
      explanation: null,
      moveNotes: []
    });
  });

  it("auto-advances a correct answer only when it is on and there is nothing to read", () => {
    const plain = { ucis: ["e2e4"], preferredUci: "e2e4", explanation: null };
    expect(autoAdvanceDelay(600, plain)).toBe(600);
    expect(autoAdvanceDelay(600, null)).toBe(600);
    expect(autoAdvanceDelay(0, plain)).toBeNull();
    expect(autoAdvanceDelay(3000, { ...plain, explanation: "Why" })).toBeNull();
    expect(autoAdvanceDelay(1500, { ...plain, moveComments: { e2e4: "Note" } })).toBeNull();
    expect(hasAnswerNotes({ ...plain, explanation: "  ", moveComments: { e2e4: " " } })).toBe(
      false
    );
    expect(hasAnswerNotes(null)).toBe(false);
  });

  it("takes Space and Enter as Next, except where they already mean something", () => {
    const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      defaultPrevented: false,
      ...extra
    });
    const free = { typing: false, blocked: false, onControl: false };
    expect(isPracticeNextKey(key(" "), free)).toBe(true);
    expect(isPracticeNextKey(key("Enter"), free)).toBe(true);
    expect(isPracticeNextKey(key("n"), free)).toBe(false);
    expect(isPracticeNextKey(key("f"), free)).toBe(false);
    expect(isPracticeNextKey(key(" "), { ...free, typing: true })).toBe(false);
    expect(isPracticeNextKey(key("Enter"), { ...free, blocked: true })).toBe(false);
    expect(isPracticeNextKey(key("Enter"), { ...free, onControl: true })).toBe(false);
    expect(isPracticeNextKey(key(" ", { repeat: true }), free)).toBe(false);
    expect(isPracticeNextKey(key("Enter", { metaKey: true }), free)).toBe(false);
    expect(isPracticeNextKey(key(" ", { shiftKey: true }), free)).toBe(false);
    expect(isPracticeNextKey(key(" ", { defaultPrevented: true }), free)).toBe(false);
  });

  it("numbers a lead-up from each move's resulting position", () => {
    expect(leadUpLabel([])).toBe("Start");
    expect(
      leadUpLabel([
        { san: "e4", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" },
        { san: "c5", fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" },
        { san: "Nf3", fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2" }
      ])
    ).toBe("1. e4 c5 2. Nf3");
    // A chapter starting with Black to move.
    expect(
      leadUpLabel([
        { san: "Nc6", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3" }
      ])
    ).toBe("2... Nc6");
  });

  it("says which hints a resumed card already used", () => {
    expect(resumedHintText({ hintStage: 0, prompt: null })).toBeNull();
    expect(resumedHintText({ hintStage: 3, prompt: null })).toBe("Hints used earlier: the move.");
    expect(resumedHintText({ hintStage: 2, prompt: "Develop" })).toBe(
      "Develop · Hints used earlier: the piece to move."
    );
  });
});
