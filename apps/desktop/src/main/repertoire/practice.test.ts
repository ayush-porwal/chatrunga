import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateDecisionInput } from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  GRADING_SETTINGS,
  nodeAt,
  serviceHelpers,
  setPracticeSettings
} from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { progressRepository } = await import("./repository");
const { attemptRepository } = await import("./practice-repository");
const { create, save, learnFirst, attempt } = serviceHelpers(service);
const { userData, sent } = env;

const DAY = 24 * 60 * 60_000;
let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

describe("repertoire service: practice", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    getDb().exec("DELETE FROM repertoire_new_introductions");
    setPracticeSettings(getDb(), GRADING_SETTINGS);
    service.resetImportJobs();
    sent.length = 0;
    now = 1_000_000_000_000;
  });

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("review-due with nothing due returns an empty finished session", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const session = service.startPractice({
      repertoireId: id,
      mode: "review-due",
      newCardLimit: 0
    });
    expect(session).toMatchObject({ status: "finished", cards: [], totals: { total: 0 } });
  });

  it("review-due queues due cards, then new ones", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const first = learnFirst(id);
    expect(first.session.cards).toHaveLength(2);
    attempt(first.session.sessionId, first.card.queueItemId, "e2e4");
    now += 2 * DAY;
    const review = service.startPractice({ repertoireId: id, mode: "review-due" });
    expect(review.cards.map((card) => [card.positionKey === START_KEY, card.stage])).toStrictEqual([
      [true, "review"],
      [false, "new"]
    ]);
    expect(review.cards[1].leadUp.map((move) => move.uci)).toStrictEqual(["e2e4", "e7e5"]);
    const shallow = service.startPractice({
      repertoireId: id,
      mode: "learn-new",
      maxDepthPlies: 1
    });
    expect(shallow.cards).toHaveLength(0);
  });

  it("orders new cards by depth from each chapter's root, not by move number", () => {
    const { id } = create();
    const first = save(id, [["e2e4", "e7e5", "g1f3"]]);
    const later = "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 10";
    save(id, [["c2c4"]], { chapterId: "second", rootFen: later });
    const deep = nodeAt(first.chapter.tree, ["e2e4", "e7e5"]);
    const session = service.startPractice({ repertoireId: id, mode: "learn-new" });
    expect(session.cards.map((card) => card.positionKey)).toStrictEqual([
      START_KEY,
      positionKey(later),
      positionKey(deep.fenAfter)
    ]);
  });

  it("a correct first answer promotes a new card to stage 1, due in a day", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    expect(card).toMatchObject({
      stage: "new",
      state: "unanswered",
      orientation: "white",
      fen: START_FEN
    });
    const result = attempt(session.sessionId, card.queueItemId, "e2e4");
    expect(result).toMatchObject({
      outcome: "correct",
      finalGrade: true,
      acceptedUcis: ["e2e4"],
      card: { state: "answered-correct", attemptsSoFar: 1 }
    });
    expect(progressRepository.get(id, START_KEY)).toMatchObject({
      stage: 1,
      dueAt: now + DAY,
      unaidedSuccesses: 1
    });
    expect(sent.at(-1)).toMatchObject({ payload: { kind: "progress", repertoireId: id } });
    expect(attempt(session.sessionId, card.queueItemId, "e2e4").outcome).toBe("already-final");
  });

  it("a wrong first answer lapses and shows the move to play; a correct retry doesn't promote", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: service.getRepertoire(id).revision,
      patch: { wrongMoveFeedback: { d2d4: "We play 1.e4" } }
    });
    const { session, card } = learnFirst(id);
    const wrong = attempt(session.sessionId, card.queueItemId, "d2d4");
    expect(wrong).toMatchObject({
      outcome: "outside-repertoire",
      finalGrade: true,
      feedback: "We play 1.e4",
      // "Not 1.d4. Your move here is 1.e4. Play it to continue."
      acceptedUcis: ["e2e4"],
      preferredUci: "e2e4"
    });
    expect(attempt(session.sessionId, card.queueItemId, "g1f3")).toMatchObject({
      outcome: "outside-repertoire",
      finalGrade: false,
      acceptedUcis: ["e2e4"]
    });
    const retry = attempt(session.sessionId, card.queueItemId, "e2e4");
    expect(retry).toMatchObject({
      outcome: "correct",
      finalGrade: false,
      acceptedUcis: ["e2e4"],
      card: { attemptsSoFar: 3 }
    });
    expect(progressRepository.get(id, START_KEY)).toMatchObject({
      stage: 0,
      lapses: 1,
      dueAt: now + 10 * 60_000
    });
  });

  it("a hint then a correct answer is assisted: stage unchanged, due in a day", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    const hints = [1, 2, 3, 4].map(() =>
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: card.queueItemId,
        action: { kind: "hint" }
      })
    );
    expect(hints.map((hint) => hint.card.hintStage)).toStrictEqual([1, 2, 3, 3]);
    expect(hints[0].revealed).toStrictEqual({ ucis: [], preferredUci: null, explanation: null });
    expect(hints[1].revealed?.preferredUci).toBe("e2e4");
    const result = attempt(session.sessionId, card.queueItemId, "e2e4");
    expect(result.finalGrade).toBe(true);
    expect(progressRepository.get(id, START_KEY)).toMatchObject({
      stage: 0,
      dueAt: now + DAY,
      lapses: 0
    });
    const summary = service.endPractice(session.sessionId);
    expect(summary).toMatchObject({ unaided: 0, assisted: 1, missed: 0 });
  });

  it("reveal is a lapse and shows the answer", () => {
    const { id } = create();
    const saved = save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    const revealed = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: card.queueItemId,
      action: { kind: "reveal" }
    });
    expect(revealed).toMatchObject({
      card: { state: "revealed" },
      revealed: { ucis: ["e2e4"], preferredUci: "e2e4" }
    });
    expect(progressRepository.get(id, START_KEY)).toMatchObject({ stage: 0, lapses: 1 });
    expect(attempt(session.sessionId, card.queueItemId, "e2e4")).toMatchObject({
      outcome: "already-final",
      finalGrade: false,
      acceptedUcis: ["e2e4"]
    });
    expect(saved.chapter.id).toBe(card.chapterId);
  });

  it("a resumed session shows the hints and reveal its current card already gave out", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    expect(service.resumePractice(session.sessionId).shown).toBeUndefined();
    const hint = { sessionId: session.sessionId, queueItemId: card.queueItemId };
    service.recordPracticeAction({ ...hint, action: { kind: "hint" } });
    expect(service.resumePractice(session.sessionId).shown).toStrictEqual({
      hint: null,
      hintUci: null,
      revealed: null
    });
    service.recordPracticeAction({ ...hint, action: { kind: "hint" } });
    expect(service.resumePractice(session.sessionId).shown?.hintUci).toBe("e2e4");
    service.recordPracticeAction({ ...hint, action: { kind: "reveal" } });
    expect(service.resumePractice(session.sessionId).shown).toMatchObject({
      hintUci: "e2e4",
      revealed: { ucis: ["e2e4"], preferredUci: "e2e4" }
    });
  });

  it("a resumed session shows an answer revealed after a wrong move", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    attempt(session.sessionId, card.queueItemId, "d2d4");
    // The move to play to continue shows again; nothing is revealed yet.
    expect(service.resumePractice(session.sessionId).shown).toMatchObject({
      revealed: null,
      correction: { ucis: ["e2e4"], preferredUci: "e2e4" }
    });
    service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: card.queueItemId,
      action: { kind: "reveal" }
    });
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed.cards[0].state).toBe("answered-wrong");
    expect(resumed.shown?.revealed).toMatchObject({ ucis: ["e2e4"], preferredUci: "e2e4" });
  });

  it("an illegal move changes no schedule", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    const result = attempt(session.sessionId, card.queueItemId, "e2e5");
    expect(result).toMatchObject({
      outcome: "illegal",
      finalGrade: false,
      acceptedUcis: [],
      card: { state: "unanswered" }
    });
    expect(progressRepository.get(id, START_KEY)).toBeNull();
    expect(
      attemptRepository.list(session.sessionId).map((row) => [row.legal, row.isFinalGrade])
    ).toStrictEqual([[false, false]]);
    expect(attempt(session.sessionId, card.queueItemId, "e2e4").outcome).toBe("correct");
    expect(progressRepository.get(id, START_KEY)?.stage).toBe(1);
  });

  it("replaying an attempt id returns the same result without a second row", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    const first = attempt(session.sessionId, card.queueItemId, "e2e4", "same");
    now += 5000;
    const replay = attempt(session.sessionId, card.queueItemId, "e2e4", "same");
    expect(replay).toStrictEqual(first);
    expect(attemptRepository.list(session.sessionId)).toHaveLength(1);
    expect(progressRepository.get(id, START_KEY)?.unaidedSuccesses).toBe(1);
    expect(() => attempt(session.sessionId, "q9", "e2e4", "same")).toThrow(/Invalid attemptId/);
  });

  it("every accepted alternative succeeds", () => {
    for (const uci of ["e2e4", "d2d4", "c2c4"]) {
      const { id } = create();
      save(id, [["e2e4"], ["d2d4"], ["c2c4"]]);
      const { session, card } = learnFirst(id);
      expect(attempt(session.sessionId, card.queueItemId, uci).outcome).toBe("correct");
    }
  });

  it("grades promotions by the complete UCI move", () => {
    const fen = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
    const correct = create("white", fen);
    save(correct.id, [["e7e8n"]]);
    const first = learnFirst(correct.id);
    expect(attempt(first.session.sessionId, first.card.queueItemId, "e7e8n").outcome).toBe(
      "correct"
    );

    const wrong = create("white", fen);
    save(wrong.id, [["e7e8n"]]);
    const second = learnFirst(wrong.id);
    expect(attempt(second.session.sessionId, second.card.queueItemId, "e7e8q").outcome).toBe(
      "outside-repertoire"
    );
  });

  it("skips, ends with a summary, and refuses actions on a finished session", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]]);
    const session = service.startPractice({ repertoireId: id, mode: "learn-new" });
    expect(session.cards).toHaveLength(3);
    const [a, b, c] = session.cards;
    attempt(session.sessionId, a.queueItemId, "e2e4");
    attempt(session.sessionId, b.queueItemId, "d2d4");
    const skipped = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: c.queueItemId,
      action: { kind: "skip" }
    });
    expect(skipped.card.state).toBe("skipped");
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed.totals).toStrictEqual({
      total: 3,
      answered: 2,
      correct: 1,
      wrong: 1,
      revealed: 0,
      skipped: 1,
      remaining: 0
    });
    const summary = service.endPractice(session.sessionId);
    expect(summary).toMatchObject({
      unaided: 1,
      assisted: 0,
      missed: 1,
      skipped: 1,
      chapters: [a.chapterId],
      missedPositionKeys: [b.positionKey]
    });
    expect(service.endPractice(session.sessionId)).toStrictEqual(summary);
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
    expect(() => attempt(session.sessionId, a.queueItemId, "e2e4")).toThrow(/has ended/);
  });

  it("resuming after an edit drops cards whose decision changed", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const session = service.startPractice({ repertoireId: id, mode: "learn-new" });
    save(id, [["e2e4", "e7e5", "b1c3"]]);
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed.cards.map((card) => card.state)).toStrictEqual(["unanswered", "skipped"]);
    expect(service.endPractice(session.sessionId).skipped).toBe(1);
    expect(() => service.resumePractice("missing")).toThrow("Invalid sessionId: not found");
  });

  it("an edit during the session skips the card ungraded", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    save(id, [["e2e4"], ["d2d4"]]);
    const result = attempt(session.sessionId, card.queueItemId, "d2d4");
    expect(result).toMatchObject({ outcome: "stale", finalGrade: false, acceptedUcis: [] });
    expect(result.card.state).toBe("skipped");
    expect(progressRepository.get(id, START_KEY)).toBeNull();
    expect(service.endPractice(session.sessionId)).toMatchObject({ missed: 0, skipped: 1 });
  });

  it("a reveal after an edit skips the card ungraded", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    save(id, [["e2e4"], ["d2d4"]]);
    const result = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: card.queueItemId,
      action: { kind: "reveal" }
    });
    expect(result.card.state).toBe("skipped");
    expect(result.revealed?.ucis).toStrictEqual(["e2e4"]);
    expect(progressRepository.get(id, START_KEY)).toBeNull();
  });

  it("a card graded by an overlapping session is skipped in the other", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const first = learnFirst(id);
    const second = learnFirst(id);
    expect(attempt(first.session.sessionId, first.card.queueItemId, "e2e4").outcome).toBe(
      "correct"
    );
    const stage = progressRepository.get(id, START_KEY)?.stage;
    expect(attempt(second.session.sessionId, second.card.queueItemId, "e2e4").outcome).toBe(
      "stale"
    );
    expect(progressRepository.get(id, START_KEY)?.stage).toBe(stage);
  });

  it("an overlapping session stays stale when the clock moved backwards", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const learn = learnFirst(id);
    attempt(learn.session.sessionId, learn.card.queueItemId, "d2d4");
    service.endPractice(learn.session.sessionId);
    now += 60 * 60_000;
    const first = service.startPractice({ repertoireId: id, mode: "review-due" });
    const second = service.startPractice({ repertoireId: id, mode: "review-due" });
    now -= 2 * 60 * 60_000;
    expect(attempt(first.sessionId, first.cards[0].queueItemId, "e2e4").outcome).toBe("correct");
    const progress = progressRepository.get(id, START_KEY);
    expect(attempt(second.sessionId, second.cards[0].queueItemId, "e2e4").outcome).toBe("stale");
    expect(progressRepository.get(id, START_KEY)).toStrictEqual(progress);
  });

  it("archiving stops an open session from grading", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const { session, card } = learnFirst(id);
    const { revision } = service.getRepertoire(id);
    service.archiveRepertoire({ id, expectedRevision: revision, archived: true });
    expect(service.resumePractice(session.sessionId).cards[0].state).toBe("skipped");
    expect(attempt(session.sessionId, card.queueItemId, "e2e4").outcome).toBe("already-final");
    expect(progressRepository.get(id, START_KEY)).toBeNull();
  });

  it("a wrong answer keeps the card current on resume", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const { session, card } = learnFirst(id);
    attempt(session.sessionId, card.queueItemId, "d2d4");
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed.cards[resumed.cursor]).toMatchObject({
      queueItemId: card.queueItemId,
      state: "answered-wrong"
    });
    attempt(session.sessionId, card.queueItemId, "e2e4");
    const after = service.resumePractice(session.sessionId);
    expect(after.cards[after.cursor].queueItemId).not.toBe(card.queueItemId);
  });

  it("a targeted queue starts with a decision that isn't due, and grading it adds no lapse", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const first = learnFirst(id);
    attempt(first.session.sessionId, first.card.queueItemId, "e2e4");
    service.endPractice(first.session.sessionId);
    const before = progressRepository.get(id, START_KEY)!;
    expect(before).toMatchObject({ stage: 1, lapses: 0, dueAt: now + DAY });

    // Not due yet: an ordinary review queue has nothing due.
    expect(
      service.startPractice({ repertoireId: id, mode: "review-due", newCardLimit: 0 }).cards
    ).toHaveLength(0);
    now += 60_000;
    const targeted = service.startPractice({
      repertoireId: id,
      mode: "review-due",
      positionKeys: [START_KEY]
    });
    expect(targeted.status).toBe("active");
    expect(targeted.cards).toHaveLength(1);
    expect(targeted.cards[0]).toMatchObject({ positionKey: START_KEY, stage: "review" });
    expect(targeted.scope.positionKeys).toStrictEqual([START_KEY]);
    expect(service.resumePractice(targeted.sessionId).scope.positionKeys).toStrictEqual([
      START_KEY
    ]);
    expect(progressRepository.get(id, START_KEY)).toStrictEqual(before);

    const result = attempt(targeted.sessionId, targeted.cards[0].queueItemId, "e2e4");
    expect(result.outcome).toBe("correct");
    expect(progressRepository.get(id, START_KEY)!.lapses).toBe(0);
  });

  it("gives out the explanation and the accepted moves' comments only with the answer", () => {
    const { id } = create();
    // A book's page links (`[%page N]`) are not part of what practice shows.
    save(id, [["e2e4"], ["d2d4"]], {
      comments: { "": "[%page 3] Choose your centre pawn.", e2e4: "Open games.", d2d4: "  " }
    });
    service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: service.getRepertoire(id).revision,
      patch: {
        acceptedUcis: ["e2e4"],
        hint: "A king's pawn",
        wrongMoveFeedback: { d2d4: "Not 1.d4 here" }
      }
    });
    const { session, card } = learnFirst(id);
    const ids = { sessionId: session.sessionId, queueItemId: card.queueItemId };
    // A hint gives the hint only; a wrong answer that move's feedback and the move to play.
    expect(
      service.recordPracticeAction({ ...ids, action: { kind: "hint" } }).revealed
    ).toStrictEqual({
      ucis: [],
      preferredUci: null,
      explanation: "A king's pawn"
    });
    const wrong = attempt(session.sessionId, card.queueItemId, "d2d4");
    expect(wrong.feedback).toBe("Not 1.d4 here");
    expect(wrong).toMatchObject({
      acceptedUcis: ["e2e4"],
      explanation: "Choose your centre pawn."
    });
    const revealed = service.recordPracticeAction({ ...ids, action: { kind: "reveal" } });
    expect(revealed.revealed).toStrictEqual({
      ucis: ["e2e4"],
      preferredUci: "e2e4",
      explanation: "Choose your centre pawn.",
      moveComments: { e2e4: "Open games." }
    });
    expect(service.resumePractice(session.sessionId).shown?.revealed).toStrictEqual(
      revealed.revealed
    );
    expect(attempt(session.sessionId, card.queueItemId, "e2e4")).toMatchObject({
      outcome: "correct",
      acceptedUcis: ["e2e4"],
      explanation: "Choose your centre pawn.",
      moveComments: { e2e4: "Open games." }
    });
  });

  it("a correct first answer comes with the explanation, the hint standing in for none", () => {
    const { id } = create();
    save(id, [["e2e4"]], { comments: { "": "[%page 2]", e2e4: "[%page 2] Open games." } });
    service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: service.getRepertoire(id).revision,
      patch: { hint: "A king's pawn" }
    });
    const { session, card } = learnFirst(id);
    expect(attempt(session.sessionId, card.queueItemId, "e2e4")).toMatchObject({
      outcome: "correct",
      finalGrade: true,
      explanation: "A king's pawn",
      moveComments: { e2e4: "Open games." }
    });
  });

  it("retrying a session's missed decisions leaves that session's grades as they were", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const first = service.startPractice({ repertoireId: id, mode: "learn-new" });
    attempt(first.sessionId, first.cards[0].queueItemId, "d2d4");
    attempt(first.sessionId, first.cards[1].queueItemId, "g1f3");
    const summary = service.endPractice(first.sessionId);
    expect(summary).toMatchObject({ unaided: 1, missed: 1, missedPositionKeys: [START_KEY] });
    const lapsed = progressRepository.get(id, START_KEY)!;
    expect(lapsed).toMatchObject({ stage: 0, lapses: 1 });
    const firstRows = attemptRepository.list(first.sessionId);

    // "Retry missed": the targeted queue of the missed decisions, as ungraded extra practice.
    const retryMissed = () =>
      service.startPractice({
        repertoireId: id,
        mode: "review-due",
        positionKeys: summary.missedPositionKeys,
        cardLimit: 1,
        newCardLimit: 1,
        ungraded: true
      });
    now += 60_000;
    const retry = retryMissed();
    expect(retry.scope.ungraded).toBe(true);
    expect(service.resumePractice(retry.sessionId).scope.ungraded).toBe(true);
    expect(retry.cards.map((card) => card.positionKey)).toStrictEqual([START_KEY]);
    // A correct retry seconds after the miss doesn't jump the relearn step to stage 1.
    expect(attempt(retry.sessionId, retry.cards[0].queueItemId, "e2e4")).toMatchObject({
      outcome: "correct",
      finalGrade: true
    });
    expect(progressRepository.get(id, START_KEY)).toStrictEqual(lapsed);
    // Its answers are recorded with the retry session: its summary counts them.
    expect(service.endPractice(retry.sessionId)).toMatchObject({ unaided: 1, missed: 0 });

    // A wrong retry adds no second lapse, nor does a reveal.
    const again = retryMissed();
    expect(attempt(again.sessionId, again.cards[0].queueItemId, "d2d4").outcome).toBe(
      "outside-repertoire"
    );
    service.recordPracticeAction({
      sessionId: again.sessionId,
      queueItemId: again.cards[0].queueItemId,
      action: { kind: "reveal" }
    });
    const third = retryMissed();
    service.recordPracticeAction({
      sessionId: third.sessionId,
      queueItemId: third.cards[0].queueItemId,
      action: { kind: "reveal" }
    });
    expect(progressRepository.get(id, START_KEY)).toStrictEqual(lapsed);
    expect(service.endPractice(again.sessionId)).toMatchObject({
      missed: 1,
      missedPositionKeys: [START_KEY]
    });

    // The first session's answers and summary are unchanged.
    expect(attemptRepository.list(first.sessionId)).toStrictEqual(firstRows);
    expect(service.endPractice(first.sessionId)).toStrictEqual(summary);
  });

  it("a paused decision leaves practice and due counts, and resuming keeps its progress", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const first = learnFirst(id);
    attempt(first.session.sessionId, first.card.queueItemId, "e2e4");
    const learned = progressRepository.get(id, START_KEY)!;
    expect(learned).toMatchObject({ stage: 1, unaidedSuccesses: 1 });
    now += 2 * DAY;
    expect(service.getRepertoire(id).dueCount).toBe(1);
    // A card dealt before the pause is skipped ungraded once the decision is paused.
    const dealt = service.startPractice({ repertoireId: id, mode: "review-due" });
    expect(dealt.cards[0].positionKey).toBe(START_KEY);

    const paused = service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: service.getRepertoire(id).revision,
      patch: { paused: true }
    });
    expect(paused.decision.paused).toBe(true);
    expect(paused.repertoire).toMatchObject({ dueCount: 0, decisionCount: 1 });
    expect(service.getDueSummary().dueCount).toBe(0);
    expect(attempt(dealt.sessionId, dealt.cards[0].queueItemId, "e2e4").outcome).toBe("stale");
    for (const mode of ["review-due", "learn-new"] as const) {
      const session = service.startPractice({ repertoireId: id, mode });
      expect(session.cards.map((card) => card.positionKey)).not.toContain(START_KEY);
    }
    expect(progressRepository.get(id, START_KEY)).toStrictEqual(learned);

    const resumed = service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: paused.repertoire.revision,
      patch: { paused: false }
    });
    expect(resumed.decision.paused).toBe(false);
    // Its first scored attempt and schedule are as they were: still a due review, not a new card.
    expect(progressRepository.get(id, START_KEY)).toStrictEqual(learned);
    expect(resumed.repertoire).toMatchObject({ dueCount: 1, decisionCount: 2 });
    const review = service.startPractice({ repertoireId: id, mode: "review-due" });
    expect(review.cards.map((card) => [card.positionKey === START_KEY, card.stage])).toStrictEqual([
      [true, "review"],
      [false, "new"]
    ]);
  });

  it("wrong-move feedback names legal moves and is replaced as a whole", () => {
    const { id } = create();
    save(id, [["e2e4"]]);
    const write = (wrongMoveFeedback: Record<string, string>) =>
      service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: service.getRepertoire(id).revision,
        patch: { wrongMoveFeedback }
      }).decision.wrongMoveFeedback;
    expect(() => write({ e2e5: "Not a move" })).toThrow(
      /Invalid wrongMoveFeedback: "e2e5" is not a legal move/
    );
    expect(write({ d2d4: " We play 1.e4 ", c2c4: "Not the English" })).toStrictEqual({
      d2d4: "We play 1.e4",
      c2c4: "Not the English"
    });
    // Left out or blank: removed.
    expect(write({ d2d4: "We play 1.e4", c2c4: "   " })).toStrictEqual({ d2d4: "We play 1.e4" });
    expect(write({})).toStrictEqual({});
  });

  it("wrong-move feedback never names an accepted move", () => {
    const { id } = create();
    save(id, [["e2e4"], ["d2d4"]]);
    const update = (patch: UpdateDecisionInput["patch"]) =>
      service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: service.getRepertoire(id).revision,
        patch
      }).decision;
    update({ acceptedUcis: ["e2e4"] });
    expect(() => update({ wrongMoveFeedback: { e2e4: "Not this one" } })).toThrow(
      /Invalid wrongMoveFeedback: "e2e4" is an accepted move/
    );
    // Feedback written while 1.d4 was outside the repertoire, then 1.d4 accepted: sent back
    // unchanged with the rest of the map it is dropped; new text for it is refused.
    update({ wrongMoveFeedback: { d2d4: "We play 1.e4" } });
    expect(update({ acceptedUcis: ["e2e4", "d2d4"] }).wrongMoveFeedback).toStrictEqual({
      d2d4: "We play 1.e4"
    });
    expect(() => update({ wrongMoveFeedback: { d2d4: "Changed" } })).toThrow(
      /"d2d4" is an accepted move/
    );
    expect(
      update({ wrongMoveFeedback: { d2d4: "We play 1.e4", c2c4: "Not the English" } })
        .wrongMoveFeedback
    ).toStrictEqual({ c2c4: "Not the English" });
  });

  it("a targeted queue keeps the given order and drops unknown or paused decisions", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]]);
    const afterE5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "e2e4")!, "e7e5")!);
    const afterNc6 = positionKey(
      ["e2e4", "e7e5", "g1f3", "b8c6"].reduce((fen, uci) => fenAfterUci(fen, uci)!, START_FEN)
    );
    const { revision } = service.getRepertoire(id);
    service.updateDecision({
      repertoireId: id,
      positionKey: afterNc6,
      expectedRevision: revision,
      patch: { paused: true }
    });
    const session = service.startPractice({
      repertoireId: id,
      mode: "review-due",
      positionKeys: [afterE5, "v1:unknown", afterNc6, START_KEY, afterE5]
    });
    expect(session.cards.map((card) => [card.positionKey, card.stage])).toStrictEqual([
      [afterE5, "new"],
      [START_KEY, "new"]
    ]);
  });
});
