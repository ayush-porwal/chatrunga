import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { nodeAt, serviceHelpers } from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { progressRepository } = await import("./repository");
const { attemptRepository } = await import("./practice-repository");
const { create, save, attempt } = serviceHelpers(service);
const { userData, sent } = env;

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

describe("repertoire service: rehearse lines", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    service.resetImportJobs();
    sent.length = 0;
    now = 1_000_000_000_000;
  });

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  // Line A: 1.e4 c5 2.Nf3 d6 3.d4 · B: 1.e4 c5 2.Nf3 Nc6 3.d4 · C: 1.e4 e5 2.Nf3 · D: 1.d4.
  const LINES = [
    ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4"],
    ["e2e4", "c7c5", "g1f3", "b8c6", "d2d4"],
    ["e2e4", "e7e5", "g1f3"],
    ["d2d4"]
  ];

  function setup(lines: string[][] = LINES) {
    const { id } = create();
    const { chapter } = save(id, lines);
    return { id, chapter };
  }

  function rehearse(repertoireId: string, chapterId: string, extra: object = {}) {
    return service.startPractice({
      repertoireId,
      mode: "rehearse-lines",
      rehearse: { chapterId },
      ...extra
    });
  }

  function current(sessionId: string) {
    const snapshot = service.resumePractice(sessionId);
    return snapshot.cards[snapshot.cursor];
  }

  it("validates the chapter and start node", () => {
    const { id, chapter } = setup();
    expect(() => service.startPractice({ repertoireId: id, mode: "rehearse-lines" })).toThrow(
      "Invalid rehearse: chapterId is required for rehearse-lines"
    );
    expect(() => rehearse(id, "missing")).toThrow("Invalid rehearse.chapterId: not found");
    expect(() =>
      service.startPractice({
        repertoireId: id,
        mode: "rehearse-lines",
        rehearse: { chapterId: chapter.id, fromNodeId: "nope" }
      })
    ).toThrow("Invalid rehearse.fromNodeId: not in this chapter");
    const reference = save(id, [["e2e4", "e7e5"]], { chapterId: "ref", kind: "reference" });
    expect(() => rehearse(id, reference.chapter.id)).toThrow(
      "Invalid rehearse: this chapter has nothing to rehearse"
    );
    const other = create("black");
    expect(() => rehearse(other.id, chapter.id)).toThrow("Invalid rehearse.chapterId: not found");
    // A valid node with nothing after it: an empty, finished session.
    const leaf = service.startPractice({
      repertoireId: id,
      mode: "rehearse-lines",
      rehearse: { chapterId: chapter.id, fromNodeId: nodeAt(chapter.tree, ["d2d4"]).id }
    });
    expect(leaf).toMatchObject({ status: "finished", cards: [], totals: { total: 0 } });
    expect(service.endPractice(leaf.sessionId)).toMatchObject({
      chapters: [chapter.id],
      rehearsal: { linesStarted: 0, linesCompleted: 0, otherLineAnswers: 0 }
    });
  });

  it("plays a paused decision's move as context and never asks it", () => {
    const line = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"];
    const { id, chapter } = setup([line]);
    const keyAfter = (plies: number) =>
      positionKey(line.slice(0, plies).reduce((fen, uci) => fenAfterUci(fen, uci)!, START_FEN));
    const pause = (key: string) =>
      service.updateDecision({
        repertoireId: id,
        positionKey: key,
        expectedRevision: service.getRepertoire(id).revision,
        patch: { paused: true }
      });
    // 2. Nf3 is paused: after 1. e4 e5 the line goes on with Nf3 Nc6 to 3. Bc4's decision.
    pause(keyAfter(2));
    const session = rehearse(id, chapter.id);
    expect(session.cards[0]).toMatchObject({ nodeId: "root", rehearsal: { stepIndex: 0 } });
    const first = attempt(session.sessionId, "q1", "e2e4");
    expect(first.rehearsal).toMatchObject({
      reply: { uci: "e7e5" },
      lineComplete: false,
      next: {
        positionKey: keyAfter(4),
        leadUp: line.slice(0, 4).map((uci) => expect.objectContaining({ uci })),
        rehearsal: { stepIndex: 1 }
      }
    });
    expect(attempt(session.sessionId, "q2", "f1c4").rehearsal).toMatchObject({
      lineComplete: true
    });
    expect(service.endPractice(session.sessionId)).toMatchObject({
      unaided: 2,
      rehearsal: { linesStarted: 1, linesCompleted: 1 }
    });

    // The first decision paused too: the line starts at 3. Bc4's, its lead-up played.
    pause(START_KEY);
    const later = rehearse(id, chapter.id);
    expect(later.cards).toHaveLength(1);
    expect(later.cards[0]).toMatchObject({ positionKey: keyAfter(4), rehearsal: { stepIndex: 0 } });

    // Every decision paused: nothing to rehearse.
    pause(keyAfter(4));
    expect(rehearse(id, chapter.id)).toMatchObject({ status: "finished", cards: [] });
  });

  it("plays lines with authored replies, rotating to unseen branches, and never writes progress", () => {
    const { id, chapter } = setup();
    const tree = chapter.tree;
    const session = rehearse(id, chapter.id);
    const lineA = `line-${nodeAt(tree, LINES[0]).id}`;
    expect(session).toMatchObject({ status: "active", cursor: 0, mode: "rehearse-lines" });
    expect(session.scope.rehearse).toStrictEqual({ chapterId: chapter.id });
    expect(session.cards).toHaveLength(1);
    expect(session.cards[0]).toMatchObject({
      queueItemId: "q1",
      nodeId: "root",
      stage: "new",
      leadUp: [],
      rehearsal: { lineId: lineA, stepIndex: 0 }
    });

    const first = attempt(session.sessionId, "q1", "e2e4");
    expect(first).toMatchObject({
      outcome: "correct",
      finalGrade: true,
      card: { state: "answered-correct" },
      rehearsal: {
        reply: { uci: "c7c5" },
        lineComplete: false,
        endReason: null,
        next: {
          queueItemId: "q2",
          nodeId: nodeAt(tree, ["e2e4", "c7c5"]).id,
          rehearsal: { lineId: lineA, stepIndex: 1 }
        }
      }
    });
    expect(first.rehearsal!.next!.leadUp.map((move) => move.uci)).toStrictEqual(["e2e4", "c7c5"]);
    expect(attempt(session.sessionId, "q2", "g1f3").rehearsal).toMatchObject({
      reply: { uci: "d7d6" },
      next: { queueItemId: "q3" }
    });
    // The line ends on the player's move; the next line starts at the root again.
    const endA = attempt(session.sessionId, "q3", "d2d4");
    expect(endA.rehearsal).toMatchObject({
      reply: null,
      lineComplete: true,
      endReason: "leaf",
      next: { queueItemId: "q4", nodeId: "root" }
    });

    // Second run through 1.e4: the unseen 1...e5 comes before the other 1...c5 line.
    expect(attempt(session.sessionId, "q4", "e2e4").rehearsal).toMatchObject({
      reply: { uci: "e7e5" },
      next: { queueItemId: "q5" }
    });
    expect(attempt(session.sessionId, "q5", "g1f3").rehearsal).toMatchObject({
      reply: null,
      lineComplete: true,
      next: { queueItemId: "q6", rehearsal: { lineId: `line-${nodeAt(tree, LINES[1]).id}` } }
    });
    expect(attempt(session.sessionId, "q6", "e2e4").rehearsal!.reply!.uci).toBe("c7c5");
    expect(attempt(session.sessionId, "q7", "g1f3").rehearsal!.reply!.uci).toBe("b8c6");
    expect(attempt(session.sessionId, "q8", "d2d4").rehearsal).toMatchObject({
      lineComplete: true,
      next: { queueItemId: "q9", rehearsal: { lineId: `line-${nodeAt(tree, ["d2d4"]).id}` } }
    });
    const last = attempt(session.sessionId, "q9", "d2d4");
    expect(last.rehearsal).toStrictEqual({
      reply: null,
      next: null,
      lineComplete: true,
      endReason: "leaf"
    });
    const finished = service.resumePractice(session.sessionId);
    expect(finished).toMatchObject({ status: "finished", totals: { total: 9, correct: 9 } });
    expect(progressRepository.list(id)).toStrictEqual([]);
    expect(sent.some((event) => (event.payload as { kind?: string }).kind === "progress")).toBe(
      false
    );
    expect(service.endPractice(session.sessionId)).toMatchObject({
      unaided: 9,
      assisted: 0,
      missed: 0,
      skipped: 0,
      chapters: [chapter.id],
      rehearsal: { linesStarted: 4, linesCompleted: 4, otherLineAnswers: 0 }
    });
  });

  it("an accepted choice of a sibling line is not a miss, and can be followed", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    const d4 = nodeAt(chapter.tree, ["d2d4"]);
    const other = attempt(session.sessionId, "q1", "d2d4");
    expect(other).toMatchObject({
      outcome: "other-line",
      finalGrade: false,
      otherLine: { chapterId: chapter.id, chapterTitle: "Chapter", nodeId: d4.id, path: "1. d4" },
      card: { state: "unanswered", attemptsSoFar: 1 },
      acceptedUcis: []
    });
    expect(service.resumePractice(session.sessionId).cursor).toBe(0);

    const followed = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q1",
      action: { kind: "follow-other-line" }
    });
    // 1.d4 is a leaf: the followed line completes at once and the next line starts.
    expect(followed).toMatchObject({
      card: { state: "answered-correct" },
      rehearsal: { reply: null, lineComplete: true, endReason: "leaf", next: { queueItemId: "q2" } }
    });
    expect(() =>
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q2",
        action: { kind: "follow-other-line" }
      })
    ).toThrow("Invalid action: follow-other-line needs an answer from another line first");
    // A correct answer after an other-line one is still unaided.
    expect(attempt(session.sessionId, "q2", "d2d4")).toMatchObject({ outcome: "other-line" });
    expect(attempt(session.sessionId, "q2", "e2e4")).toMatchObject({
      outcome: "correct",
      finalGrade: true
    });
    // The followed card counts as unaided, in the live totals and the summary alike; following
    // started a line of its own.
    expect(service.resumePractice(session.sessionId).totals.correct).toBe(2);
    expect(service.endPractice(session.sessionId)).toMatchObject({
      unaided: 2,
      missed: 0,
      rehearsal: { linesStarted: 3, linesCompleted: 1, otherLineAnswers: 2 }
    });
    expect(progressRepository.list(id)).toStrictEqual([]);
  });

  it("refuses to follow a line from another chapter", () => {
    const { id } = create();
    const first = save(id, [["e2e4", "e7e5"]]);
    save(id, [["d2d4", "d7d5"]], { chapterId: "second" });
    const session = rehearse(id, first.chapter.id);
    expect(attempt(session.sessionId, "q1", "d2d4")).toMatchObject({
      outcome: "other-line",
      otherLine: { chapterId: "second" }
    });
    expect(() =>
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q1",
        action: { kind: "follow-other-line" }
      })
    ).toThrow("Invalid action: that line is in another chapter; rehearse it from there");
    const learn = service.startPractice({ repertoireId: id, mode: "learn-new" });
    expect(() =>
      service.recordPracticeAction({
        sessionId: learn.sessionId,
        queueItemId: learn.cards[0].queueItemId,
        action: { kind: "follow-other-line" }
      })
    ).toThrow("Invalid action: follow-other-line is only for rehearse-lines");
  });

  it("a move outside the repertoire keeps the card for a retry; hints make it assisted", () => {
    const { id, chapter } = setup();
    service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: service.getRepertoire(id).revision,
      patch: { wrongMoveFeedback: { g1f3: "Not today" } }
    });
    const session = rehearse(id, chapter.id);
    expect(attempt(session.sessionId, "q1", "e2e5").outcome).toBe("illegal");
    const wrong = attempt(session.sessionId, "q1", "g1f3");
    expect(wrong).toMatchObject({
      outcome: "outside-repertoire",
      finalGrade: true,
      feedback: "Not today",
      card: { state: "answered-wrong" },
      acceptedUcis: []
    });
    expect(wrong.rehearsal).toBeUndefined();
    expect(service.resumePractice(session.sessionId).cursor).toBe(0);
    const retry = attempt(session.sessionId, "q1", "e2e4");
    expect(retry).toMatchObject({
      outcome: "correct",
      finalGrade: false,
      card: { state: "answered-wrong" },
      rehearsal: { reply: { uci: "c7c5" }, next: { queueItemId: "q2" } }
    });
    expect(attempt(session.sessionId, "q1", "e2e4").outcome).toBe("already-final");

    const hint = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q2",
      action: { kind: "hint" }
    });
    expect(hint.card.hintStage).toBe(1);
    service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q2",
      action: { kind: "hint" }
    });
    expect(
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q2",
        action: { kind: "hint" }
      }).revealed
    ).toMatchObject({ preferredUci: "g1f3" });
    expect(attempt(session.sessionId, "q2", "g1f3")).toMatchObject({
      outcome: "correct",
      finalGrade: true
    });
    expect(progressRepository.list(id)).toStrictEqual([]);
    expect(service.endPractice(session.sessionId)).toMatchObject({
      unaided: 0,
      assisted: 1,
      missed: 1,
      missedPositionKeys: [START_KEY]
    });
  });

  it("reveal misses the card and continues the line", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    const result = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q1",
      action: { kind: "reveal" }
    });
    expect(result).toMatchObject({
      card: { state: "revealed" },
      revealed: { ucis: ["e2e4"], preferredUci: "e2e4" },
      rehearsal: { reply: { uci: "c7c5" }, lineComplete: false, next: { queueItemId: "q2" } }
    });
    expect(current(session.sessionId).queueItemId).toBe("q2");
    // A retry after a lost response gets the card back instead of an error.
    expect(
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q1",
        action: { kind: "reveal" }
      })
    ).toStrictEqual({
      card: expect.objectContaining({ queueItemId: "q1", state: "revealed" }),
      revealed: { ucis: ["e2e4"], preferredUci: "e2e4", explanation: null }
    });
    expect(
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q1",
        action: { kind: "skip" }
      })
    ).toStrictEqual({ card: expect.objectContaining({ queueItemId: "q1", state: "revealed" }) });
    expect(current(session.sessionId).queueItemId).toBe("q2");
    expect(progressRepository.list(id)).toStrictEqual([]);
    expect(service.endPractice(session.sessionId)).toMatchObject({ missed: 1, unaided: 0 });
  });

  it("skip ends the current line and starts the next one", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    const skipped = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q2",
      action: { kind: "skip" }
    });
    expect(skipped).toMatchObject({
      card: { state: "skipped" },
      rehearsal: { reply: null, lineComplete: false, next: { queueItemId: "q3", nodeId: "root" } }
    });
    // Line A is done (not completed): the next run goes through the unseen 1...e5.
    expect(attempt(session.sessionId, "q3", "e2e4").rehearsal!.reply!.uci).toBe("e7e5");
    expect(() =>
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q1",
        action: { kind: "hint" }
      })
    ).toThrow("Invalid queueItemId: not the current card of this rehearsal");
    expect(service.endPractice(session.sessionId)).toMatchObject({
      skipped: 1,
      rehearsal: { linesStarted: 2, linesCompleted: 0 }
    });
  });

  it("starts from an opponent-to-move node with its reply in the lead-up, and ends at the depth limit", () => {
    const { id, chapter } = setup();
    const e4 = nodeAt(chapter.tree, ["e2e4"]);
    const session = service.startPractice({
      repertoireId: id,
      mode: "rehearse-lines",
      rehearse: { chapterId: chapter.id, fromNodeId: e4.id }
    });
    expect(session.cards[0].leadUp.map((move) => move.uci)).toStrictEqual(["e2e4", "c7c5"]);
    expect(session.scope.rehearse).toStrictEqual({ chapterId: chapter.id, fromNodeId: e4.id });

    const shallow = rehearse(id, chapter.id, { maxDepthPlies: 1 });
    expect(attempt(shallow.sessionId, "q1", "e2e4").rehearsal).toMatchObject({
      reply: null,
      lineComplete: true,
      endReason: "depth",
      next: { queueItemId: "q2" }
    });
  });

  it("rehearses a chapter with a start marker from its start: the lead-up is played, not tested", () => {
    const { id } = create();
    const { chapter } = save(id, [...LINES, ["c2c4", "e7e5"]], {
      meta: (tree) => ({
        [nodeAt(tree, ["e2e4", "c7c5"]).id]: { edge: "included", trainingStart: true }
      })
    });
    const tree = chapter.tree;
    const session = rehearse(id, chapter.id);
    expect(session.cards[0]).toMatchObject({
      queueItemId: "q1",
      nodeId: nodeAt(tree, ["e2e4", "c7c5"]).id,
      rehearsal: { stepIndex: 0, lineNumber: 1 }
    });
    expect(session.cards[0].leadUp.map((move) => move.uci)).toStrictEqual(["e2e4", "c7c5"]);
    expect(attempt(session.sessionId, "q1", "g1f3").rehearsal).toMatchObject({
      reply: { uci: "d7d6" },
      next: { queueItemId: "q2" }
    });
    expect(attempt(session.sessionId, "q2", "d2d4").rehearsal).toMatchObject({
      lineComplete: true,
      next: {
        queueItemId: "q3",
        nodeId: nodeAt(tree, ["e2e4", "c7c5"]).id,
        rehearsal: { stepIndex: 0, lineNumber: 2 }
      }
    });
    attempt(session.sessionId, "q3", "g1f3");
    expect(attempt(session.sessionId, "q4", "d2d4").rehearsal).toMatchObject({
      lineComplete: true,
      next: null
    });
    expect(service.endPractice(session.sessionId)).toMatchObject({
      unaided: 4,
      rehearsal: { linesStarted: 2, linesCompleted: 2 }
    });
  });

  it("following into a line already played this session doesn't count it twice, and keeps its number", () => {
    const { id, chapter } = setup([["e2e4", "e7e5", "g1f3"], ["d2d4"]]);
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    expect(attempt(session.sessionId, "q2", "g1f3").rehearsal).toMatchObject({
      lineComplete: true,
      next: { queueItemId: "q3", rehearsal: { lineNumber: 2 } }
    });
    expect(attempt(session.sessionId, "q3", "e2e4").outcome).toBe("other-line");
    // 1.e4 only leads to the finished line: it is replayed (nothing else is below) as line 1.
    expect(
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q3",
        action: { kind: "follow-other-line" }
      }).rehearsal
    ).toMatchObject({
      reply: { uci: "e7e5" },
      next: { queueItemId: "q4", rehearsal: { lineNumber: 1 } }
    });
    expect(attempt(session.sessionId, "q4", "g1f3").rehearsal).toMatchObject({
      lineComplete: true,
      next: { queueItemId: "q5", nodeId: "root", rehearsal: { lineNumber: 2 } }
    });
    attempt(session.sessionId, "q5", "d2d4");
    expect(service.endPractice(session.sessionId)).toMatchObject({
      rehearsal: { linesStarted: 4, linesCompleted: 2 }
    });
  });

  it("an other-line answer points at an occurrence inside the rehearsed branch first", () => {
    // 1.d4 d5 2.Nf3 Nf6, 1.d4 Nf6 2.Nf3 d5 and 1.Nf3 d5 2.d4 Nf6 are the same position.
    const { id, chapter } = setup([
      ["g1f3", "d7d5", "d2d4", "g8f6", "c1f4"],
      ["d2d4", "d7d5", "g1f3", "g8f6", "c2c4"],
      ["d2d4", "g8f6", "g1f3", "d7d5", "c1f4"]
    ]);
    const d4 = nodeAt(chapter.tree, ["d2d4"]);
    const session = service.startPractice({
      repertoireId: id,
      mode: "rehearse-lines",
      rehearse: { chapterId: chapter.id, fromNodeId: d4.id }
    });
    expect(attempt(session.sessionId, "q1", "g1f3").rehearsal).toMatchObject({
      reply: { uci: "g8f6" },
      next: { queueItemId: "q2" }
    });
    expect(attempt(session.sessionId, "q2", "c1f4")).toMatchObject({
      outcome: "other-line",
      otherLine: {
        chapterId: chapter.id,
        nodeId: nodeAt(chapter.tree, ["d2d4", "g8f6", "g1f3", "d7d5", "c1f4"]).id,
        path: "1. d4 Nf6 2. Nf3 d5 3. Bf4"
      }
    });
  });

  it("ends the line at a stop marker after the authored reply", () => {
    const { id } = create();
    const { chapter } = save(id, [["e2e4", "c7c5", "g1f3"]], {
      meta: (tree) => ({
        [nodeAt(tree, ["e2e4", "c7c5"]).id]: { edge: "covered", trainingStop: true }
      })
    });
    const session = rehearse(id, chapter.id);
    expect(attempt(session.sessionId, "q1", "e2e4").rehearsal).toStrictEqual({
      reply: expect.objectContaining({ uci: "c7c5" }),
      next: null,
      lineComplete: true,
      endReason: "stop"
    });
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
  });

  it("resumes at the same step after a restart, and replays an attempt id", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    const first = attempt(session.sessionId, "q1", "e2e4", "same-id");
    expect(attempt(session.sessionId, "q1", "e2e4", "same-id")).toStrictEqual(first);
    expect(service.resumePractice(session.sessionId).cards).toHaveLength(2);

    closeDb();
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed).toMatchObject({ status: "active", cursor: 1 });
    expect(resumed.cards[1]).toMatchObject({ queueItemId: "q2", rehearsal: { stepIndex: 1 } });
    expect(attempt(session.sessionId, "q2", "g1f3").rehearsal!.reply!.uci).toBe("d7d6");
    expect(attemptRepository.list(session.sessionId)).toHaveLength(2);
  });

  it("finishes the session when its chapter changes", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    save(id, [...LINES, ["c2c4"]]);
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed.status).toBe("finished");
    expect(resumed.cards.map((card) => card.state)).toStrictEqual(["answered-correct", "skipped"]);
    expect(() => attempt(session.sessionId, "q2", "g1f3")).toThrow(
      "Invalid sessionId: this practice session has ended"
    );
  });

  it("a hint after the chapter changed ends the session instead of hinting the old card", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    save(id, [...LINES, ["c2c4"]]);
    const result = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q2",
      action: { kind: "hint" }
    });
    expect(result).toStrictEqual({
      card: expect.objectContaining({ state: "skipped", hintStage: 0 }),
      sessionEnded: true
    });
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
  });

  it("a hint on a card being retried after the chapter changed also ends the session", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    attempt(session.sessionId, "q2", "h2h3");
    save(id, [...LINES, ["c2c4"]]);
    const result = service.recordPracticeAction({
      sessionId: session.sessionId,
      queueItemId: "q2",
      action: { kind: "hint" }
    });
    expect(result).toStrictEqual({
      card: expect.objectContaining({ state: "answered-wrong", hintStage: 0 }),
      sessionEnded: true
    });
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
  });

  it("an attempt after the chapter changed ends the session", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    save(id, [...LINES, ["c2c4"]]);
    expect(attempt(session.sessionId, "q2", "g1f3")).toMatchObject({
      outcome: "stale",
      card: { state: "skipped" },
      sessionEnded: true
    });
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
  });

  it("an attempt on a card being retried after the chapter changed also ends the session", () => {
    const { id, chapter } = setup();
    const session = rehearse(id, chapter.id);
    attempt(session.sessionId, "q1", "e2e4");
    attempt(session.sessionId, "q2", "h2h3");
    save(id, [...LINES, ["c2c4"]]);
    const result = attempt(session.sessionId, "q2", "g1f3", "retry-id");
    expect(result).toMatchObject({
      outcome: "stale",
      card: { state: "answered-wrong" },
      acceptedUcis: [],
      sessionEnded: true
    });
    // A replay of the same attempt id returns the same ended result.
    expect(attempt(session.sessionId, "q2", "g1f3", "retry-id")).toStrictEqual(result);
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
  });
});
