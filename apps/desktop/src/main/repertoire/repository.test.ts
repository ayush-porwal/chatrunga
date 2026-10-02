import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repertoire-repo-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("../db");
const {
  RepertoireCorruptChapterError,
  attemptRepository,
  chapterRepository,
  decisionRepository,
  progressRepository,
  repertoireRepository,
  sessionRepository,
  transaction,
  workspaceRepository
} = await import("./repository");
const { rootNode } = await import("./chapter-validation");

const record = {
  id: "r1",
  name: "50% Sicilian",
  color: "black" as const,
  description: "",
  tags: ["sharp", "najdorf"],
  revision: 1,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1
};

const chapter: RepertoireChapter = {
  id: "c1",
  title: "Main",
  sortOrder: 0,
  kind: "opening",
  enabled: true,
  rootFen: START_FEN,
  revision: 1,
  nodeCount: 0,
  dueCount: 0,
  headers: { ECO: "B90" },
  tree: [rootNode(START_FEN)],
  nodeMeta: { root: { edge: "included", trainingStart: true } }
};

describe("repertoire repository (SQLite)", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("round-trips repertoires, chapters, decisions, progress, sessions and workspace", () => {
    repertoireRepository.insert(record);
    chapterRepository.upsert("r1", chapter, 5);
    expect(repertoireRepository.get("r1")).toEqual(record);
    expect(chapterRepository.get("c1")).toEqual(chapter);
    expect(chapterRepository.ownerOf("c1")).toEqual({ repertoireId: "r1", revision: 1 });
    expect(chapterRepository.maxSortOrder("r1")).toBe(0);
    expect(chapterRepository.summaries("r1", 10)).toEqual([
      expect.objectContaining({ id: "c1", nodeCount: 0, dueCount: 0 })
    ]);

    // LIKE wildcards are matched literally; tags are searched too.
    expect(repertoireRepository.list({ query: "50%" }, 10)).toHaveLength(1);
    expect(repertoireRepository.list({ query: "5_%" }, 10)).toHaveLength(0);
    expect(repertoireRepository.list({ query: "najdorf", color: "black" }, 10)).toHaveLength(1);
    expect(repertoireRepository.list({ color: "white" }, 10)).toHaveLength(0);
    expect(repertoireRepository.summary("r1", 10)).toMatchObject({
      chapterCount: 1,
      decisionCount: 0,
      dueCount: 0,
      lastStudiedAt: 5
    });

    const decision = {
      repertoireId: "r1",
      positionKey: "k",
      acceptedUcis: ["e7e5"],
      preferredUci: "e7e5",
      prompt: null,
      hint: "Symmetry",
      wrongMoveFeedback: { c7c5: "Not today" },
      paused: false,
      acceptanceFingerprint: "e7e5"
    };
    decisionRepository.upsert(decision, 1);
    expect(decisionRepository.get("r1", "k")).toEqual(decision);
    expect(decisionRepository.isSupported("r1", "k")).toBe(false);

    const progress = {
      repertoireId: "r1",
      positionKey: "k",
      stage: 2,
      dueAt: 3,
      lastAttemptAt: 2,
      lapses: 1,
      unaidedSuccesses: 2,
      acceptanceFingerprint: "e7e5",
      schedulerVersion: 1,
      suspended: false
    };
    progressRepository.upsert(progress);
    expect(progressRepository.get("r1", "k")).toEqual(progress);
    expect(progressRepository.list("r1")).toEqual([progress]);

    workspaceRepository.save(
      "r1",
      { lastChapterId: "c1", lastNodeId: null, orientation: "black", practiceDraft: null },
      9
    );
    expect(workspaceRepository.get("r1")).toEqual({
      lastChapterId: "c1",
      lastNodeId: null,
      orientation: "black",
      practiceDraft: null
    });
    expect(repertoireRepository.lastStudyPlace()).toEqual({
      repertoireId: "r1",
      chapterId: "c1",
      nodeId: null
    });

    const session = {
      id: "s1",
      repertoireId: "r1",
      mode: "learn-new" as const,
      scope: { repertoireId: "r1" },
      snapshotRevision: 1,
      cards: [],
      policies: {},
      cursor: 0,
      status: "active" as const,
      createdAt: 1,
      updatedAt: 1
    };
    sessionRepository.save(session);
    expect(sessionRepository.get("s1")).toEqual(session);
    attemptRepository.insert({
      attemptId: "a1",
      sessionId: "s1",
      queueItemId: "q1",
      sequence: 1,
      kind: "hint",
      uci: null,
      legal: true,
      correct: false,
      isFinalGrade: false,
      outcome: null,
      positionKey: "k",
      fingerprint: "e7e5",
      resultJson: null,
      at: 4
    });
    attemptRepository.setResult("a1", "{}");
    expect(attemptRepository.get("a1")?.resultJson).toBe("{}");
    expect(attemptRepository.lastAt("s1")).toBe(4);
    expect(attemptRepository.list("s1", "q1")).toHaveLength(1);
  });

  it("rolls a failing transaction back", () => {
    expect(() =>
      transaction(() => {
        repertoireRepository.insert(record);
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(repertoireRepository.get("r1")).toBeNull();
  });

  it("reports a damaged chapter as a recoverable error and leaves the row alone", () => {
    repertoireRepository.insert(record);
    chapterRepository.upsert("r1", chapter, 1);
    const db = getDb();
    db.prepare("UPDATE repertoire_chapters SET tree_json = ? WHERE id = 'c1'").run("{not json");
    expect(() => chapterRepository.get("c1")).toThrow(RepertoireCorruptChapterError);
    expect(() => chapterRepository.list("r1")).toThrow(
      "Repertoire chapter c1 is damaged and can't be opened: its stored JSON is unreadable"
    );
    db.prepare("UPDATE repertoire_chapters SET tree_json = ? WHERE id = 'c1'").run("[]");
    expect(() => chapterRepository.get("c1")).toThrow(/the move tree is missing/);
    db.prepare("UPDATE repertoire_chapters SET tree_json = ? WHERE id = 'c1'").run('[{"id":"x"}]');
    expect(() => chapterRepository.get("c1")).toThrow(/malformed/);
    expect(db.prepare("SELECT tree_json FROM repertoire_chapters WHERE id = 'c1'").get()).toEqual({
      tree_json: '[{"id":"x"}]'
    });
    // Summaries don't read trees, so the hub still lists the chapter.
    expect(chapterRepository.summaries("r1", 1)).toHaveLength(1);
    try {
      chapterRepository.get("c1");
    } catch (error) {
      expect((error as InstanceType<typeof RepertoireCorruptChapterError>).chapterId).toBe("c1");
    }
  });
});
