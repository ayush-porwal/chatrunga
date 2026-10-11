import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { nodeAt, serviceHelpers } from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { progressRepository } = await import("./repository");
const { create, save, learnFirst, attempt } = serviceHelpers(service);
const { userData } = env;

const DAY = 24 * 60 * 60_000;
let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

describe("repertoire queries", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    service.resetImportJobs();
    now = 1_000_000_000_000;
  });

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  describe("repertoire service: due work and occurrences", () => {
    it("offers the most recently updated unfinished session of an active repertoire to resume", () => {
      const { id } = create();
      save(id, [["e2e4", "e7e5", "g1f3"]]);
      const other = create("black").id;
      save(other, [["e2e4", "e7e5"]]);
      const learn = service.startPractice({ repertoireId: id, mode: "learn-new" });
      expect(service.getDueSummary().resume).toStrictEqual({
        repertoireId: id,
        sessionId: learn.sessionId,
        mode: "learn-new",
        repertoireName: "My white repertoire",
        color: "white"
      });
      now += 1000;
      const rehearsal = service.startPractice({
        repertoireId: other,
        mode: "rehearse-lines",
        rehearse: { chapterId: service.getRepertoire(other).chapters[0].id }
      });
      expect(service.getDueSummary().resume).toStrictEqual({
        repertoireId: other,
        sessionId: rehearsal.sessionId,
        mode: "rehearse-lines",
        repertoireName: "My black repertoire",
        color: "black"
      });
      // An answer makes a session the latest again; an ended one isn't offered.
      now += 1000;
      attempt(learn.sessionId, learn.cards[0].queueItemId, "e2e4");
      expect(service.getDueSummary().resume?.sessionId).toBe(learn.sessionId);
      service.endPractice(learn.sessionId);
      expect(service.getDueSummary().resume?.sessionId).toBe(rehearsal.sessionId);
      // A session of an archived repertoire isn't offered either.
      service.archiveRepertoire({
        id: other,
        archived: true,
        expectedRevision: service.getRepertoire(other).revision
      });
      expect(service.getDueSummary().resume).toBeNull();
    });

    it("summarises due work and where to continue", () => {
      const { id } = create();
      const saved = save(id, [["e2e4"]]);
      expect(service.getDueSummary()).toStrictEqual({
        dueCount: 0,
        repertoireCount: 0,
        continue: null,
        resume: null,
        next: null,
        alsoDue: null
      });
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      service.saveWorkspace({
        repertoireId: id,
        workspace: {
          lastChapterId: saved.chapter.id,
          lastNodeId: null,
          orientation: "white",
          practiceDraft: null
        }
      });
      now += 2 * DAY;
      expect(service.getDueSummary()).toStrictEqual({
        dueCount: 1,
        repertoireCount: 1,
        continue: {
          repertoireId: id,
          chapterId: saved.chapter.id,
          nodeId: "root",
          repertoireName: "My white repertoire",
          color: "white",
          chapterTitle: "Chapter",
          fen: START_FEN
        },
        resume: {
          repertoireId: id,
          sessionId: session.sessionId,
          mode: "learn-new",
          repertoireName: "My white repertoire",
          color: "white"
        },
        next: {
          repertoireId: id,
          repertoireName: "My white repertoire",
          color: "white",
          dueCount: 1,
          chapterId: saved.chapter.id,
          nodeId: "root",
          fen: START_FEN,
          lastMove: null
        },
        alsoDue: null
      });
      const detail = service.getRepertoire(id);
      expect(detail.dueCount).toBe(1);
      expect(detail.chapters[0].dueCount).toBe(1);

      // Archived: neither the repertoire nor its chapters report due work.
      const archived = service.archiveRepertoire({
        id,
        archived: true,
        expectedRevision: detail.revision
      }).repertoire;
      expect(archived.dueCount).toBe(0);
      expect(archived.chapters[0].dueCount).toBe(0);
      const restored = service.archiveRepertoire({
        id,
        archived: false,
        expectedRevision: archived.revision
      }).repertoire;
      expect(restored.chapters[0].dueCount).toBe(1);

      // A paused decision isn't due in its chapter either.
      const paused = service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: restored.revision,
        patch: { paused: true }
      }).repertoire;
      expect(paused.dueCount).toBe(0);
      expect(paused.chapters[0].dueCount).toBe(0);
    });

    it("offers the earliest due position of the repertoire with the most due, and the runner-up", () => {
      const white = create();
      const chapter = save(white.id, [
        ["e2e4", "e7e5", "g1f3"],
        ["e2e4", "c7c5", "g1f3"]
      ]).chapter;
      const sicilian = nodeAt(chapter.tree, ["e2e4", "c7c5"]);
      // The same position at a disabled chapter's root: shallower, but the enabled chapter's is shown.
      save(white.id, [["g1f3"]], {
        chapterId: "disabled",
        rootFen: sicilian.fenAfter,
        enabled: false
      });
      const black = create("black");
      save(black.id, [["e2e4", "c7c5"]]);
      const due = (repertoireId: string, fen: string, dueAt: number) =>
        progressRepository.upsert({
          repertoireId,
          positionKey: positionKey(fen),
          stage: 1,
          dueAt,
          lastAttemptAt: null,
          lapses: 0,
          unaidedSuccesses: 0,
          acceptanceFingerprint: "",
          schedulerVersion: 1,
          suspended: false
        });
      due(white.id, nodeAt(chapter.tree, ["e2e4", "e7e5"]).fenAfter, now - 50);
      due(white.id, sicilian.fenAfter, now - 100);
      due(black.id, nodeAt(chapter.tree, ["e2e4"]).fenAfter, now - 200);
      // Not due yet: neither counted nor offered.
      due(white.id, START_FEN, now + DAY);

      const summary = service.getDueSummary();
      expect(summary).toMatchObject({ dueCount: 3, repertoireCount: 2 });
      expect(summary.next).toStrictEqual({
        repertoireId: white.id,
        repertoireName: "My white repertoire",
        color: "white",
        dueCount: 2,
        chapterId: chapter.id,
        nodeId: sicilian.id,
        fen: sicilian.fenAfter,
        lastMove: { uci: "c7c5", san: "c5", moveNumber: 1, color: "black" }
      });
      expect(summary.alsoDue).toStrictEqual({
        repertoireId: black.id,
        name: "My black repertoire",
        dueCount: 1
      });

      // Due at the same time: the shallower position comes first.
      due(white.id, START_FEN, now - 100);
      expect(service.getDueSummary().next).toMatchObject({
        dueCount: 3,
        nodeId: "root",
        fen: START_FEN,
        lastMove: null
      });

      // Equally many due: the repertoire studied most recently leads.
      getDb().exec("DELETE FROM repertoire_progress");
      due(white.id, START_FEN, now - 100);
      due(black.id, nodeAt(chapter.tree, ["e2e4"]).fenAfter, now - 100);
      now += 1000;
      service.saveWorkspace({
        repertoireId: black.id,
        workspace: {
          lastChapterId: null,
          lastNodeId: null,
          orientation: "black",
          practiceDraft: null
        }
      });
      expect(service.getDueSummary()).toMatchObject({
        next: { repertoireId: black.id, dueCount: 1 },
        alsoDue: { repertoireId: white.id, dueCount: 1 }
      });
    });

    it("lists every occurrence of a position with its chapter title and SAN path", () => {
      const { id } = create();
      expect(() =>
        service.getOccurrences({ repertoireId: "nope", positionKey: START_KEY })
      ).toThrow("Invalid repertoireId: not found");
      const first = save(id, [["e2e4", "e7e6", "d2d4", "d7d5"]]);
      const second = save(id, [["d2d4", "e7e6", "e2e4", "d7d5"]], { chapterId: "second" });
      const shared = positionKey(
        nodeAt(first.chapter.tree, ["e2e4", "e7e6", "d2d4", "d7d5"]).fenAfter
      );
      expect(service.getOccurrences({ repertoireId: id, positionKey: shared })).toStrictEqual([
        {
          chapterId: first.chapter.id,
          chapterTitle: "Chapter",
          nodeId: nodeAt(first.chapter.tree, ["e2e4", "e7e6", "d2d4", "d7d5"]).id,
          path: "1. e4 e6 2. d4 d5",
          ply: 4
        },
        {
          chapterId: "second",
          chapterTitle: "Chapter",
          nodeId: nodeAt(second.chapter.tree, ["d2d4", "e7e6", "e2e4", "d7d5"]).id,
          path: "1. d4 e6 2. e4 d5",
          ply: 4
        }
      ]);
      expect(service.getOccurrences({ repertoireId: id, positionKey: "v1:nowhere" })).toStrictEqual(
        []
      );
    });

    it("returns a repeated position within one chapter as two occurrences", () => {
      const { id } = create();
      const knights = ["g1f3", "g8f6", "f3g1", "f6g8"];
      const saved = save(id, [knights]);
      const occurrences = service.getOccurrences({ repertoireId: id, positionKey: START_KEY });
      expect(occurrences.map((item) => [item.nodeId, item.path, item.ply])).toStrictEqual([
        ["root", "", 0],
        [nodeAt(saved.chapter.tree, knights).id, "1. Nf3 Nf6 2. Ng1 Ng8", 4]
      ]);
    });

    it("numbers paths from a Black-to-move root with 1...", () => {
      const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
      const { id } = create("black", fen);
      const saved = save(id, [["e7e5", "g1f3"]]);
      const node = nodeAt(saved.chapter.tree, ["e7e5", "g1f3"]);
      expect(
        service.getOccurrences({ repertoireId: id, positionKey: positionKey(node.fenAfter) })
      ).toStrictEqual([
        expect.objectContaining({ nodeId: node.id, path: "1... e5 2. Nf3", ply: 3 })
      ]);
    });
  });

  describe("repertoire service: game comparison", () => {
    function twoChapters() {
      const { id } = create();
      save(id, [["e2e4", "e7e5", "g1f3"]]);
      save(id, [["e2e4", "e7e5", "b1c3", "g8f6", "f1c4"]], { chapterId: "c2" });
      return id;
    }

    it("compares a game across two chapters and reports the first deviation", () => {
      const id = twoChapters();
      const firstChapter = service.getRepertoire(id).chapters[0].id;
      const inRepertoire = service.compareGame({
        repertoireId: id,
        color: "white",
        rootFen: START_FEN,
        moves: ["e2e4", "e7e5", "b1c3", "g8f6", "f1c4"]
      });
      expect(inRepertoire.issue).toBeNull();
      expect(inRepertoire.matchedPlies).toBe(5);
      expect(inRepertoire.chaptersUsed.map((item) => item.chapterId)).toStrictEqual([
        firstChapter,
        "c2"
      ]);

      const deviation = service.compareGame({
        repertoireId: id,
        color: "white",
        rootFen: START_FEN,
        moves: ["e2e4", "e7e5", "d2d4", "e5d4"]
      });
      expect(deviation.matchedPlies).toBe(2);
      expect(deviation.issue).toMatchObject({
        status: "player-deviation",
        ply: 3,
        playedUci: "d2d4",
        expectedUcis: ["g1f3", "b1c3"],
        preferredUci: "g1f3",
        chapterId: firstChapter
      });
      expect(deviation.moves.map((move) => move.status)).toStrictEqual([
        "player-choice",
        "covered-reply",
        "deviation",
        "outside-scope"
      ]);
    });

    it("caches by revision: a repeat is the same result, an edit computes a new one", () => {
      const id = twoChapters();
      const input = {
        repertoireId: id,
        color: "white" as const,
        rootFen: START_FEN,
        moves: ["e2e4", "e7e5", "f1c4"]
      };
      const first = service.compareGame(input);
      expect(service.compareGame({ ...input, moves: [...input.moves] })).toBe(first);
      expect(service.compareGame({ ...input, moves: ["e2e4", "e7e5"] })).not.toBe(first);

      const { revision } = service.getRepertoire(id);
      service.updateMetadata({ id, expectedRevision: revision, patch: { name: "Renamed" } });
      const second = service.compareGame(input);
      expect(second).not.toBe(first);
      expect(second).toMatchObject({ revision: revision + 1, repertoireName: "Renamed" });
      expect(second.issue).toStrictEqual(first.issue);
    });

    it("refuses an unknown repertoire or an illegal move; compares an archived repertoire", () => {
      const id = twoChapters();
      const game = {
        repertoireId: id,
        color: "white" as const,
        rootFen: START_FEN,
        moves: ["e2e4"]
      };
      expect(() => service.compareGame({ ...game, repertoireId: "nope" })).toThrow(
        "Invalid repertoireId: not found"
      );
      expect(() => service.compareGame({ ...game, moves: ["e2e4", "e2e4"] })).toThrow(
        'Invalid moves: "e2e4" (ply 2) is not legal'
      );
      expect(() => service.compareGame({ ...game, color: "black" })).toThrow(
        "Invalid color: this repertoire is for white"
      );
      const { revision } = service.getRepertoire(id);
      service.archiveRepertoire({ id, archived: true, expectedRevision: revision });
      expect(service.compareGame(game)).toMatchObject({ issue: null, matchedPlies: 1 });
    });
  });
});
