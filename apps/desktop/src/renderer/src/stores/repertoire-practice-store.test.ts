import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttemptResult,
  PracticeCard,
  PracticeSessionSnapshot,
  RehearsalStep
} from "@chaturanga/shared/types/repertoire";
import { cardOf } from "../features/repertoire/__fixtures__/repertoire";
import {
  currentCard,
  lineCompleteText,
  openingReplyMessage,
  OTHER_LINE_TEXT,
  rehearsalLineNumber,
  rehearsalStepNumber,
  rehearsalTitle,
  useRepertoirePracticeStore,
  withAppendedCard,
  withCard
} from "./repertoire-practice-store";

const store = () => useRepertoirePracticeStore.getState();

function session(): PracticeSessionSnapshot {
  const cards = [cardOf("a", { orientation: "black" }), cardOf("b"), cardOf("c")];
  return {
    sessionId: "s1",
    repertoireId: "r1",
    mode: "review-due",
    scope: { repertoireId: "r1" },
    status: "active",
    cursor: 0,
    cards,
    totals: { total: 0, answered: 0, correct: 0, wrong: 0, revealed: 0, skipped: 0, remaining: 0 }
  };
}

describe("repertoire practice store", () => {
  beforeEach(() => store().reset());

  it("starts a session with recomputed totals and the card's orientation", () => {
    store().setSession(session());
    expect(store().session!.totals.remaining).toBe(3);
    expect(store().orientation).toBe("black");
    expect(currentCard(store().session)?.queueItemId).toBe("a");
    expect(currentCard(null)).toBeNull();
  });

  it("keeps the card after a move outside the repertoire, with its feedback", () => {
    store().setSession(session());
    store().applyAttempt({
      outcome: "outside-repertoire",
      acceptedUcis: [],
      preferredUci: null,
      feedback: "Too slow.",
      card: cardOf("a", { attemptsSoFar: 1 }),
      finalGrade: false
    });
    expect(store().message).toEqual({
      tone: "warn",
      text: "This move is outside your repertoire.",
      feedback: "Too slow."
    });
    expect(store().session!.cursor).toBe(0);
    expect(store().reveal).toBeNull();
  });

  it("keeps a wrong first answer retryable, and a correct retry shows the answer", () => {
    store().setSession(session());
    store().applyAttempt({
      outcome: "outside-repertoire",
      acceptedUcis: [],
      preferredUci: null,
      feedback: null,
      card: cardOf("a", { state: "answered-wrong", attemptsSoFar: 1 }),
      finalGrade: true
    });
    expect(store().reveal).toBeNull();
    expect(store().session!.totals.wrong).toBe(1);

    store().applyAttempt({
      outcome: "correct",
      acceptedUcis: ["e2e4"],
      preferredUci: "e2e4",
      feedback: null,
      card: cardOf("a", { state: "answered-wrong", attemptsSoFar: 2 }),
      finalGrade: false
    });
    expect(store().message).toEqual({
      tone: "success",
      text: "Correct — this card still counts as missed."
    });
    expect(store().reveal).toEqual({ ucis: ["e2e4"], preferredUci: "e2e4", explanation: null });
    expect(store().session!.totals.wrong).toBe(1);
  });

  it("marks a correct answer and advances to the next unanswered card", () => {
    store().setSession(session());
    store().applyAttempt({
      outcome: "correct",
      acceptedUcis: ["e2e4"],
      preferredUci: "e2e4",
      feedback: null,
      card: cardOf("a", { state: "answered-correct" }),
      finalGrade: true
    });
    expect(store().message?.tone).toBe("success");
    expect(store().session!.totals.correct).toBe(1);
    expect(store().advance()).toBe(true);
    expect(store().session!.cursor).toBe(1);
    expect(store().message).toBeNull();
  });

  it("reports illegal and already-final attempts", () => {
    store().setSession(session());
    const base = {
      acceptedUcis: [],
      preferredUci: null,
      feedback: null,
      card: cardOf("a"),
      finalGrade: false
    };
    store().applyAttempt({ ...base, outcome: "illegal" });
    expect(store().message?.text).toBe("That move isn't legal here.");
    store().applyAttempt({ ...base, outcome: "already-final" });
    expect(store().message?.tone).toBe("info");
  });

  it("shows hint stages, reveals and skips from the main process's results", () => {
    store().setSession(session());
    store().applyAction("hint", {
      card: cardOf("a", { hintStage: 1 }),
      revealed: { ucis: ["g1f3"], preferredUci: "g1f3", explanation: "Develop first." }
    });
    expect(store().hint).toBe("Develop first.");
    expect(store().hintUci).toBe("g1f3");
    store().applyAction("hint", { card: cardOf("a", { hintStage: 2 }) });
    expect(store().hint).toBe("Develop first.");

    store().applyAction("reveal", {
      card: cardOf("a", { state: "revealed" }),
      revealed: { ucis: ["g1f3"], preferredUci: "g1f3", explanation: null }
    });
    expect(store().reveal?.ucis).toEqual(["g1f3"]);
    expect(store().session!.totals.revealed).toBe(1);

    store().applyAction("skip", { card: cardOf("b", { state: "skipped" }) });
    expect(store().session!.totals.skipped).toBe(1);
    expect(store().advance()).toBe(true);
    expect(store().session!.cursor).toBe(2);
  });

  it("finishes when no card is left, and records the summary", () => {
    const finished = session();
    finished.cards = finished.cards.map((card) => ({ ...card, state: "skipped" as const }));
    store().setSession(finished);
    expect(store().advance()).toBe(false);
    store().setSummary({
      sessionId: "s1",
      repertoireId: "r1",
      unaided: 0,
      assisted: 0,
      missed: 0,
      skipped: 3,
      chapters: ["c1"],
      missedPositionKeys: []
    });
    expect(store().session!.status).toBe("finished");
    expect(store().summary?.skipped).toBe(3);
  });

  it("shows hints a resumed card already used", () => {
    const resumed = session();
    resumed.cards[0] = cardOf("a", { hintStage: 2 });
    resumed.cards[1] = cardOf("b", { hintStage: 1, prompt: "Castle" });
    store().setSession(resumed);
    expect(store().hint).toBe("Hints used earlier: the piece to move.");
    store().applyAction("skip", { card: cardOf("a", { state: "skipped", hintStage: 2 }) });
    store().advance();
    expect(store().hint).toBe("Castle · Hints used earlier: the written hint.");
  });

  it("shows the hint move and reveal a resumed card already gave out", () => {
    const resumed = session();
    resumed.cards[0] = cardOf("a", { hintStage: 3, state: "revealed" });
    resumed.shown = {
      hint: "Fight for the centre",
      hintUci: "e2e4",
      revealed: { ucis: ["e2e4", "d2d4"], preferredUci: "e2e4", explanation: null }
    };
    store().setSession(resumed);
    expect(store()).toMatchObject({
      hint: "Fight for the centre",
      hintUci: "e2e4",
      reveal: { ucis: ["e2e4", "d2d4"], preferredUci: "e2e4" }
    });
  });

  it("replays the lead-up and flips without touching grading", () => {
    store().setSession(session());
    store().setLeadUpIndex(2);
    expect(store().leadUpIndex).toBe(2);
    store().flip();
    expect(store().orientation).toBe("white");
    store().clearMessage();
    expect(store().message).toBeNull();
  });

  it("replaces a card by queue item", () => {
    const next = withCard(session(), cardOf("b", { state: "answered-wrong" }));
    expect(next.cards[1].state).toBe("answered-wrong");
    expect(next.totals.wrong).toBe(1);
  });

  it("ignores results without a session", () => {
    store().applyAttempt({
      outcome: "correct",
      acceptedUcis: [],
      preferredUci: null,
      feedback: null,
      card: cardOf("a"),
      finalGrade: true
    });
    store().applyAction("skip", { card: cardOf("a") });
    expect(store().session).toBeNull();
    expect(store().advance()).toBe(false);
  });
});

describe("repertoire practice store: line rehearsal", () => {
  beforeEach(() => store().reset());

  const lineCard = (
    id: string,
    lineId: string,
    stepIndex: number,
    extra: Partial<PracticeCard> = {}
  ) => cardOf(id, { rehearsal: { lineId, stepIndex }, ...extra });
  const reply = { san: "e5", uci: "e7e5", fen: "after-e5" };

  function rehearsal(cards = [lineCard("a", "L1", 0), lineCard("x", "L2", 0)]) {
    return {
      ...session(),
      mode: "rehearse-lines" as const,
      scope: { repertoireId: "r1", rehearse: { chapterId: "c1" } },
      cards
    };
  }

  function correct(card: PracticeCard, step: RehearsalStep): AttemptResult {
    return {
      outcome: "correct",
      acceptedUcis: ["e2e4"],
      preferredUci: "e2e4",
      feedback: null,
      card,
      finalGrade: true,
      rehearsal: step
    };
  }

  it("appends the next decision, animates the reply, then presents it", () => {
    store().setSession(rehearsal());
    const next = lineCard("b", "L1", 1, { fen: "after-e5" });
    store().applyAttempt(
      correct(lineCard("a", "L1", 0, { state: "answered-correct" }), {
        reply,
        next,
        lineComplete: false,
        endReason: null
      })
    );
    expect(store().session!.cards.map((card) => card.queueItemId)).toEqual(["a", "x", "b"]);
    expect(store().session!.cursor).toBe(0);
    expect(store().reveal).toBeNull();
    expect(store().rehearsal).toMatchObject({ replyShown: false, auto: true });
    store().showReply();
    expect(store().rehearsal?.replyShown).toBe(true);
    expect(store().presentStep()).toBe("next");
    expect(currentCard(store().session)?.queueItemId).toBe("b");
    expect(store().rehearsal).toBeNull();
    expect(store().message?.text).toBe("The reply: e5.");
    expect(store().presentStep()).toBe("none");
  });

  it("ends a line with its reason and keeps the final position", () => {
    store().setSession(rehearsal());
    store().applyAttempt(
      correct(lineCard("a", "L1", 0, { state: "answered-correct" }), {
        reply,
        next: null,
        lineComplete: true,
        endReason: "stop"
      })
    );
    store().showReply();
    expect(store().presentStep()).toBe("line-complete");
    expect(store().lineEnded).toBe("stop");
    expect(store().message?.text).toBe("The reply: e5. Line complete — reached your stop.");
    expect(store().rehearsal).toMatchObject({ replyShown: true, auto: false });
    store().continueStep();
    expect(store().rehearsal?.auto).toBe(false);
    expect(store().advance()).toBe(true);
    expect(currentCard(store().session)?.queueItemId).toBe("x");
    expect(store().lineEnded).toBeNull();
  });

  it("keeps the card on another line's choice until followed or retried", () => {
    store().setSession(rehearsal());
    const otherLine = { chapterId: "c1", chapterTitle: "Italian", nodeId: "n9", path: "1. d4" };
    store().applyAttempt({
      outcome: "other-line",
      otherLine,
      acceptedUcis: [],
      preferredUci: null,
      feedback: null,
      card: lineCard("a", "L1", 0, { attemptsSoFar: 1 }),
      finalGrade: false
    });
    expect(store().otherLine).toEqual(otherLine);
    expect(store().message).toEqual({ tone: "info", text: OTHER_LINE_TEXT });
    expect(store().session!.cursor).toBe(0);
    store().dismissOtherLine();
    expect(store().otherLine).toBeNull();
    expect(store().message).toBeNull();

    store().applyAttempt({
      outcome: "other-line",
      otherLine,
      acceptedUcis: [],
      preferredUci: null,
      feedback: null,
      card: lineCard("a", "L1", 0, { attemptsSoFar: 2 }),
      finalGrade: false
    });
    store().applyAction("follow-other-line", {
      card: lineCard("a", "L1", 0, { state: "answered-correct" }),
      rehearsal: { reply, next: lineCard("f", "L3", 1), lineComplete: false, endReason: null }
    });
    expect(store().otherLine).toBeNull();
    expect(store().rehearsal).toMatchObject({ auto: true, replyShown: false });
    expect(store().session!.cards.at(-1)?.queueItemId).toBe("f");
  });

  it("holds a revealed step until the player continues the line", () => {
    store().setSession(rehearsal());
    store().applyAction("reveal", {
      card: lineCard("a", "L1", 0, { state: "revealed" }),
      rehearsal: { reply, next: lineCard("b", "L1", 1), lineComplete: false, endReason: null },
      revealed: { ucis: ["e2e4"], preferredUci: "e2e4", explanation: null }
    });
    expect(store().reveal?.ucis).toEqual(["e2e4"]);
    expect(store().rehearsal).toMatchObject({ auto: false });
    store().continueStep();
    expect(store().rehearsal?.auto).toBe(true);
  });

  it("queues the next line's first decision after a skip, without animating anything", () => {
    store().setSession(rehearsal([lineCard("a", "L1", 0)]));
    store().applyAction("skip", {
      card: lineCard("a", "L1", 0, { state: "answered-wrong" }),
      rehearsal: { reply: null, next: lineCard("b", "L2", 0), lineComplete: false, endReason: null }
    });
    expect(store().session!.cards.map((card) => card.queueItemId)).toEqual(["a", "b"]);
    expect(store().rehearsal).toBeNull();
    expect(store().advance()).toBe(true);
    expect(currentCard(store().session)?.queueItemId).toBe("b");
    store().applyAction("hint", { card: lineCard("b", "L2", 0, { hintStage: 1 }) });
    expect(store().rehearsal).toBeNull();
  });

  it("shows Line complete between lines, then presents the next line's first decision", () => {
    store().setSession(rehearsal([lineCard("a", "L1", 0), lineCard("old", "L0", 0)]));
    const next = lineCard("n", "L2", 0, { leadUp: [{ san: "e4", uci: "e2e4", fen: "f" }] });
    store().applyAttempt(
      correct(lineCard("a", "L1", 0, { state: "answered-correct" }), {
        reply,
        next,
        lineComplete: true,
        endReason: "leaf"
      })
    );
    store().showReply();
    expect(store().presentStep()).toBe("line-complete");
    expect(currentCard(store().session)?.queueItemId).toBe("a");
    expect(store().lineEnded).toBe("leaf");
    expect(store().message?.text).toBe(
      "The reply: e5. Line complete — reached the end of the line."
    );
    expect(store().rehearsal).toMatchObject({ replyShown: true, auto: false });
    expect(store().presentStep()).toBe("none");
    // The next line's decision, not an older unanswered card.
    expect(store().advance()).toBe(true);
    expect(currentCard(store().session)?.queueItemId).toBe("n");
    expect(store().lineEnded).toBeNull();
    expect(store().rehearsal).toBeNull();
    expect(store().message).toBeNull();
  });

  it("announces the opponent's first reply of a line started where the opponent is to move", () => {
    const leadUp = [
      { san: "e4", uci: "e2e4", fen: "f1" },
      { san: "Nc6", uci: "b8c6", fen: "f2" }
    ];
    const fromE4 = {
      ...rehearsal([lineCard("a", "L1", 0, { nodeId: "n-nc6", leadUp })]),
      scope: { repertoireId: "r1", rehearse: { chapterId: "c1", fromNodeId: "n-e4" } }
    };
    store().setSession(fromE4);
    expect(store().message).toEqual({ tone: "info", text: "The reply: Nc6." });
    expect(openingReplyMessage(fromE4, lineCard("b", "L1", 1, { nodeId: "x", leadUp }))).toBeNull();
    expect(
      openingReplyMessage(fromE4, lineCard("c", "L2", 0, { nodeId: "n-e4", leadUp }))
    ).toBeNull();
    expect(openingReplyMessage(session(), cardOf("d", { nodeId: "x", leadUp }))).toBeNull();
    store().setSession(rehearsal());
    expect(store().message).toBeNull();
  });

  it("numbers lines and steps, and names why a line ended", () => {
    const cards = [lineCard("a", "L1", 0), lineCard("b", "L1", 1), lineCard("c", "L2", 0)];
    expect(rehearsalLineNumber(cards, "L1")).toBe(1);
    expect(rehearsalLineNumber(cards, "L2")).toBe(2);
    expect(rehearsalLineNumber(cards, "L9")).toBe(3);
    expect(rehearsalTitle("Najdorf", cards, cards[2])).toBe("Rehearsing · Najdorf · line 2");
    // The main process's number wins (a line planned again keeps its first number).
    const numbered = cardOf("d", { rehearsal: { lineId: "L1", stepIndex: 0, lineNumber: 4 } });
    expect(rehearsalTitle("Najdorf", cards, numbered)).toBe("Rehearsing · Najdorf · line 4");
    expect(rehearsalStepNumber(cards[1])).toBe(2);
    expect(lineCompleteText("leaf")).toBe("Line complete — reached the end of the line");
    expect(lineCompleteText("depth")).toBe("Line complete — reached the depth limit");
    expect(lineCompleteText(null)).toBe("Line complete — reached the end of the line");
  });

  it("appends a card once, replacing it when it is already queued", () => {
    const base = rehearsal();
    const appended = withAppendedCard(base, lineCard("b", "L1", 1));
    expect(appended.cards).toHaveLength(3);
    expect(appended.totals.remaining).toBe(3);
    const again = withAppendedCard(appended, lineCard("b", "L1", 1, { state: "skipped" }));
    expect(again.cards).toHaveLength(3);
    expect(again.totals.skipped).toBe(1);
  });
});
