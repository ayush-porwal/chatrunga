import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import {
  REPERTOIRE_BACKUP_FORMAT,
  type RepertoireBackupDocument,
  type RepertoireBackupEntry,
  type RepertoireChapter
} from "../types/repertoire";
import { fenAfterUci, START_FEN } from "./position";
import { positionKey } from "./repertoire-position";
import {
  buildBackupDocument,
  DEFAULT_BACKUP_LIMITS,
  diffBackupEntry,
  remapBackupEntry,
  stripForExport,
  validateBackupDocument
} from "./repertoire-backup";

/** A tree along one UCI line; node ids are `n1`, `n2`, … */
function lineTree(line: string[]): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: START_FEN,
    fenAfter: START_FEN,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  let parent = root;
  line.forEach((uci, index) => {
    const node: MoveNode = {
      ...root,
      id: `n${index + 1}`,
      parentId: parent.id,
      uci,
      san: uci,
      fenBefore: parent.fenAfter,
      fenAfter: fenAfterUci(parent.fenAfter, uci)!,
      ply: index + 1,
      children: []
    };
    parent.children.push(node.id);
    tree.push(node);
    parent = node;
  });
  return tree;
}

function chapter(id: string, line: string[], title = `Chapter ${id}`): RepertoireChapter {
  const tree = lineTree(line);
  return {
    id,
    title,
    sortOrder: 0,
    kind: "opening",
    enabled: true,
    rootFen: START_FEN,
    revision: 1,
    nodeCount: tree.length - 1,
    dueCount: 3,
    headers: { Event: "Prep" },
    tree,
    nodeMeta: { n1: { edge: "included" }, n2: { edge: "covered" } }
  };
}

const afterE4E5 = fenAfterUci(fenAfterUci(START_FEN, "e2e4")!, "e7e5")!;

function entry(overrides: Partial<RepertoireBackupEntry> = {}): RepertoireBackupEntry {
  return {
    repertoire: {
      id: "rep-1",
      name: "Open games",
      color: "white",
      description: "",
      tags: ["e4"],
      revision: 4,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2
    },
    chapters: [chapter("c1", ["e2e4", "e7e5", "g1f3"])],
    decisions: [
      {
        repertoireId: "rep-1",
        positionKey: positionKey(START_FEN),
        acceptedUcis: ["e2e4"],
        preferredUci: "e2e4",
        prompt: null,
        hint: null,
        wrongMoveFeedback: {},
        paused: false
      },
      {
        repertoireId: "rep-1",
        positionKey: positionKey(afterE4E5),
        acceptedUcis: ["g1f3"],
        preferredUci: null,
        prompt: "Develop",
        hint: null,
        wrongMoveFeedback: {},
        paused: false
      }
    ],
    progress: [
      {
        repertoireId: "rep-1",
        positionKey: positionKey(START_FEN),
        stage: 2,
        dueAt: 100,
        lastAttemptAt: 50,
        lapses: 0,
        unaidedSuccesses: 2,
        acceptanceFingerprint: "e2e4",
        schedulerVersion: 1,
        suspended: false
      }
    ],
    workspace: {
      lastChapterId: "c1",
      lastNodeId: "n2",
      orientation: "white",
      practiceDraft: { repertoireId: "rep-1", mode: "review-due" }
    },
    gameLinks: [
      {
        id: "link-1",
        repertoireId: "rep-1",
        chapterId: "c1",
        gameId: "game-1",
        gameNodeId: "g3",
        kind: "source",
        headers: { White: "A" },
        capturedPath: "1. e4 e5 2. Nf3",
        createdAt: 5
      }
    ],
    ...overrides
  };
}

function documentOf(entries: RepertoireBackupEntry[]): RepertoireBackupDocument {
  return buildBackupDocument(entries, {
    app: { name: "Chaturanga", version: "1.2.3" },
    now: 1_000,
    positionKeyVersion: 1,
    schedulerVersion: 1
  });
}

/** A JSON round trip, as a document read from disk. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("buildBackupDocument and stripForExport", () => {
  it("stamps the format, versions, app and time", () => {
    const document = documentOf([entry()]);
    expect(document).toMatchObject({
      format: REPERTOIRE_BACKUP_FORMAT,
      formatVersion: 1,
      positionKeyVersion: 1,
      schedulerVersion: 1,
      exportedAt: 1_000,
      app: { name: "Chaturanga", version: "1.2.3" }
    });
    expect(document.repertoires).toHaveLength(1);
  });

  it("leaves progress out unless asked and drops derived and session state", () => {
    const stripped = stripForExport(entry(), false);
    expect(stripped.progress).toBeNull();
    expect(stripped.chapters[0].dueCount).toBe(0);
    expect(stripped.workspace?.practiceDraft).toBeNull();
    expect(stripForExport(entry(), true).progress).toHaveLength(1);
  });
});

describe("validateBackupDocument", () => {
  it("accepts a document it built, from text or a parsed value", () => {
    const document = documentOf([stripForExport(entry(), true)]);
    const fromText = validateBackupDocument(JSON.stringify(document));
    expect(fromText.warnings).toEqual([]);
    expect(fromText.document.repertoires[0].decisions).toHaveLength(2);
    expect(fromText.document.repertoires[0].progress).toHaveLength(1);
    expect(fromText.document.repertoires[0].chapters[0].tree).toHaveLength(4);
    expect(validateBackupDocument(roundTrip(document)).document).toEqual(fromText.document);
  });

  it("rejects text that isn't JSON or isn't a backup", () => {
    expect(() => validateBackupDocument("{not json")).toThrow(
      "Invalid backup: the file isn't valid JSON"
    );
    expect(() => validateBackupDocument({ format: "something-else" })).toThrow(
      "Invalid backup: this isn't a Chaturanga repertoire backup"
    );
    expect(() => validateBackupDocument([])).toThrow("this isn't a Chaturanga repertoire backup");
  });

  it("rejects an unsupported format version", () => {
    const document = { ...documentOf([entry()]), formatVersion: 2 };
    expect(() => validateBackupDocument(roundTrip(document))).toThrow(
      "Invalid backup: format version 2 isn't supported by this app"
    );
  });

  it("rejects a newer position key version and leaves progress of a newer scheduler out", () => {
    const newerKeys = { ...documentOf([entry()]), positionKeyVersion: 2 };
    expect(() => validateBackupDocument(roundTrip(newerKeys))).toThrow(
      "position key version 2, newer than this app's 1"
    );
    const newerScheduler = { ...documentOf([entry()]), schedulerVersion: 2 };
    const result = validateBackupDocument(roundTrip(newerScheduler));
    expect(result.document.repertoires[0].progress).toBeNull();
    expect(result.warnings[0]).toContain("scheduler version 2");
  });

  it("rejects a malformed document with the place that is wrong", () => {
    const missingChapters = roundTrip(documentOf([entry()])) as RepertoireBackupDocument;
    (missingChapters.repertoires[0] as unknown as Record<string, unknown>).chapters = "nope";
    expect(() => validateBackupDocument(missingChapters)).toThrow(
      'Invalid backup: repertoire "Open games" chapters is not a list'
    );

    const badColor = roundTrip(documentOf([entry()])) as RepertoireBackupDocument;
    (badColor.repertoires[0].repertoire as Record<string, unknown>).color = "green";
    expect(() => validateBackupDocument(badColor)).toThrow("color is not white or black");
  });

  it("checks every tree's shape: root, links, unique ids, reachability", () => {
    const broken = (mutate: (tree: MoveNode[]) => void) => {
      const document = roundTrip(documentOf([entry()])) as RepertoireBackupDocument;
      mutate(document.repertoires[0].chapters[0].tree);
      return () => validateBackupDocument(document);
    };
    expect(broken((tree) => (tree[0].id = "start"))).toThrow(
      'chapter "Chapter c1" has no root node'
    );
    expect(broken((tree) => (tree[2].parentId = "root"))).toThrow('node "n2" has the wrong parent');
    expect(broken((tree) => (tree[3].id = "n2"))).toThrow('lists node "n2" twice');
    expect(broken((tree) => tree[1].children.push("ghost"))).toThrow(
      'lists a missing child "ghost"'
    );
    expect(broken((tree) => (tree[1].children = []))).toThrow(
      'node "n2" is not connected to the root'
    );
  });

  it("drops decisions at unknown positions and progress without a decision, with warnings", () => {
    const source = entry();
    source.decisions.push({ ...source.decisions[0], positionKey: "v1:not-a-position" });
    source.progress!.push({ ...source.progress![0], positionKey: positionKey(afterE4E5) });
    source.decisions.splice(1, 1);
    const { document, warnings } = validateBackupDocument(roundTrip(documentOf([source])));
    expect(document.repertoires[0].decisions.map((item) => item.positionKey)).toEqual([
      positionKey(START_FEN)
    ]);
    expect(document.repertoires[0].progress).toHaveLength(1);
    expect(warnings).toEqual([
      `repertoire "Open games": 1 decision doesn't match a position in its chapters and was left out`,
      `repertoire "Open games": 1 progress entry doesn't match a decision and was left out`
    ]);
  });

  it("reads only known fields, so secrets in a document are never restored", () => {
    const document = roundTrip(documentOf([entry()])) as Record<string, unknown>;
    document.apiKey = "sk-secret";
    document.settings = { openRouterKey: "sk-secret", enginePath: "/usr/bin/stockfish" };
    const repertoires = document.repertoires as Record<string, unknown>[];
    repertoires[0].apiKey = "sk-secret";
    (repertoires[0].repertoire as Record<string, unknown>).token = "sk-secret";
    const { document: validated } = validateBackupDocument(document);
    expect(JSON.stringify(validated)).not.toContain("sk-secret");
    expect(JSON.stringify(validated)).not.toContain("stockfish");
    expect(Object.keys(validated).sort()).toEqual([
      "app",
      "exportedAt",
      "format",
      "formatVersion",
      "positionKeyVersion",
      "repertoires",
      "schedulerVersion"
    ]);
  });

  it("rejects a repertoire or chapter listed twice", () => {
    expect(() => validateBackupDocument(roundTrip(documentOf([entry(), entry()])))).toThrow(
      'Invalid backup: repertoire "Open games" is listed twice'
    );
    const other = entry();
    other.repertoire = { ...other.repertoire, id: "rep-2" };
    expect(() => validateBackupDocument(roundTrip(documentOf([entry(), other])))).toThrow(
      'chapter "Chapter c1" appears in more than one repertoire'
    );
  });

  describe("limits", () => {
    const limits = (patch: Partial<typeof DEFAULT_BACKUP_LIMITS>) => ({
      ...DEFAULT_BACKUP_LIMITS,
      ...patch
    });

    it("bounds the file size", () => {
      const text = JSON.stringify(documentOf([entry()]));
      expect(() => validateBackupDocument(text, limits({ maxBytes: 100 }))).toThrow(
        /Invalid backup: the file is .* MiB; backups up to .* MiB can be restored/
      );
    });

    it("bounds the repertoire count", () => {
      const second = entry();
      second.repertoire = { ...second.repertoire, id: "rep-2" };
      second.chapters = [chapter("c2", ["d2d4"])];
      const document = roundTrip(documentOf([entry(), second]));
      expect(() => validateBackupDocument(document, limits({ maxRepertoires: 1 }))).toThrow(
        "Invalid backup: it has 2 repertoires; at most 1 can be restored at once"
      );
    });

    it("bounds the chapter count", () => {
      const source = entry({ chapters: [chapter("c1", ["e2e4"]), chapter("c2", ["d2d4"])] });
      expect(() =>
        validateBackupDocument(roundTrip(documentOf([source])), limits({ maxChapters: 1 }))
      ).toThrow("Invalid backup: it has 2 chapters; at most 1 can be restored at once");
    });

    it("bounds the move count", () => {
      expect(() =>
        validateBackupDocument(roundTrip(documentOf([entry()])), limits({ maxNodes: 3 }))
      ).toThrow("Invalid backup: it has 4 moves; at most 3 can be restored at once");
    });

    it("uses the design defaults", () => {
      expect(DEFAULT_BACKUP_LIMITS).toMatchObject({
        maxRepertoires: 100,
        maxChapters: 1_000,
        maxNodes: 200_000,
        maxBytes: 32 * 1024 * 1024
      });
    });
  });
});

describe("diffBackupEntry", () => {
  it("is empty for the same content", () => {
    expect(diffBackupEntry(entry(), entry())).toEqual({
      chaptersAdded: 0,
      chaptersChanged: 0,
      chaptersRemoved: 0,
      decisionsChanged: 0,
      progressEntries: 1
    });
  });

  it("counts added, changed and removed chapters and changed decisions", () => {
    const existing = entry({
      chapters: [chapter("c1", ["e2e4", "e7e5", "g1f3"]), chapter("old", ["d2d4"])]
    });
    const changedChapter = chapter("c1", ["e2e4", "e7e5", "g1f3"]);
    changedChapter.nodeMeta = { n1: { edge: "reference" } };
    const incoming = entry({
      chapters: [changedChapter, chapter("new", ["c2c4"])],
      progress: null
    });
    incoming.decisions[1] = { ...incoming.decisions[1], prompt: "Something else" };
    expect(diffBackupEntry(existing, incoming)).toEqual({
      chaptersAdded: 1,
      chaptersChanged: 1,
      chaptersRemoved: 1,
      decisionsChanged: 1,
      progressEntries: 0
    });
  });

  it("ignores node order, accepted-move order and derived fields", () => {
    const incoming = entry();
    incoming.chapters[0] = {
      ...incoming.chapters[0],
      dueCount: 0,
      revision: 9,
      tree: [...incoming.chapters[0].tree].reverse()
    };
    incoming.decisions[0] = { ...incoming.decisions[0], acceptedUcis: ["e2e4"] };
    expect(diffBackupEntry(entry(), incoming).chaptersChanged).toBe(0);
    const renamed = entry();
    renamed.chapters[0] = { ...renamed.chapters[0], title: "Renamed" };
    expect(diffBackupEntry(entry(), renamed).chaptersChanged).toBe(1);
  });
});

describe("remapBackupEntry", () => {
  it("gives a copy fresh repertoire, chapter and link ids and keeps node ids", () => {
    const remapped = remapBackupEntry(entry(), {
      newRepertoireId: "copy",
      idFor: (chapterId) => `${chapterId}-copy`,
      linkIdFor: (linkId) => `${linkId}-copy`
    });
    expect(remapped.repertoire.id).toBe("copy");
    expect(remapped.chapters.map((item) => item.id)).toEqual(["c1-copy"]);
    expect(remapped.chapters[0].tree.map((node) => node.id)).toEqual(["root", "n1", "n2", "n3"]);
    expect(remapped.chapters[0].nodeMeta).toEqual(entry().chapters[0].nodeMeta);
    expect(remapped.decisions.every((item) => item.repertoireId === "copy")).toBe(true);
    expect(remapped.progress?.every((item) => item.repertoireId === "copy")).toBe(true);
    expect(remapped.workspace).toMatchObject({ lastChapterId: "c1-copy", lastNodeId: "n2" });
    expect(remapped.workspace?.practiceDraft).toBeNull();
    expect(remapped.gameLinks[0]).toMatchObject({
      id: "link-1-copy",
      repertoireId: "copy",
      chapterId: "c1-copy",
      gameId: "game-1"
    });
  });
});
