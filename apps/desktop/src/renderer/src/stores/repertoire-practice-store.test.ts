import { beforeEach, describe, expect, it } from "vitest";
import type { PracticeSessionSnapshot } from "@chaturanga/shared/types/repertoire";
import { cardOf } from "../features/repertoire/__fixtures__/repertoire";
import { currentCard, useRepertoirePracticeStore, withCard } from "./repertoire-practice-store";

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
