import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardArrow, BoardHighlight } from "@chaturanga/shared/types/chess";
import { REPERTOIRE_METADATA_LIMITS } from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { nodeAt, serviceHelpers, treeOf, withNodeId } from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { progressRepository, decisionRepository, positionIndexRepository } =
  await import("./repository");
const { create, save, learnFirst, attempt } = serviceHelpers(service);
const { userData, sent } = env;

const DAY = 24 * 60 * 60_000;
let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

describe("repertoire edits", () => {
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

  describe("repertoire service: chapters, decisions and index", () => {
    it("creates a repertoire with one root-only chapter and lists it", () => {
      const detail = create();
      expect(detail.revision).toBe(1);
      expect(detail.chapters).toHaveLength(1);
      expect(detail.chapters[0]).toMatchObject({
        rootFen: START_FEN,
        nodeCount: 0,
        kind: "opening"
      });
      expect(service.listRepertoires()).toHaveLength(1);
      expect(service.listRepertoires({ query: "white" })).toHaveLength(1);
      expect(service.listRepertoires({ query: "nothing" })).toHaveLength(0);
      expect(service.listRepertoires({ color: "black" })).toHaveLength(0);
      expect(sent.at(-1)).toMatchObject({
        channel: "repertoires:changed",
        payload: { kind: "created" }
      });
      expect(() => service.createRepertoire({ name: " ", color: "white" })).toThrow(/Invalid name/);
      expect(() => service.createRepertoire({ name: "x", color: "white", rootFen: "bad" })).toThrow(
        /Invalid rootFen/
      );
    });

    it("getDecision returns null, then the stored decision, then the updated preference", () => {
      const { id } = create();
      expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toBeNull();
      expect(() => service.getDecision({ repertoireId: "nope", positionKey: START_KEY })).toThrow(
        "Invalid repertoireId: not found"
      );
      const saved = save(id, [["e2e4"], ["d2d4"]]);
      expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toStrictEqual({
        repertoireId: id,
        positionKey: START_KEY,
        acceptedUcis: ["e2e4", "d2d4"],
        preferredUci: "e2e4",
        prompt: null,
        hint: null,
        wrongMoveFeedback: {},
        paused: false
      });
      service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: saved.repertoire.revision,
        patch: { preferredUci: "d2d4" }
      });
      const decision = service.getDecision({ repertoireId: id, positionKey: START_KEY });
      expect(decision?.preferredUci).toBe("d2d4");
      expect(decision).not.toHaveProperty("acceptanceFingerprint");
    });

    it("getPractisedElsewhere gives the moves the other chapters practise at a chapter's positions", () => {
      const { id } = create();
      const first = save(id, [["e2e4"], ["d2d4"]]);
      const firstId = first.chapter.id;
      const second = save(id, [["c2c4"]], { chapterId: "second" });
      const elsewhere = (chapterId: string) =>
        service.getPractisedElsewhere({
          repertoireId: id,
          chapterId,
          positionKeys: [START_KEY, START_KEY, "v1:nowhere"]
        });
      expect(() =>
        service.getPractisedElsewhere({
          repertoireId: "nope",
          chapterId: firstId,
          positionKeys: []
        })
      ).toThrow("Invalid repertoireId: not found");
      expect(elsewhere(second.chapter.id)).toStrictEqual({
        [START_KEY]: ["e2e4", "d2d4"],
        "v1:nowhere": []
      });
      // The decision keeps 1. e4 and 1. d4 stored, but only 1. c4 is practised by another chapter.
      expect(elsewhere(firstId)[START_KEY]).toStrictEqual(["c2c4"]);
      // A move kept as reference there is no longer practised elsewhere, though still stored.
      save(id, [["c2c4"]], {
        chapterId: second.chapter.id,
        meta: (tree) => ({ [nodeAt(tree, ["c2c4"]).id]: { edge: "reference" } })
      });
      expect(
        service.getDecision({ repertoireId: id, positionKey: START_KEY })?.acceptedUcis
      ).toContain("c2c4");
      expect(elsewhere(firstId)[START_KEY]).toStrictEqual([]);
    });

    it("getPausedKeys lists the paused decisions' position keys", () => {
      const { id } = create();
      expect(() => service.getPausedKeys("nope")).toThrow("Invalid repertoireId: not found");
      const saved = save(id, [["e2e4"]]);
      expect(service.getPausedKeys(id)).toStrictEqual([]);
      service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: saved.repertoire.revision,
        patch: { paused: true }
      });
      expect(service.getPausedKeys(id)).toStrictEqual([START_KEY]);
    });

    it("an included own-side move makes exactly one decision with index rows", () => {
      const { id } = create();
      const result = save(id, [["e2e4", "e7e5"]]);
      expect(result.decisionsChanged).toBe(1);
      expect(result.repertoire.revision).toBe(2);
      expect(result.repertoire.decisionCount).toBe(1);
      expect(result.chapter.revision).toBe(2);
      expect(decisionRepository.list(id).map((decision) => decision.positionKey)).toStrictEqual([
        START_KEY
      ]);
      const rows = positionIndexRepository.list(id);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.isDecision).map((row) => row.nodeId)).toStrictEqual(["root"]);
      expect(
        service.getChapter({ repertoireId: id, chapterId: result.chapter.id }).tree
      ).toHaveLength(3);
      expect(() => service.getChapter({ repertoireId: id, chapterId: "missing" })).toThrow(
        "Invalid chapterId: not found"
      );
    });

    it("counts a transposition reached by two chapters as one decision", () => {
      const { id } = create();
      save(id, [["e2e4", "e7e6", "d2d4", "d7d5", "b1c3"]]);
      const second = save(id, [["d2d4", "e7e6", "e2e4", "d7d5", "b1c3"]], { chapterId: "second" });
      const shared = positionKey(
        nodeAt(second.chapter.tree, ["d2d4", "e7e6", "e2e4", "d7d5"]).fenAfter
      );
      expect(
        positionIndexRepository
          .list(id)
          .filter((row) => row.positionKey === shared)
          .filter((row) => row.isDecision)
      ).toHaveLength(2);
      // Root (e4, d4), after 1.e4 e6, after 1.d4 e6, and the shared position.
      expect(second.repertoire.decisionCount).toBe(4);
      expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toStrictEqual(["e2e4", "d2d4"]);
    });

    it("a reference chapter never produces decisions", () => {
      const { id } = create();
      const result = save(id, [["e2e4", "e7e5", "g1f3"]], { kind: "reference" });
      expect(result.repertoire.decisionCount).toBe(0);
      expect(decisionRepository.list(id)).toStrictEqual([]);
    });

    it("refuses a stale revision and writes nothing", () => {
      const { id, chapters } = create();
      const tree = treeOf(START_FEN, [["e2e4"]]);
      const chapter = {
        ...service.getChapter({ repertoireId: id, chapterId: chapters[0].id }),
        tree
      };
      expect(() => service.saveChapter({ repertoireId: id, chapter, expectedRevision: 0 })).toThrow(
        "Invalid expectedRevision: repertoire changed (stored 1, expected 0)"
      );
      expect(service.getRepertoire(id).revision).toBe(1);
      expect(service.getChapter({ repertoireId: id, chapterId: chapters[0].id }).tree).toHaveLength(
        1
      );
      expect(decisionRepository.list(id)).toStrictEqual([]);
    });

    it("refuses an existing chapter whose revision moved on (e.g. a decision rewrote its edges)", () => {
      const { id, chapters } = create();
      const draft = service.getChapter({ repertoireId: id, chapterId: chapters[0].id });
      const saved = save(id, [["e2e4", "e7e5"]]);
      expect(saved.chapter.revision).toBe(draft.revision + 1);
      expect(() =>
        service.saveChapter({
          repertoireId: id,
          chapter: { ...draft, tree: treeOf(START_FEN, [["d2d4"]]) },
          expectedRevision: saved.repertoire.revision
        })
      ).toThrow(
        `Invalid chapter.revision: chapter changed (stored ${saved.chapter.revision}, expected ${draft.revision})`
      );
      expect(service.getChapter({ repertoireId: id, chapterId: chapters[0].id }).tree).toHaveLength(
        3
      );
    });

    it("rejects an inconsistent tree with the first offending node", () => {
      const { id, chapters, revision } = create();
      const base = service.getChapter({ repertoireId: id, chapterId: chapters[0].id });
      const tree = treeOf(START_FEN, [["e2e4", "e7e5"]]);
      tree[2] = { ...tree[2], fenAfter: START_FEN };
      expect(() =>
        service.saveChapter({
          repertoireId: id,
          chapter: { ...base, tree },
          expectedRevision: revision
        })
      ).toThrow(`Invalid chapter tree: node "n2" has a fenAfter that doesn't follow from its move`);
      const illegal = treeOf(START_FEN, [["e2e4"]]);
      illegal[1] = { ...illegal[1], uci: "e2e5" };
      expect(() =>
        service.saveChapter({
          repertoireId: id,
          chapter: { ...base, tree: illegal },
          expectedRevision: revision
        })
      ).toThrow(`Invalid chapter tree: node "n1" plays an illegal move (e2e5)`);
      const orphan = [
        ...treeOf(START_FEN, []),
        { ...treeOf(START_FEN, [["e2e4"]])[1], parentId: "x" }
      ];
      expect(() =>
        service.saveChapter({
          repertoireId: id,
          chapter: { ...base, tree: orphan },
          expectedRevision: revision
        })
      ).toThrow(`Invalid chapter tree: node "n1" is not connected to the root`);
    });

    it("stores castling as the king's two-square move", () => {
      const fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
      const { id } = create("white", fen);
      const tree = treeOf(fen, [["e1g1"]]);
      tree[1] = { ...tree[1], uci: "e1h1" };
      const detail = service.getRepertoire(id);
      const base = service.getChapter({ repertoireId: id, chapterId: detail.chapters[0].id });
      const result = service.saveChapter({
        repertoireId: id,
        chapter: { ...base, tree },
        expectedRevision: detail.revision
      });
      expect(result.chapter.tree[1].uci).toBe("e1g1");
      expect(decisionRepository.get(id, positionKey(fen))?.acceptedUcis).toStrictEqual(["e1g1"]);
    });

    it("derives SAN from the move, keeps only numeric NAGs and stores a __proto__ node id", () => {
      const { id } = create();
      const detail = service.getRepertoire(id);
      const base = service.getChapter({ repertoireId: id, chapterId: detail.chapters[0].id });
      const tree = withNodeId(treeOf(START_FEN, [["e2e4", "e7e5"]]), "n2", "__proto__");
      tree[0] = { ...tree[0], children: ["n1"] };
      tree[1] = { ...tree[1], san: "d4", nags: ["$1", "e5", "$1234"], children: ["__proto__"] };
      tree[2] = { ...tree[2], parentId: "n1" };
      const result = service.saveChapter({
        repertoireId: id,
        chapter: { ...base, tree, nodeMeta: JSON.parse('{"__proto__":{"edge":"reference"}}') },
        expectedRevision: detail.revision
      });
      expect(result.chapter.tree.map((node) => node.san)).toStrictEqual([null, "e4", "e5"]);
      expect(result.chapter.tree[1].nags).toStrictEqual(["$1"]);
      const stored = service.getChapter({ repertoireId: id, chapterId: base.id });
      expect(Object.entries(stored.nodeMeta)).toContainEqual(["__proto__", { edge: "reference" }]);
    });

    it("stores titles and tags on one line, valid tag names and known annotation colours only", () => {
      const { id } = create();
      const detail = service.getRepertoire(id);
      const base = service.getChapter({ repertoireId: id, chapterId: detail.chapters[0].id });
      const tree = treeOf(START_FEN, [["e2e4"]]);
      const arrow = (color: string) => ({ orig: "e2", dest: "e4", color }) as BoardArrow;
      tree[1] = {
        ...tree[1],
        arrows: [arrow("green"), arrow("purple")],
        highlights: [{ square: "e4", color: "pink" } as unknown as BoardHighlight]
      };
      const result = service.saveChapter({
        repertoireId: id,
        chapter: {
          ...base,
          title: "Line one\r\nLine two",
          headers: { White: 'A\n[Black "B"]', "Bad Tag": "x", Annotator: "Me" },
          tree
        },
        expectedRevision: detail.revision
      });
      expect(result.chapter.title).toBe("Line one Line two");
      expect(result.chapter.headers).toStrictEqual({ White: 'A [Black "B"]', Annotator: "Me" });
      expect(result.chapter.tree[1].arrows).toStrictEqual([arrow("green")]);
      expect(result.chapter.tree[1].highlights).toStrictEqual([]);
    });

    it("updates a decision: accepting selects an occurrence, removing makes it reference", () => {
      const { id } = create();
      const saved = save(id, [["e2e4"], ["d2d4"]], {
        meta: (tree) => ({ [nodeAt(tree, ["d2d4"]).id]: { edge: "reference" } })
      });
      expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toStrictEqual(["e2e4"]);
      const accepted = service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: saved.repertoire.revision,
        patch: {
          acceptedUcis: ["e2e4", "d2d4"],
          preferredUci: "d2d4",
          hint: "Central pawns",
          prompt: "Open"
        }
      });
      expect(accepted.decision).toMatchObject({
        acceptedUcis: ["e2e4", "d2d4"],
        preferredUci: "d2d4",
        hint: "Central pawns"
      });
      const chapterId = saved.chapter.id;
      const d4 = nodeAt(saved.chapter.tree, ["d2d4"]).id;
      expect(service.getChapter({ repertoireId: id, chapterId }).nodeMeta[d4]).toStrictEqual({
        edge: "included"
      });

      const removed = service.updateDecision({
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: accepted.repertoire.revision,
        patch: { acceptedUcis: ["e2e4"] }
      });
      expect(removed.decision).toMatchObject({ acceptedUcis: ["e2e4"], preferredUci: "e2e4" });
      expect(service.getChapter({ repertoireId: id, chapterId }).nodeMeta[d4]).toStrictEqual({
        edge: "reference"
      });

      const base = {
        repertoireId: id,
        positionKey: START_KEY,
        expectedRevision: removed.repertoire.revision
      };
      expect(() => service.updateDecision({ ...base, patch: { acceptedUcis: ["c2c4"] } })).toThrow(
        /"c2c4" has no occurrence/
      );
      expect(() => service.updateDecision({ ...base, patch: { acceptedUcis: ["e2e5"] } })).toThrow(
        /"e2e5" is not a legal move/
      );
      expect(() => service.updateDecision({ ...base, patch: { preferredUci: "d2d4" } })).toThrow(
        /Invalid preferredUci/
      );
      expect(() =>
        service.updateDecision({ ...base, positionKey: "v1:nowhere", patch: { paused: true } })
      ).toThrow(/Invalid positionKey/);
      const paused = service.updateDecision({
        ...base,
        patch: { paused: true, wrongMoveFeedback: { c2c4: "Not in this repertoire" } }
      });
      expect(paused.decision.paused).toBe(true);
      expect(paused.repertoire.decisionCount).toBe(0);
    });

    it("removes a chapter, duplicates without progress, archives and deletes", () => {
      const { id } = create();
      const saved = save(id, [["e2e4"]]);
      const { card, session } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      service.saveWorkspace({
        repertoireId: id,
        workspace: {
          lastChapterId: saved.chapter.id,
          lastNodeId: "n1",
          orientation: "white",
          practiceDraft: null
        }
      });

      const copy = service.duplicateRepertoire({ id });
      expect(copy.name).toBe("My white repertoire (copy)");
      expect(copy.decisionCount).toBe(1);
      expect(copy.chapters[0].id).not.toBe(saved.chapter.id);
      expect(copy.workspace?.lastChapterId).toBe(copy.chapters[0].id);
      expect(progressRepository.list(copy.id)).toStrictEqual([]);

      const archived = service.archiveRepertoire({
        id,
        archived: true,
        expectedRevision: saved.repertoire.revision
      });
      expect(archived.repertoire.archivedAt).toBe(now);
      expect(service.listRepertoires().map((item) => item.id)).toStrictEqual([copy.id]);
      expect(service.listRepertoires({ archived: true }).map((item) => item.id)).toStrictEqual([
        id
      ]);
      expect(() => service.startPractice({ repertoireId: id, mode: "learn-new" })).toThrow(
        /archived/
      );
      const restored = service.archiveRepertoire({
        id,
        archived: false,
        expectedRevision: archived.repertoire.revision
      });
      expect(restored.repertoire.archivedAt).toBeNull();

      const removed = service.removeChapter({
        repertoireId: id,
        chapterId: saved.chapter.id,
        expectedRevision: restored.repertoire.revision
      });
      expect(removed.repertoire.chapters).toStrictEqual([]);
      expect(progressRepository.get(id, START_KEY)?.suspended).toBe(true);

      service.removeRepertoire({ id, expectedRevision: removed.repertoire.revision });
      expect(() => service.getRepertoire(id)).toThrow("Invalid repertoireId: not found");
      expect(sent.at(-1)).toMatchObject({ payload: { repertoireId: id, kind: "removed" } });
    });

    it("edits name, description and tags against the revision, and search finds the new tag", () => {
      const { id, revision } = create();
      const edited = service.updateMetadata({
        id,
        expectedRevision: revision,
        patch: {
          name: "  Sicilian Najdorf  ",
          description: " Main lines ",
          tags: [" sharp ", "sharp", ""]
        }
      });
      expect(edited).toMatchObject({
        name: "Sicilian Najdorf",
        description: "Main lines",
        tags: ["sharp"],
        revision: revision + 1
      });
      expect(service.listRepertoires({ query: "SHARP" }).map((item) => item.id)).toStrictEqual([
        id
      ]);
      expect(service.listRepertoires({ query: "white" })).toStrictEqual([]);
      expect(sent.at(-1)).toMatchObject({ payload: { repertoireId: id, kind: "updated" } });
      // Another write since the editor opened: refused, nothing overwritten.
      expect(() =>
        service.updateMetadata({ id, expectedRevision: revision, patch: { name: "Stale" } })
      ).toThrow("Invalid expectedRevision: repertoire changed (stored 2, expected 1)");
      expect(service.getRepertoire(id).name).toBe("Sicilian Najdorf");
      expect(() =>
        service.updateMetadata({ id, expectedRevision: edited.revision, patch: { name: " " } })
      ).toThrow(/Invalid name/);
    });

    it("keeps metadata exactly up to the limits the renderer's forms enforce", () => {
      const { id, revision } = create();
      const limits = REPERTOIRE_METADATA_LIMITS;
      const tags = Array.from({ length: limits.tags + 1 }, (_, index) =>
        `${index}`.padEnd(limits.tag, "t")
      );
      const atLimit = service.updateMetadata({
        id,
        expectedRevision: revision,
        patch: {
          name: "n".repeat(limits.name),
          description: "d".repeat(limits.description),
          tags: tags.slice(0, limits.tags)
        }
      });
      expect(atLimit.name).toHaveLength(limits.name);
      expect(atLimit.description).toHaveLength(limits.description);
      expect(atLimit.tags).toStrictEqual(tags.slice(0, limits.tags));
      const over = service.updateMetadata({
        id,
        expectedRevision: atLimit.revision,
        patch: {
          name: "n".repeat(limits.name + 1),
          description: "d".repeat(limits.description + 1),
          tags: [...tags.slice(0, limits.tags - 1), `${tags.at(-1)}x`, tags.at(-1)!]
        }
      });
      expect(over.name).toHaveLength(limits.name);
      expect(over.description).toHaveLength(limits.description);
      expect(over.tags).toHaveLength(limits.tags);
      expect(over.tags.at(-1)).toHaveLength(limits.tag);
    });

    it("sets enabled and kind on several chapters in one revision, skipping unchanged ones", () => {
      const { id } = create();
      const first = save(id, [["e2e4", "e7e5", "g1f3"]]);
      const second = save(id, [["d2d4", "d7d5", "c2c4"]], { chapterId: "c2" });
      const third = save(id, [["c2c4"]], { chapterId: "c3", enabled: false });
      expect(third.repertoire.decisionCount).toBe(3);
      const before = service.getRepertoire(id);
      sent.length = 0;

      const disabled = service.updateChapters({
        repertoireId: id,
        chapterIds: [first.chapter.id, "c2", "c3", "c2"],
        expectedRevision: before.revision,
        patch: { enabled: false }
      });
      expect(disabled.chaptersChanged).toBe(2);
      expect(disabled.repertoire.revision).toBe(before.revision + 1);
      expect(disabled.repertoire.decisionCount).toBe(0);
      const byId = new Map(disabled.repertoire.chapters.map((chapter) => [chapter.id, chapter]));
      expect(byId.get(first.chapter.id)).toMatchObject({
        enabled: false,
        revision: first.chapter.revision + 1
      });
      expect(byId.get("c2")).toMatchObject({
        enabled: false,
        revision: second.chapter.revision + 1
      });
      expect(byId.get("c3")).toMatchObject({ enabled: false, revision: third.chapter.revision });
      // The trees are untouched; one change event for the whole batch.
      expect(service.getChapter({ repertoireId: id, chapterId: "c2" }).tree).toHaveLength(4);
      expect(sent.filter((event) => event.channel === "repertoires:changed")).toHaveLength(1);

      const reference = service.updateChapters({
        repertoireId: id,
        chapterIds: ["c2", "c3"],
        expectedRevision: disabled.repertoire.revision,
        patch: { enabled: true, kind: "reference" }
      });
      expect(reference.chaptersChanged).toBe(2);
      expect(
        reference.repertoire.chapters.filter((chapter) => chapter.kind === "reference")
      ).toHaveLength(2);
      expect(reference.repertoire.decisionCount).toBe(0);
      const reopened = service.updateChapters({
        repertoireId: id,
        chapterIds: ["c2"],
        expectedRevision: reference.repertoire.revision,
        patch: { kind: "opening" }
      });
      expect(reopened.repertoire.decisionCount).toBe(2);

      // Nothing to change: no write, no event, same revision.
      sent.length = 0;
      const unchanged = service.updateChapters({
        repertoireId: id,
        chapterIds: ["c2"],
        expectedRevision: reopened.repertoire.revision,
        patch: { kind: "opening", enabled: true }
      });
      expect(unchanged).toMatchObject({
        chaptersChanged: 0,
        repertoire: { revision: reopened.repertoire.revision }
      });
      expect(sent).toStrictEqual([]);
    });

    it("refuses a stale or foreign batch chapter update and writes none of it", () => {
      const { id } = create();
      const saved = save(id, [["e2e4"]]);
      const other = create("black");
      const revision = saved.repertoire.revision;
      expect(() =>
        service.updateChapters({
          repertoireId: id,
          chapterIds: [saved.chapter.id],
          expectedRevision: revision - 1,
          patch: { enabled: false }
        })
      ).toThrow(/Invalid expectedRevision/);
      expect(() =>
        service.updateChapters({
          repertoireId: id,
          chapterIds: [saved.chapter.id, other.chapters[0].id],
          expectedRevision: revision,
          patch: { enabled: false }
        })
      ).toThrow("Invalid chapterIds: not found");
      const after = service.getRepertoire(id);
      expect(after.revision).toBe(revision);
      expect(after.chapters[0]).toMatchObject({ enabled: true, revision: saved.chapter.revision });
    });

    it("a practice-setup write keeps where to continue studying", () => {
      const first = create();
      const firstChapter = save(first.id, [["e2e4"]]).chapter;
      const second = create();
      const secondChapter = save(second.id, [["e2e4"]]).chapter;
      const workspace = (chapterId: string) => ({
        lastChapterId: chapterId,
        lastNodeId: null,
        orientation: "white" as const,
        practiceDraft: null
      });
      service.saveWorkspace({ repertoireId: second.id, workspace: workspace(secondChapter.id) });
      now += 1000;
      service.saveWorkspace({ repertoireId: first.id, workspace: workspace(firstChapter.id) });
      now += 1000;
      service.saveWorkspace({
        repertoireId: second.id,
        workspace: {
          ...workspace(secondChapter.id),
          practiceDraft: { repertoireId: second.id, mode: "learn-new" }
        },
        practiceSetup: true
      });
      expect(service.getDueSummary().continue?.repertoireId).toBe(first.id);
      expect(service.getRepertoire(second.id).workspace?.practiceDraft).toMatchObject({
        mode: "learn-new"
      });
      expect(sent.at(-1)).toMatchObject({
        payload: { repertoireId: second.id, kind: "workspace" }
      });
    });

    it("a workspace naming another repertoire's chapter or a missing node keeps no study place", () => {
      const first = create();
      const own = save(first.id, [["e2e4"]]).chapter;
      const other = save(create().id, [["d2d4"]]).chapter;
      const workspace = (lastChapterId: string, lastNodeId: string) => ({
        lastChapterId,
        lastNodeId,
        orientation: "white" as const,
        practiceDraft: null
      });
      service.saveWorkspace({ repertoireId: first.id, workspace: workspace(other.id, "n1") });
      expect(service.getRepertoire(first.id).workspace).toMatchObject({
        lastChapterId: null,
        lastNodeId: null
      });
      service.saveWorkspace({ repertoireId: first.id, workspace: workspace(own.id, "missing") });
      expect(service.getRepertoire(first.id).workspace).toMatchObject({
        lastChapterId: own.id,
        lastNodeId: null
      });
      service.saveWorkspace({ repertoireId: first.id, workspace: workspace(own.id, "n1") });
      expect(service.getDueSummary().continue).toStrictEqual({
        repertoireId: first.id,
        chapterId: own.id,
        nodeId: "n1",
        repertoireName: "My white repertoire",
        color: "white",
        chapterTitle: "Chapter",
        fen: nodeAt(own.tree, ["e2e4"]).fenAfter
      });
      // The node was deleted since: the chapter's root position.
      save(first.id, []);
      expect(service.getDueSummary().continue).toMatchObject({ nodeId: "n1", fen: START_FEN });
    });
  });

  describe("repertoire service: progress invalidation", () => {
    it("removing an accepted move makes the decision due now without a lapse", () => {
      const { id } = create();
      save(id, [["e2e4"], ["d2d4"]]);
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      expect(progressRepository.get(id, START_KEY)).toMatchObject({ stage: 1, dueAt: now + DAY });
      now += 3_600_000;
      save(id, [["e2e4"]]);
      expect(progressRepository.get(id, START_KEY)).toMatchObject({
        stage: 1,
        dueAt: now,
        lapses: 0,
        acceptanceFingerprint: "e2e4",
        suspended: false
      });
    });

    it("removing the only occurrence suspends; restoring identical choices keeps the timestamps", () => {
      const { id } = create();
      save(id, [["e2e4"]]);
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      const dueAt = now + DAY;
      now += 1000;
      save(id, []);
      expect(progressRepository.get(id, START_KEY)).toMatchObject({ suspended: true, dueAt });
      expect(service.getRepertoire(id).decisionCount).toBe(0);
      save(id, [["e2e4"]]);
      expect(progressRepository.get(id, START_KEY)).toMatchObject({ suspended: false, dueAt });
    });

    it("adding an alternative keeps progress (no reset)", () => {
      const { id } = create();
      save(id, [["e2e4"]]);
      const { session, card } = learnFirst(id);
      attempt(session.sessionId, card.queueItemId, "e2e4");
      save(id, [["e2e4"], ["d2d4"]]);
      expect(progressRepository.get(id, START_KEY)).toMatchObject({
        dueAt: now + DAY,
        acceptanceFingerprint: "d2d4,e2e4"
      });
    });
  });
});
