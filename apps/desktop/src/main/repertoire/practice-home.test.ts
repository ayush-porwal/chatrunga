import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  GRADING_SETTINGS,
  serviceHelpers,
  setPracticeSettings
} from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);
// Weak-spots practice reads the Insights data (its own tests cover it): set per test here.
const weakSpots = vi.hoisted(() => ({
  positions: [] as { repertoireId: string; positionKey: string; games: number }[],
  replies: new Map<string, { uci: string; games: number }[]>()
}));
vi.mock("../repertoire-insights/weak-spots", () => ({
  weakSpotPositions: (options: { repertoireId?: string; positionKey?: string }) =>
    weakSpots.positions.filter(
      (spot) =>
        (!options.repertoireId || spot.repertoireId === options.repertoireId) &&
        (!options.positionKey || spot.positionKey === options.positionKey)
    ),
  replyFrequencies: () => weakSpots.replies
}));

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { chapterRepository, progressRepository } = await import("./repository");
const { chaptersWithoutOpening } = await import("./chapter-openings");
const { create, save, learnFirst, attempt } = serviceHelpers(service);
const { userData, sent } = env;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Midday local time, so a few hours on stay the same local day.
const NOON = new Date(2026, 9, 29, 12).getTime();
let now = NOON;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

/** Answers every card of a session with the move given for its position. */
function answerAll(sessionId: string, moves: Record<string, string>) {
  const session = service.resumePractice(sessionId);
  for (const card of session.cards) attempt(sessionId, card.queueItemId, moves[card.positionKey]);
}

describe("repertoire service: practice home", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    getDb().exec("DELETE FROM repertoire_new_introductions");
    setPracticeSettings(getDb(), GRADING_SETTINGS);
    sent.length = 0;
    now = NOON;
  });

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  describe("first sight", () => {
    it("shows a new position's move; playing it schedules learning in 10 minutes, no success", () => {
      setPracticeSettings(getDb(), { ...GRADING_SETTINGS, showMoveOnNew: true });
      const { id } = create();
      save(id, [["e2e4"]]);
      const { session, card } = learnFirst(id);
      expect(card.preview).toStrictEqual({ uci: "e2e4" });
      // Another move changes nothing: the card waits for the one shown.
      expect(attempt(session.sessionId, card.queueItemId, "d2d4")).toMatchObject({
        outcome: "outside-repertoire",
        finalGrade: false,
        card: { state: "unanswered" }
      });
      expect(progressRepository.get(id, START_KEY)).toBeNull();
      expect(attempt(session.sessionId, card.queueItemId, "e2e4")).toMatchObject({
        outcome: "correct",
        finalGrade: true,
        card: { state: "answered-correct" }
      });
      expect(progressRepository.get(id, START_KEY)).toMatchObject({
        stage: 0,
        lapses: 0,
        unaidedSuccesses: 0,
        dueAt: now + 10 * MINUTE
      });
      expect(service.endPractice(session.sessionId)).toMatchObject({
        seen: 1,
        unaided: 0,
        missed: 0
      });
    });

    it("never previews a card that was practised before, nor an ungraded retry", () => {
      setPracticeSettings(getDb(), { ...GRADING_SETTINGS, showMoveOnNew: true });
      const { id } = create();
      save(id, [["e2e4"]]);
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      now += 20 * MINUTE;
      const review = service.startPractice({ repertoireId: id, mode: "review-due" });
      expect(review.cards).toHaveLength(1);
      expect(review.cards[0]).not.toHaveProperty("preview");
    });
  });

  describe("daily new limit", () => {
    it("queues new positions only up to today's limit, across repertoires, and again tomorrow", () => {
      setPracticeSettings(getDb(), { ...GRADING_SETTINGS, newPerDay: 5 });
      const white = create();
      save(white.id, [["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1"]]);
      const blackLine = ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4"];
      const black = create("black");
      save(black.id, [blackLine]);
      const first = service.startPractice({ repertoireId: white.id, mode: "learn-new" });
      expect(first.cards).toHaveLength(5);
      // Three answered for the first time today, the shallowest first.
      ["e2e4", "g1f3", "f1b5"].forEach((uci, index) =>
        attempt(first.sessionId, first.cards[index].queueItemId, uci)
      );
      service.endPractice(first.sessionId);
      expect(service.practiceOverview()).toMatchObject({ newToday: 3, newPerDay: 5 });
      expect(
        service.startPractice({ repertoireId: black.id, mode: "learn-new" }).cards
      ).toHaveLength(2);
      // Review adds new cards after due ones within the limit too.
      expect(
        service
          .startPractice({ repertoireId: white.id, mode: "review-due" })
          .cards.filter((card) => card.stage === "new")
      ).toHaveLength(2);
      // A targeted queue isn't limited.
      const fens = [START_FEN];
      for (const uci of blackLine) fens.push(fenAfterUci(fens.at(-1)!, uci)!);
      const blackKeys = [fens[1], fens[3], fens[5]].map(positionKey);
      expect(
        service.startPractice({
          repertoireId: black.id,
          mode: "learn-new",
          positionKeys: blackKeys
        }).cards
      ).toHaveLength(3);
      now += DAY;
      expect(service.practiceOverview().newToday).toBe(0);
    });

    it("counts a position once a day, however often it is answered", () => {
      setPracticeSettings(getDb(), { ...GRADING_SETTINGS, newPerDay: 10 });
      const { id } = create();
      save(id, [["e2e4"]]);
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "d2d4");
      attempt(session.sessionId, card.queueItemId, "e2e4");
      now += 15 * MINUTE;
      const again = service.startPractice({ repertoireId: id, mode: "review-due" });
      attempt(again.sessionId, again.cards[0].queueItemId, "e2e4");
      expect(service.practiceOverview().newToday).toBe(1);
    });

    it("introduces nothing without a limit", () => {
      const { id } = create();
      save(id, [["e2e4", "e7e5", "g1f3"]]);
      expect(service.startPractice({ repertoireId: id, mode: "learn-new" }).cards).toHaveLength(2);
    });

    it("adds at most 10 new positions to a review, even without a daily limit", () => {
      const { id } = create();
      // Twelve White decisions.
      save(id, [
        "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c6a5 b3c2 c7c5 d2d4 d8c7 b1d2 c5d4".split(
          " "
        )
      ]);
      const review = service.startPractice({ repertoireId: id, mode: "review-due" });
      expect(review.cards.filter((card) => card.stage === "new")).toHaveLength(10);
    });
  });

  describe("practice early", () => {
    it("asks learning positions not due yet, soonest first, and schedules answers as usual", () => {
      const { id } = create();
      save(id, [["e2e4", "e7e5", "g1f3"]]);
      const { session } = learnFirst(id);
      const [first, second] = session.cards;
      attempt(session.sessionId, first.queueItemId, "e2e4");
      attempt(session.sessionId, second.queueItemId, "d2d4");
      // e4 is learning (due in a day), …Nf3 missed (due in 10 minutes): neither is due yet.
      expect(
        service.startPractice({ repertoireId: id, mode: "review-due", newCardLimit: 0 }).cards
      ).toHaveLength(0);
      const early = service.startPractice({ repertoireId: id, mode: "practice-early" });
      expect(early.cards.map((card) => card.positionKey)).toStrictEqual([
        second.positionKey,
        first.positionKey
      ]);
      attempt(early.sessionId, early.cards[1].queueItemId, "e2e4");
      expect(progressRepository.get(id, START_KEY)).toMatchObject({ stage: 2 });
    });

    it("leaves mastered positions out", () => {
      const { id } = create();
      save(id, [["e2e4"]]);
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      const stored = progressRepository.get(id, START_KEY)!;
      progressRepository.upsert({ ...stored, stage: 5, dueAt: now + 30 * DAY });
      expect(
        service.startPractice({ repertoireId: id, mode: "practice-early" }).cards
      ).toHaveLength(0);
    });
  });

  describe("sets", () => {
    it("queues several repertoires together, each card naming its own, and grades each in its own", () => {
      const white = create();
      save(white.id, [["e2e4"]]);
      const black = create("black");
      save(black.id, [["e2e4", "c7c5"]]);
      const archived = create("black");
      save(archived.id, [["d2d4", "d7d5"]]);
      service.archiveRepertoire({
        id: archived.id,
        archived: true,
        expectedRevision: service.getRepertoire(archived.id).revision
      });
      const session = service.startPractice({
        repertoireId: white.id,
        mode: "learn-new",
        repertoireIds: [white.id, black.id, archived.id]
      });
      expect(session.scope.repertoireIds).toStrictEqual([white.id, black.id, archived.id]);
      expect(
        session.cards.map((card) => [card.repertoireId, card.orientation, card.chapterTitle])
      ).toStrictEqual([
        [white.id, "white", "Chapter"],
        [black.id, "black", "Chapter"]
      ]);
      answerAll(session.sessionId, {
        [START_KEY]: "e2e4",
        [session.cards[1].positionKey]: "c7c5"
      });
      expect(progressRepository.get(black.id, session.cards[1].positionKey)).toMatchObject({
        stage: 1
      });
      expect(progressRepository.get(white.id, session.cards[1].positionKey)).toBeNull();
      expect(sent.filter((event) => event.channel === "repertoires:changed")).toContainEqual({
        channel: "repertoires:changed",
        payload: expect.objectContaining({ repertoireId: black.id, kind: "progress" })
      });
    });

    it("queues each repertoire's decision at a named position", () => {
      const open = create();
      save(open.id, [["e2e4", "e7e5", "g1f3"]]);
      const closed = create();
      save(closed.id, [["d2d4"]]);
      const session = service.startPractice({
        repertoireId: open.id,
        mode: "review-due",
        repertoireIds: [open.id, closed.id],
        positionKeys: [START_KEY]
      });
      expect(session.cards.map((card) => [card.repertoireId, card.positionKey])).toStrictEqual([
        [open.id, START_KEY],
        [closed.id, START_KEY]
      ]);
    });

    it("keeps a set's session, and every repertoire's answers, when its first repertoire goes", () => {
      const first = create();
      save(first.id, [["e2e4"]]);
      const second = create();
      save(second.id, [["d2d4"]]);
      const third = create();
      save(third.id, [["c2c4"]]);
      const session = service.startPractice({
        repertoireId: first.id,
        mode: "learn-new",
        repertoireIds: [first.id, second.id, third.id]
      });
      const secondCard = session.cards.find((card) => card.repertoireId === second.id)!;
      attempt(session.sessionId, secondCard.queueItemId, "d2d4");
      expect(service.getDueSummary().resume).toMatchObject({
        repertoireId: first.id,
        sessionId: session.sessionId,
        setLabel: "All White"
      });

      // Archived: the session is offered from another of the set's repertoires.
      service.archiveRepertoire({
        id: first.id,
        archived: true,
        expectedRevision: service.getRepertoire(first.id).revision
      });
      expect(service.getDueSummary().resume).toMatchObject({
        repertoireId: second.id,
        sessionId: session.sessionId,
        setLabel: "All White"
      });

      // Deleted: the session and its answers stay.
      service.removeRepertoire({
        id: second.id,
        expectedRevision: service.getRepertoire(second.id).revision
      });
      const resumed = service.resumePractice(session.sessionId);
      expect(resumed.repertoireId).toBe(third.id);
      expect(resumed.cards.find((card) => card.repertoireId === second.id)?.state).toBe(
        "answered-correct"
      );
      expect(service.getDueSummary().resume).toMatchObject({ repertoireId: third.id });

      // One repertoire's own session has no set name.
      service.endPractice(session.sessionId);
      service.startPractice({ repertoireId: third.id, mode: "learn-new" });
      expect(service.getDueSummary().resume).not.toHaveProperty("setLabel");
    });

    it("names a set of both colours Everything", () => {
      const white = create();
      save(white.id, [["e2e4"]]);
      const black = create("black");
      save(black.id, [["e2e4", "c7c5"]]);
      service.startPractice({
        repertoireId: white.id,
        mode: "learn-new",
        repertoireIds: [white.id, black.id]
      });
      expect(service.getDueSummary().resume).toMatchObject({ setLabel: "Everything" });
    });

    it("refuses chapters with a set", () => {
      const { id } = create();
      expect(() =>
        service.startPractice({
          repertoireId: id,
          mode: "review-due",
          repertoireIds: [id],
          chapterIds: [service.getRepertoire(id).chapters[0].id]
        })
      ).toThrow("a set of repertoires can't name chapters");
    });
  });

  describe("weak spots", () => {
    /** The position after `moves` from the start. */
    const keyAfter = (moves: string[]) => {
      let fen = START_FEN;
      for (const uci of moves) fen = fenAfterUci(fen, uci)!;
      return positionKey(fen);
    };

    it("asks the forgotten positions most games first, then the lines met most", () => {
      const { id } = create("black");
      save(id, [
        ["e2e4", "c7c6", "d2d4", "d7d5", "e4e5", "c8f5"],
        ["e2e4", "c7c6", "d2d4", "d7d5", "b1c3", "d5e4"],
        ["e2e4", "c7c6", "g1f3", "d7d5"]
      ]);
      const afterE4 = keyAfter(["e2e4"]);
      const advance = keyAfter(["e2e4", "c7c6", "d2d4", "d7d5", "e4e5"]);
      const mainline = keyAfter(["e2e4", "c7c6", "d2d4", "d7d5", "b1c3"]);
      const twoKnights = keyAfter(["e2e4", "c7c6", "g1f3"]);
      const afterC6 = keyAfter(["e2e4", "c7c6"]);
      const afterD4 = keyAfter(["e2e4", "c7c6", "d2d4"]);
      const afterD5 = keyAfter(["e2e4", "c7c6", "d2d4", "d7d5"]);
      weakSpots.positions = [
        { repertoireId: id, positionKey: advance, games: 38 },
        { repertoireId: id, positionKey: twoKnights, games: 6 },
        // Not in the repertoire any more: left out.
        { repertoireId: id, positionKey: keyAfter(["d2d4"]), games: 3 }
      ];
      weakSpots.replies = new Map([
        [positionKey(START_FEN), [{ uci: "e2e4", games: 40 }]],
        [
          afterC6,
          [
            { uci: "d2d4", games: 30 },
            { uci: "g1f3", games: 9 }
          ]
        ],
        [
          afterD5,
          [
            { uci: "b1c3", games: 20 },
            { uci: "e4e5", games: 12 }
          ]
        ]
      ]);
      const session = service.startPractice({ repertoireId: id, mode: "weak" });
      expect(session.mode).toBe("weak");
      expect(session.cards.map((card) => [card.positionKey, card.weakGames])).toStrictEqual([
        [advance, 38],
        [twoKnights, 6],
        // The line met most: 1.e4 c6 2.d4 d5 3.Nc3 dxe4 (each decision asked once). The next
        // line rotates in 2.Nf3, whose decision is queued already: no more lines.
        [afterE4, undefined],
        [afterD4, undefined],
        [mainline, undefined]
      ]);
      // Answers schedule like Review.
      attempt(session.sessionId, session.cards[0].queueItemId, "c8f5");
      expect(progressRepository.get(id, advance)).toMatchObject({ stage: 1 });
    });

    it("practises one position only when a report row names it", () => {
      const { id } = create("black");
      save(id, [["e2e4", "c7c6", "d2d4", "d7d5"]]);
      const afterD4 = keyAfter(["e2e4", "c7c6", "d2d4"]);
      weakSpots.positions = [
        { repertoireId: id, positionKey: keyAfter(["e2e4"]), games: 9 },
        { repertoireId: id, positionKey: afterD4, games: 2 }
      ];
      weakSpots.replies = new Map([[positionKey(START_FEN), [{ uci: "e2e4", games: 9 }]]]);
      const session = service.startPractice({
        repertoireId: id,
        mode: "weak",
        positionKeys: [afterD4]
      });
      expect(session.cards.map((card) => card.positionKey)).toStrictEqual([afterD4]);
    });
  });

  describe("overview and perfect lines", () => {
    it("counts new, learning, mastered, learned, due, lines and each chapter's moves", () => {
      const { id } = create();
      // Two lines, both through 1.e4: 1…e5 2.Nf3 and 1…c5 2.Nc3.
      save(id, [
        ["e2e4", "e7e5", "g1f3"],
        ["e2e4", "c7c5", "b1c3"]
      ]);
      const empty = service.practiceOverview().repertoires[0];
      expect(empty).toMatchObject({
        repertoireId: id,
        decisions: 3,
        new: 3,
        learning: 0,
        mastered: 0,
        learned: 0,
        lines: 2,
        perfectLines: 0
      });
      expect(empty.chapters).toStrictEqual([
        { chapterId: service.getRepertoire(id).chapters[0].id, moves: 3, due: 0 }
      ]);
      const { session } = learnFirst(id);
      const byLast = (uci: string | undefined) =>
        session.cards.find((card) => card.leadUp.at(-1)?.uci === uci)!;
      attempt(session.sessionId, byLast(undefined).queueItemId, "e2e4");
      attempt(session.sessionId, byLast("e7e5").queueItemId, "g1f3");
      attempt(session.sessionId, byLast("c7c5").queueItemId, "a2a3");
      expect(service.practiceOverview().repertoires[0]).toMatchObject({
        new: 0,
        learning: 3,
        learned: 2,
        perfectLines: 1,
        lines: 2
      });
      // A miss sends the shared first move back to stage 0: no line is perfect any more.
      now += 2 * DAY;
      const review = service.startPractice({
        repertoireId: id,
        mode: "review-due",
        newCardLimit: 0
      });
      const first = review.cards.find((card) => card.positionKey === START_KEY)!;
      attempt(review.sessionId, first.queueItemId, "d2d4");
      expect(service.practiceOverview().repertoires[0]).toMatchObject({
        perfectLines: 0,
        learned: 1
      });
      // Mastered: next review 21 or more days after the last attempt.
      const stored = progressRepository.get(id, START_KEY)!;
      progressRepository.upsert({ ...stored, stage: 5, dueAt: stored.lastAttemptAt! + 30 * DAY });
      expect(service.practiceOverview().repertoires[0]).toMatchObject({ mastered: 1 });
    });
  });

  describe("chapter openings", () => {
    it("detects a chapter's opening on save, and never overwrites a typed one", () => {
      const { id } = create();
      const saved = save(id, [["e2e4", "c7c6", "d2d4", "d7d5", "e4e5"]]);
      expect(saved.chapter.opening).toStrictEqual({
        name: "Caro-Kann Defense: Advance Variation",
        eco: "B12",
        edited: false
      });
      const typed = { name: "My Caro", eco: null, edited: true };
      const renamed = service.saveChapter({
        repertoireId: id,
        chapter: { ...saved.chapter, opening: typed },
        expectedRevision: saved.repertoire.revision
      });
      expect(renamed.chapter.opening).toStrictEqual(typed);
      const extended = save(id, [["e2e4", "c7c6", "d2d4", "d7d5", "e4e5", "c8f5"]]);
      expect(extended.chapter.opening).toStrictEqual(typed);
    });

    it("names a line's opening from its moves, null outside the book", () => {
      expect(
        service.openingOfLine({ rootFen: START_FEN, moves: ["e2e4", "c7c5", "g1f3", "d7d6"] })
      ).toStrictEqual({ name: "Sicilian Defense: Modern Variations", eco: "B50" });
      expect(service.openingOfLine({ rootFen: START_FEN, moves: [] })).toBeNull();
      expect(service.bookOpenings().length).toBeGreaterThan(1000);
    });

    it("detects the openings of chapters stored before, once, in the background", async () => {
      const { id } = create();
      const saved = save(id, [["d2d4", "d7d5", "c2c4"]]);
      getDb().exec("UPDATE repertoire_chapters SET opening_name = NULL, opening_eco = NULL");
      expect(chapterRepository.get(saved.chapter.id)?.opening).toBeNull();
      expect(await service.detectMissingOpenings()).toBe(1);
      expect(chapterRepository.get(saved.chapter.id)?.opening).toStrictEqual({
        name: "Queen's Gambit",
        eco: "D06",
        edited: false
      });
      expect(await service.detectMissingOpenings()).toBe(0);
    });

    it("looks at a chapter the book doesn't name once, and again only once it changes", async () => {
      // A chapter without moves: the start position has no name.
      const [chapter] = service.getRepertoire(create().id).chapters;
      expect(chaptersWithoutOpening()).toStrictEqual([chapter.id]);
      expect(await service.detectMissingOpenings()).toBe(0);
      expect(chaptersWithoutOpening()).toStrictEqual([]);
      getDb().exec("UPDATE repertoire_chapters SET revision = revision + 1");
      expect(chaptersWithoutOpening()).toStrictEqual([chapter.id]);
    });
  });
});
