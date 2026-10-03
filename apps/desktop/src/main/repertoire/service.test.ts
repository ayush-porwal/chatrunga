import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardArrow, BoardHighlight, MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_METADATA_LIMITS,
  type AddFromGameInput,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireNodeMeta,
  type UpdateDecisionInput
} from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { parseRepertoirePgn } from "@chaturanga/shared/chess/repertoire-pgn";
import type { ImportProgressEvent } from "@chaturanga/shared/types/repertoire";
import { generateRepertoirePgn } from "./import-bench";
import { validateTree } from "./chapter-validation";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repertoire-test-"));
const sent: { channel: string; payload: unknown }[] = [];
const showSaveDialog = vi.fn(async (...args: unknown[]) => {
  void args;
  return { canceled: true, filePath: undefined as string | undefined };
});
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) => sent.push({ channel, payload })
        }
      }
    ],
    getFocusedWindow: () => null
  },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) }
}));

/**
 * Parses the next previews start are held here instead of running, while `holdParses` is set:
 * each settles only when the test resolves it, so a test can keep imports "running" for as long
 * as it needs without parsing a large input against the clock.
 */
const heldParses = vi.hoisted(() => ({
  hold: false,
  runs: [] as { resolve: () => void; cancelled: boolean }[]
}));
vi.mock("./import-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./import-runner")>();
  const { ImportCancelledError } = await import("./import-job");
  return {
    ...actual,
    startImportParse: (...args: Parameters<typeof actual.startImportParse>) => {
      if (!heldParses.hold) return actual.startImportParse(...args);
      let settle!: (outcome: Error | null) => void;
      const result = new Promise<{ games: [] }>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve({ games: [] }));
      });
      const run = { resolve: () => settle(null), cancelled: false };
      heldParses.runs.push(run);
      return {
        result,
        cancel: () => {
          run.cancelled = true;
          settle(new ImportCancelledError());
        }
      };
    }
  };
});

const { closeDb, databasePath, getDb } = await import("../db");
const service = await import("./service");
const { attemptRepository, progressRepository, decisionRepository, positionIndexRepository } =
  await import("./repository");
const core = await import("./core");

const DAY = 24 * 60 * 60_000;
let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);

afterAll(() => {
  service.setRepertoireClock();
  closeDb();
  rmSync(userData, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec("DELETE FROM repertoires");
  service.resetImportJobs();
  sent.length = 0;
  showSaveDialog.mockClear();
  now = 1_000_000_000_000;
});

/** A chapter tree built from UCI lines (shared prefixes become one path). */
function treeOf(rootFen: string, lines: string[][]): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: rootFen,
    fenAfter: rootFen,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  let next = 1;
  for (const line of lines) {
    let parent = root;
    for (const uci of line) {
      let child = parent.children
        .map((id) => tree.find((node) => node.id === id)!)
        .find((node) => node.uci === uci);
      if (!child) {
        const fen = fenAfterUci(parent.fenAfter, uci);
        if (!fen) throw new Error(`illegal ${uci}`);
        child = {
          id: `n${next++}`,
          parentId: parent.id,
          san: uci,
          uci,
          fenBefore: parent.fenAfter,
          fenAfter: fen,
          ply: parent.ply + 1,
          nags: [],
          comment: null,
          arrows: [],
          highlights: [],
          children: []
        };
        parent.children.push(child.id);
        tree.push(child);
      }
      parent = child;
    }
  }
  return tree;
}

/** The id of the node reached by `line` in `tree`. */
function nodeAt(tree: MoveNode[], line: string[]): MoveNode {
  let node = tree.find((item) => item.id === "root")!;
  for (const uci of line) {
    node = node.children
      .map((id) => tree.find((item) => item.id === id)!)
      .find((item) => item.uci === uci)!;
  }
  return node;
}

function create(color: RepertoireColor = "white", rootFen?: string) {
  return service.createRepertoire({ name: `My ${color} repertoire`, color, rootFen });
}

function save(
  repertoireId: string,
  lines: string[][],
  options: {
    chapterId?: string;
    kind?: "opening" | "reference";
    meta?: (tree: MoveNode[]) => Record<string, RepertoireNodeMeta>;
    rootFen?: string;
    enabled?: boolean;
    /** Authored comments, by the UCI line of the node they belong to (joined with spaces). */
    comments?: Record<string, string>;
  } = {}
) {
  const detail = service.getRepertoire(repertoireId);
  const existing = detail.chapters.find(
    (chapter) => chapter.id === (options.chapterId ?? detail.chapters[0]?.id)
  );
  const rootFen = options.rootFen ?? existing?.rootFen ?? START_FEN;
  const tree = treeOf(rootFen, lines);
  for (const [line, comment] of Object.entries(options.comments ?? {})) {
    nodeAt(tree, line ? line.split(" ") : []).comment = comment;
  }
  const chapter: RepertoireChapter = {
    id: options.chapterId ?? existing!.id,
    title: "Chapter",
    sortOrder: existing?.sortOrder ?? detail.chapters.length,
    kind: options.kind ?? "opening",
    enabled: options.enabled ?? true,
    rootFen,
    revision: existing?.revision ?? 0,
    nodeCount: 0,
    dueCount: 0,
    headers: {},
    tree,
    nodeMeta: options.meta?.(tree) ?? {}
  };
  return service.saveChapter({ repertoireId, chapter, expectedRevision: detail.revision });
}

const START_KEY = positionKey(START_FEN);

function learnFirst(repertoireId: string) {
  const session = service.startPractice({ repertoireId, mode: "learn-new" });
  return { session, card: session.cards[0] };
}

let attemptCounter = 0;
function attempt(
  sessionId: string,
  queueItemId: string,
  uci: string,
  attemptId = `a${++attemptCounter}`
) {
  return service.recordAttempt({ sessionId, queueItemId, uci, attemptId });
}

describe("repertoire service: chapters, decisions and index", () => {
  it("creates a repertoire with one root-only chapter and lists it", () => {
    const detail = create();
    expect(detail.revision).toBe(1);
    expect(detail.chapters).toHaveLength(1);
    expect(detail.chapters[0]).toMatchObject({ rootFen: START_FEN, nodeCount: 0, kind: "opening" });
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
    expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toEqual({
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

  it("an included own-side move makes exactly one decision with index rows", () => {
    const { id } = create();
    const result = save(id, [["e2e4", "e7e5"]]);
    expect(result.decisionsChanged).toBe(1);
    expect(result.repertoire.revision).toBe(2);
    expect(result.repertoire.decisionCount).toBe(1);
    expect(result.chapter.revision).toBe(2);
    expect(decisionRepository.list(id).map((decision) => decision.positionKey)).toEqual([
      START_KEY
    ]);
    const rows = positionIndexRepository.list(id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.isDecision).map((row) => row.nodeId)).toEqual(["root"]);
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
      positionIndexRepository.list(id).filter((row) => row.positionKey === shared && row.isDecision)
    ).toHaveLength(2);
    // Root (e4, d4), after 1.e4 e6, after 1.d4 e6, and the shared position.
    expect(second.repertoire.decisionCount).toBe(4);
    expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toEqual(["e2e4", "d2d4"]);
  });

  it("a reference chapter never produces decisions", () => {
    const { id } = create();
    const result = save(id, [["e2e4", "e7e5", "g1f3"]], { kind: "reference" });
    expect(result.repertoire.decisionCount).toBe(0);
    expect(decisionRepository.list(id)).toEqual([]);
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
    expect(decisionRepository.list(id)).toEqual([]);
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
    expect(decisionRepository.get(id, positionKey(fen))?.acceptedUcis).toEqual(["e1g1"]);
  });

  it("derives SAN from the move, keeps only numeric NAGs and stores a __proto__ node id", () => {
    const { id } = create();
    const detail = service.getRepertoire(id);
    const base = service.getChapter({ repertoireId: id, chapterId: detail.chapters[0].id });
    const tree = treeOf(START_FEN, [["e2e4", "e7e5"]]).map((node) =>
      node.id === "n2" ? { ...node, id: "__proto__" } : node
    );
    tree[0] = { ...tree[0], children: ["n1"] };
    tree[1] = { ...tree[1], san: "d4", nags: ["$1", "e5", "$1234"], children: ["__proto__"] };
    tree[2] = { ...tree[2], parentId: "n1" };
    const result = service.saveChapter({
      repertoireId: id,
      chapter: { ...base, tree, nodeMeta: JSON.parse('{"__proto__":{"edge":"reference"}}') },
      expectedRevision: detail.revision
    });
    expect(result.chapter.tree.map((node) => node.san)).toEqual([null, "e4", "e5"]);
    expect(result.chapter.tree[1].nags).toEqual(["$1"]);
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
    expect(result.chapter.headers).toEqual({ White: 'A [Black "B"]', Annotator: "Me" });
    expect(result.chapter.tree[1].arrows).toEqual([arrow("green")]);
    expect(result.chapter.tree[1].highlights).toEqual([]);
  });

  it("updates a decision: accepting selects an occurrence, removing makes it reference", () => {
    const { id } = create();
    const saved = save(id, [["e2e4"], ["d2d4"]], {
      meta: (tree) => ({ [nodeAt(tree, ["d2d4"]).id]: { edge: "reference" } })
    });
    expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toEqual(["e2e4"]);
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
    expect(service.getChapter({ repertoireId: id, chapterId }).nodeMeta[d4]).toEqual({
      edge: "included"
    });

    const removed = service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: accepted.repertoire.revision,
      patch: { acceptedUcis: ["e2e4"] }
    });
    expect(removed.decision).toMatchObject({ acceptedUcis: ["e2e4"], preferredUci: "e2e4" });
    expect(service.getChapter({ repertoireId: id, chapterId }).nodeMeta[d4]).toEqual({
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
    expect(progressRepository.list(copy.id)).toEqual([]);

    const archived = service.archiveRepertoire({
      id,
      archived: true,
      expectedRevision: saved.repertoire.revision
    });
    expect(archived.repertoire.archivedAt).toBe(now);
    expect(service.listRepertoires().map((item) => item.id)).toEqual([copy.id]);
    expect(service.listRepertoires({ archived: true }).map((item) => item.id)).toEqual([id]);
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
    expect(removed.repertoire.chapters).toEqual([]);
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
    expect(service.listRepertoires({ query: "SHARP" }).map((item) => item.id)).toEqual([id]);
    expect(service.listRepertoires({ query: "white" })).toEqual([]);
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
    expect(atLimit.tags).toEqual(tags.slice(0, limits.tags));
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
    expect(byId.get("c2")).toMatchObject({ enabled: false, revision: second.chapter.revision + 1 });
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
    expect(sent).toEqual([]);
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
    expect(sent.at(-1)).toMatchObject({ payload: { repertoireId: second.id, kind: "workspace" } });
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
    expect(service.getDueSummary().continue).toMatchObject({ chapterId: own.id, nodeId: "n1" });
  });

  it("offers the most recently updated unfinished session of an active repertoire to resume", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const other = create("black").id;
    save(other, [["e2e4", "e7e5"]]);
    const learn = service.startPractice({ repertoireId: id, mode: "learn-new" });
    expect(service.getDueSummary().resume).toEqual({
      repertoireId: id,
      sessionId: learn.sessionId,
      mode: "learn-new"
    });
    now += 1000;
    const rehearsal = service.startPractice({
      repertoireId: other,
      mode: "rehearse-lines",
      rehearse: { chapterId: service.getRepertoire(other).chapters[0].id }
    });
    expect(service.getDueSummary().resume).toEqual({
      repertoireId: other,
      sessionId: rehearsal.sessionId,
      mode: "rehearse-lines"
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
    expect(service.getDueSummary()).toEqual({
      dueCount: 0,
      repertoireCount: 0,
      continue: null,
      resume: null
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
    expect(service.getDueSummary()).toEqual({
      dueCount: 1,
      repertoireCount: 1,
      continue: { repertoireId: id, chapterId: saved.chapter.id, nodeId: "root" },
      resume: { repertoireId: id, sessionId: session.sessionId, mode: "learn-new" }
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

  it("lists every occurrence of a position with its chapter title and SAN path", () => {
    const { id } = create();
    expect(() => service.getOccurrences({ repertoireId: "nope", positionKey: START_KEY })).toThrow(
      "Invalid repertoireId: not found"
    );
    const first = save(id, [["e2e4", "e7e6", "d2d4", "d7d5"]]);
    const second = save(id, [["d2d4", "e7e6", "e2e4", "d7d5"]], { chapterId: "second" });
    const shared = positionKey(
      nodeAt(first.chapter.tree, ["e2e4", "e7e6", "d2d4", "d7d5"]).fenAfter
    );
    expect(service.getOccurrences({ repertoireId: id, positionKey: shared })).toEqual([
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
    expect(service.getOccurrences({ repertoireId: id, positionKey: "v1:nowhere" })).toEqual([]);
  });

  it("returns a repeated position within one chapter as two occurrences", () => {
    const { id } = create();
    const knights = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const saved = save(id, [knights]);
    const occurrences = service.getOccurrences({ repertoireId: id, positionKey: START_KEY });
    expect(occurrences.map((item) => [item.nodeId, item.path, item.ply])).toEqual([
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
    ).toEqual([expect.objectContaining({ nodeId: node.id, path: "1... e5 2. Nf3", ply: 3 })]);
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

const TWO_GAMES = `[Event "Italian"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "Scotch"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 (3. Bb5 a6) *
`;

describe("repertoire service: import and export", () => {
  it("previews and commits a two-game PGN as two chapters", async () => {
    const { id, revision } = create();
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    expect(preview.games.map((game) => game.proposedTitle)).toEqual(["Italian", "Scotch"]);
    const result = await service.commitImport({
      jobId: preview.jobId,
      repertoireId: id,
      expectedRevision: revision,
      selections: [
        { gameIndex: 0, title: "", kind: "opening", include: true },
        {
          gameIndex: 1,
          title: "Scotch Game",
          kind: "opening",
          include: true,
          excludeNodeIds: ["n6"]
        }
      ]
    });
    expect(result.chaptersAdded).toBe(2);
    expect(result.repertoire.chapters.map((chapter) => chapter.title)).toEqual([
      "My white repertoire",
      "Italian",
      "Scotch Game"
    ]);
    const scotch = service.getChapter({
      repertoireId: id,
      chapterId: result.repertoire.chapters[2].id
    });
    expect(scotch.nodeCount).toBe(5);
    expect(scotch.nodeMeta[scotch.tree[1].id]).toEqual({ edge: "included" });
    // Root (1.e4), after 1...e5 (2.Nf3), after 2...Nc6 (Bc4 from one chapter, d4 from the other).
    expect(result.repertoire.decisionCount).toBe(3);
    await expect(
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: 2,
        selections: []
      })
    ).rejects.toThrow(/Invalid jobId/);
  });

  it("cancelling leaves no rows, and a stale revision on commit writes nothing", async () => {
    const { id, revision } = create();
    const cancelled = await service.previewImport({ pgn: TWO_GAMES });
    service.cancelImport(cancelled.jobId);
    await expect(
      service.commitImport({
        jobId: cancelled.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).rejects.toThrow(/Invalid jobId/);
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    await expect(
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: revision + 1,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).rejects.toThrow("Invalid expectedRevision: repertoire changed (stored 1, expected 2)");
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM repertoire_chapters").get()).toEqual({
      n: 1
    });
    await expect(
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: false }]
      })
    ).rejects.toThrow(/choose at least one game/);
  });

  it("keeps only the newest import previews and refuses a game included twice", async () => {
    const { id, revision } = create();
    const first = await service.previewImport({ pgn: TWO_GAMES });
    for (let count = 0; count < 3; count++) await service.previewImport({ pgn: TWO_GAMES });
    const one = [{ gameIndex: 0, title: "", kind: "opening" as const, include: true }];
    await expect(
      service.commitImport({
        jobId: first.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: one
      })
    ).rejects.toThrow(/Invalid jobId/);
    const latest = await service.previewImport({ pgn: TWO_GAMES });
    await expect(
      service.commitImport({
        jobId: latest.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [...one, ...one]
      })
    ).rejects.toThrow(/included only once/);
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
  });

  /** The import progress events broadcast so far. */
  const progressEvents = () =>
    sent
      .filter((entry) => entry.channel === "repertoires:importProgress")
      .map((entry) => entry.payload as ImportProgressEvent);

  // The only difference: trees come validated in their stored form (castling as e1g1, not e1h1).
  it("previews what the synchronous parser gives, trees as stored (regression)", async () => {
    const fixtures = [
      TWO_GAMES,
      '[Event "Custom"]\n[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd6 *',
      '[Variant "Atomic"]\n\n1. e4 *\n\n[Event "Ok"]\n\n1. d4 d5 (1... Nf6 2. c4) 2. Ke3 *',
      generateRepertoirePgn({
        games: 30,
        movesPerGame: 10,
        variationsPerGame: 2,
        commentLength: 8
      }),
      // The illegal 4. Ke3 keeps this game's tree in the preview.
      "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O (4. c3 Nf6 5. O-O) (4. Ke3) 4... Nf6 $1 { [%clk 0:05:00] } *"
    ];
    const castled = (await service.previewImport({ pgn: fixtures.at(-1)! })).games[0].tree;
    expect(castled.filter((node) => node.san === "O-O").map((node) => node.uci)).toEqual([
      "e1g1",
      "e1g1"
    ]);
    for (const pgn of fixtures) {
      const preview = await service.previewImport({ pgn });
      const expected = parseRepertoirePgn(pgn).games.map((game) => ({
        index: game.index,
        proposedTitle: game.proposedTitle,
        rootFen: game.rootFen,
        headers: game.headers,
        nodeCount: game.nodeCount,
        // Only games with illegal branches carry their tree in the preview.
        tree: !game.invalidBranches.length
          ? []
          : game.rejected
            ? game.tree
            : validateTree(game.tree, game.rootFen),
        warnings: game.warnings,
        invalidBranches: game.invalidBranches
      }));
      expect(preview.games).toEqual(expected);
    }
  });

  it("broadcasts progress for the job, ending with ready", async () => {
    const pgn = generateRepertoirePgn({ games: 150, movesPerGame: 12 });
    const preview = await service.previewImport({ pgn });
    const events = progressEvents();
    expect(events.every((event) => event.jobId === preview.jobId)).toBe(true);
    expect(events[0]).toMatchObject({ phase: "reading", bytesRead: 0, error: null });
    expect(events.map((event) => event.phase)).toContain("parsing");
    expect(events.at(-1)).toEqual({
      jobId: preview.jobId,
      phase: "ready",
      bytesRead: Buffer.byteLength(pgn),
      totalBytes: Buffer.byteLength(pgn),
      gamesSeen: 150,
      nodesSeen: 150 * 12,
      error: null
    });
  });

  it("cancelling a running preview rejects it, broadcasts cancelled and writes nothing", async () => {
    const { id, revision } = create();
    const pgn = generateRepertoirePgn({ games: 900, movesPerGame: 12 });
    const pending = service.previewImport({ pgn });
    // The first event names the job; cancel once parsing is under way.
    // A 10 s ceiling, not vi.waitFor's 1 s: coverage on a CI runner slows the parse 2-4x.
    await vi.waitFor(
      () => expect(progressEvents().some((event) => event.phase === "parsing")).toBe(true),
      { timeout: 10_000 }
    );
    const jobId = progressEvents()[0].jobId;
    service.cancelImport(jobId);
    await expect(pending).rejects.toThrow("The import was cancelled.");
    const last = progressEvents().at(-1)!;
    expect(last).toMatchObject({ jobId, phase: "cancelled", error: null });
    expect(last.gamesSeen).toBeLessThan(900);
    await expect(
      service.commitImport({
        jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).rejects.toThrow(/Invalid jobId/);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM repertoire_chapters").get()).toEqual({
      n: 1
    });
  });

  it("a limit rejects the preview with its message and broadcasts failed", async () => {
    service.setImportLimits({ maxGames: 5 });
    try {
      const pgn = generateRepertoirePgn({ games: 400, movesPerGame: 6 });
      await expect(service.previewImport({ pgn })).rejects.toThrow(
        "This PGN has more than 5 games; one import can hold at most 5."
      );
      const last = progressEvents().at(-1)!;
      expect(last.phase).toBe("failed");
      expect(last.error).toMatch(/more than 5 games/);
      expect(last.bytesRead).toBeLessThan(Buffer.byteLength(pgn));
    } finally {
      service.setImportLimits();
    }
  });

  it("keeps at most three running or pending imports and never cancels a running one for room", async () => {
    // Held parses (see heldParses): the three stay running until released, whatever the machine.
    heldParses.hold = true;
    heldParses.runs.length = 0;
    try {
      const runs = [0, 1, 2].map(() => service.previewImport({ pgn: TWO_GAMES }));
      expect(heldParses.runs).toHaveLength(3);
      // A fourth, with three running, is refused; none of the running ones is cancelled for it.
      await expect(service.previewImport({ pgn: TWO_GAMES })).rejects.toThrow(
        "Another import is still parsing; wait or cancel it."
      );
      expect(heldParses.runs).toHaveLength(3);
      expect(heldParses.runs.some((run) => run.cancelled)).toBe(false);
      for (const run of heldParses.runs) run.resolve();
      await expect(Promise.all(runs)).resolves.toHaveLength(3);
    } finally {
      heldParses.hold = false;
    }
    expect(progressEvents().filter((event) => event.phase === "cancelled")).toHaveLength(0);
    expect(progressEvents().filter((event) => event.phase === "ready")).toHaveLength(3);
    // With the three previewed (none running), a new preview drops the oldest pending one.
    await expect(service.previewImport({ pgn: TWO_GAMES })).resolves.toBeTruthy();
  });

  it("refuses a commit over the move limit before writing anything", async () => {
    const { id, revision } = create();
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    service.setImportLimits({ maxNodes: 6 });
    try {
      await expect(
        service.commitImport({
          jobId: preview.jobId,
          repertoireId: id,
          expectedRevision: revision,
          selections: [
            { gameIndex: 0, title: "", kind: "opening", include: true },
            { gameIndex: 1, title: "", kind: "opening", include: true }
          ]
        })
      ).rejects.toThrow("The selected games have more than 6 moves; import them in parts.");
    } finally {
      service.setImportLimits();
    }
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
  });

  it("stores the same derived state as a full reindex (precomputed keys, writer path)", async () => {
    const { id, revision } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const pgn = generateRepertoirePgn({ games: 20, movesPerGame: 9, variationsPerGame: 3 });
    const preview = await service.previewImport({ pgn: TWO_GAMES + "\n" + pgn });
    await service.commitImport({
      jobId: preview.jobId,
      repertoireId: id,
      expectedRevision: revision + 1,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: "",
        kind: "opening" as const,
        include: true,
        excludeNodeIds: game.index === 1 ? ["n6"] : []
      }))
    });
    const stored = {
      decisions: decisionRepository.list(id),
      rows: positionIndexRepository.list(id)
    };
    expect(stored.rows.length).toBe(1 + 4 + 6 + 3 + 20 * 15 + 22);
    const { transaction } = await import("./repository");
    transaction(() => core.reindex(core.requireRepertoire(id), now));
    expect(decisionRepository.list(id)).toEqual(stored.decisions);
    expect(positionIndexRepository.list(id)).toEqual(stored.rows);
  });

  it("queues a chapter save behind a running import commit at the write gate, then runs it", async () => {
    const { id, revision } = create();
    const first = service.getRepertoire(id).chapters[0];
    const chapter = {
      ...service.getChapter({ repertoireId: id, chapterId: first.id }),
      tree: treeOf(START_FEN, [["e2e4"], ["d2d4"]]),
      nodeMeta: {}
    };
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    sent.length = 0;
    const commit = service.commitImport({
      jobId: preview.jobId,
      repertoireId: id,
      expectedRevision: revision,
      selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
    });
    // The import isn't stored yet: a direct save at its revision is refused...
    expect(() =>
      service.saveChapter({ repertoireId: id, chapter, expectedRevision: revision + 1 })
    ).toThrow(/Invalid expectedRevision/);
    // ...one through the write gate waits for the commit, then succeeds.
    const queued = service.withRepertoireWriteGate(() =>
      service.saveChapter({ repertoireId: id, chapter, expectedRevision: revision + 1 })
    );
    const [imported, saved] = await Promise.all([commit, queued]);
    expect(imported.repertoire.revision).toBe(revision + 1);
    expect(saved.repertoire.revision).toBe(revision + 2);
    expect(saved.repertoire.chapters).toHaveLength(2);
    const changes = sent.filter((entry) => entry.channel === "repertoires:changed");
    expect(changes.map((entry) => (entry.payload as { revision: number }).revision)).toEqual([
      revision + 1,
      revision + 2
    ]);
    // Nothing queued: a write runs and settles with its value.
    await expect(service.withRepertoireWriteGate(() => 42)).resolves.toBe(42);
  });

  it("runs gated writes one at a time across repertoires; a failure doesn't block the next", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = service.withRepertoireWriteGate(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first:end");
    });
    const failing = service.withRepertoireWriteGate(() => {
      order.push("failing");
      throw new Error("nope");
    });
    const busy = service.withRepertoireWriteGate(() => {
      throw Object.assign(new Error("database is locked"), { errcode: 5 });
    });
    const last = service.withRepertoireWriteGate(() => order.push("last"));
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    release();
    await first;
    await expect(failing).rejects.toThrow("nope");
    await expect(busy).rejects.toThrow("The repertoire database is busy; try again.");
    await last;
    expect(order).toEqual(["first:start", "first:end", "failing", "last"]);
  });

  // Bounded by SQLite's 1 s busy_timeout (a sleep, not CPU): a 15 s ceiling, not the 5 s
  // default, so a slow CI runner can't time it out.
  it("reads never take the write lock; a write finding it held fails with the busy error", async () => {
    const { id } = create();
    const { transaction } = await import("./repository");
    const other = new DatabaseSync(databasePath());
    try {
      // Another connection (as the import writer) holds the write lock.
      other.exec("BEGIN IMMEDIATE");
      const started = performance.now();
      expect(transaction(() => service.getRepertoire(id).name, "read")).toBe("My white repertoire");
      expect(performance.now() - started).toBeLessThan(200);
      expect(() => transaction(() => service.getRepertoire(id), "write")).toThrow(
        "The repertoire database is busy; try again."
      );
      other.exec("ROLLBACK");
      expect(transaction(() => service.getRepertoire(id).name, "write")).toBe(
        "My white repertoire"
      );
    } finally {
      if (other.isTransaction) other.exec("ROLLBACK");
      other.close();
    }
  }, 15_000);

  it("uses the caller's job id, refuses one in use, and cancels it at once", async () => {
    const preview = await service.previewImport({ pgn: TWO_GAMES, jobId: "job-1" });
    expect(preview.jobId).toBe("job-1");
    expect(progressEvents().every((event) => event.jobId === "job-1")).toBe(true);
    await expect(service.previewImport({ pgn: TWO_GAMES, jobId: "job-1" })).rejects.toThrow(
      "Invalid jobId: already in use"
    );

    sent.length = 0;
    const pending = service.previewImport({ pgn: TWO_GAMES, jobId: "job-2" });
    service.cancelImport("job-2");
    await expect(pending).rejects.toThrow("The import was cancelled.");
    const phases = progressEvents().map((event) => event.phase);
    expect(progressEvents().every((event) => event.jobId === "job-2")).toBe(true);
    expect(phases.at(-1)).toBe("cancelled");
    expect(phases).not.toContain("ready");
    expect(phases.filter((phase) => phase === "cancelled")).toHaveLength(1);
    // The id is free again, and an unknown id is ignored.
    expect(() => service.cancelImport("no-such-job")).not.toThrow();
    await expect(service.previewImport({ pgn: TWO_GAMES, jobId: "job-2" })).resolves.toMatchObject({
      jobId: "job-2"
    });
  });

  it("exports through the save dialog and writes only the picked file", async () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]]);
    const cancelled = await service.exportRepertoire({ repertoireId: id });
    expect(cancelled).toMatchObject({ chapterCount: 1, savedPath: null });
    expect(cancelled.pgn).toContain('[Event "Chapter"]');
    expect(showSaveDialog.mock.calls[0][0]).toMatchObject({
      defaultPath: "My white repertoire.pgn"
    });

    const target = join(userData, "out.pgn");
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });
    const written = await service.exportRepertoire({
      repertoireId: id,
      chapterIds: [saved.chapter.id]
    });
    expect(written.savedPath).toBe(target);
    expect(readFileSync(target, "utf8")).toBe(written.pgn);
    await expect(
      service.exportRepertoire({ repertoireId: id, chapterIds: ["nope"] })
    ).rejects.toThrow(/Invalid chapterIds/);
  });

  it("exports a promoted variation as the main line without changing the preferred move", async () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"], ["d2d4"]], {
      meta: (tree) =>
        Object.fromEntries(
          tree.filter((node) => node.parentId).map((node) => [node.id, { edge: "included" }])
        )
    });
    expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toMatchObject({
      acceptedUcis: ["e2e4", "d2d4"],
      preferredUci: "e2e4"
    });
    expect((await service.exportRepertoire({ repertoireId: id })).pgn).toContain(
      "1. e4 (1. d4) 1... e5 *"
    );

    // Promoting 1. d4 reorders the root's moves (what Study's Promote variation saves).
    const promoted = service.saveChapter({
      repertoireId: id,
      expectedRevision: saved.repertoire.revision,
      chapter: {
        ...saved.chapter,
        tree: saved.chapter.tree.map((node) =>
          node.id === "root" ? { ...node, children: [...node.children].reverse() } : node
        )
      }
    });
    expect(promoted.chapter.tree.find((node) => node.id === "root")!.children).toEqual(
      [...saved.chapter.tree.find((node) => node.id === "root")!.children].reverse()
    );
    expect((await service.exportRepertoire({ repertoireId: id })).pgn).toContain(
      "1. d4 (1. e4 e5) *"
    );
    // The trained answer is the decision's preference, not the authored order.
    expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toMatchObject({
      preferredUci: "e2e4"
    });
  });
});

describe("repertoire service: practice", () => {
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
    expect(review.cards.map((card) => [card.positionKey === START_KEY, card.stage])).toEqual([
      [true, "review"],
      [false, "new"]
    ]);
    expect(review.cards[1].leadUp.map((move) => move.uci)).toEqual(["e2e4", "e7e5"]);
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
    expect(session.cards.map((card) => card.positionKey)).toEqual([
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

  it("a wrong first answer lapses, and a correct retry doesn't promote", () => {
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
      // Still hidden: the card can be retried.
      acceptedUcis: [],
      preferredUci: null
    });
    expect(attempt(session.sessionId, card.queueItemId, "g1f3")).toMatchObject({
      outcome: "outside-repertoire",
      finalGrade: false,
      acceptedUcis: []
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
    expect(hints.map((hint) => hint.card.hintStage)).toEqual([1, 2, 3, 3]);
    expect(hints[0].revealed).toEqual({ ucis: [], preferredUci: null, explanation: null });
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
    expect(service.resumePractice(session.sessionId).shown).toEqual({
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
    expect(service.resumePractice(session.sessionId).shown).toBeUndefined();
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
    ).toEqual([[false, false]]);
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
    expect(replay).toEqual(first);
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
    expect(resumed.totals).toEqual({
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
    expect(service.endPractice(session.sessionId)).toEqual(summary);
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
    expect(() => attempt(session.sessionId, a.queueItemId, "e2e4")).toThrow(/has ended/);
  });

  it("resuming after an edit drops cards whose decision changed", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const session = service.startPractice({ repertoireId: id, mode: "learn-new" });
    save(id, [["e2e4", "e7e5", "b1c3"]]);
    const resumed = service.resumePractice(session.sessionId);
    expect(resumed.cards.map((card) => card.state)).toEqual(["unanswered", "skipped"]);
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
    expect(result.revealed?.ucis).toEqual(["e2e4"]);
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
    expect(progressRepository.get(id, START_KEY)).toEqual(progress);
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
    expect(targeted.scope.positionKeys).toEqual([START_KEY]);
    expect(service.resumePractice(targeted.sessionId).scope.positionKeys).toEqual([START_KEY]);
    expect(progressRepository.get(id, START_KEY)).toEqual(before);

    const result = attempt(targeted.sessionId, targeted.cards[0].queueItemId, "e2e4");
    expect(result.outcome).toBe("correct");
    expect(progressRepository.get(id, START_KEY)!.lapses).toBe(0);
  });

  it("gives out the explanation and the accepted moves' comments only with the answer", () => {
    const { id } = create();
    save(id, [["e2e4"], ["d2d4"]], {
      comments: { "": "Choose your centre pawn.", e2e4: "Open games.", d2d4: "  " }
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
    // A hint gives the hint only; a wrong answer only that move's feedback.
    expect(service.recordPracticeAction({ ...ids, action: { kind: "hint" } }).revealed).toEqual({
      ucis: [],
      preferredUci: null,
      explanation: "A king's pawn"
    });
    const wrong = attempt(session.sessionId, card.queueItemId, "d2d4");
    expect(wrong.feedback).toBe("Not 1.d4 here");
    expect(wrong).not.toHaveProperty("explanation");
    expect(wrong).not.toHaveProperty("moveComments");
    const revealed = service.recordPracticeAction({ ...ids, action: { kind: "reveal" } });
    expect(revealed.revealed).toEqual({
      ucis: ["e2e4"],
      preferredUci: "e2e4",
      explanation: "Choose your centre pawn.",
      moveComments: { e2e4: "Open games." }
    });
    expect(service.resumePractice(session.sessionId).shown?.revealed).toEqual(revealed.revealed);
    expect(attempt(session.sessionId, card.queueItemId, "e2e4")).toMatchObject({
      outcome: "correct",
      acceptedUcis: ["e2e4"],
      explanation: "Choose your centre pawn.",
      moveComments: { e2e4: "Open games." }
    });
  });

  it("a correct first answer comes with the explanation, the hint standing in for none", () => {
    const { id } = create();
    save(id, [["e2e4"]], { comments: { e2e4: "Open games." } });
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
    expect(retry.cards.map((card) => card.positionKey)).toEqual([START_KEY]);
    // A correct retry seconds after the miss doesn't jump the relearn step to stage 1.
    expect(attempt(retry.sessionId, retry.cards[0].queueItemId, "e2e4")).toMatchObject({
      outcome: "correct",
      finalGrade: true
    });
    expect(progressRepository.get(id, START_KEY)).toEqual(lapsed);
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
    expect(progressRepository.get(id, START_KEY)).toEqual(lapsed);
    expect(service.endPractice(again.sessionId)).toMatchObject({
      missed: 1,
      missedPositionKeys: [START_KEY]
    });

    // The first session's answers and summary are unchanged.
    expect(attemptRepository.list(first.sessionId)).toEqual(firstRows);
    expect(service.endPractice(first.sessionId)).toEqual(summary);
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
    expect(progressRepository.get(id, START_KEY)).toEqual(learned);

    const resumed = service.updateDecision({
      repertoireId: id,
      positionKey: START_KEY,
      expectedRevision: paused.repertoire.revision,
      patch: { paused: false }
    });
    expect(resumed.decision.paused).toBe(false);
    // Its first scored attempt and schedule are as they were: still a due review, not a new card.
    expect(progressRepository.get(id, START_KEY)).toEqual(learned);
    expect(resumed.repertoire).toMatchObject({ dueCount: 1, decisionCount: 2 });
    const review = service.startPractice({ repertoireId: id, mode: "review-due" });
    expect(review.cards.map((card) => [card.positionKey === START_KEY, card.stage])).toEqual([
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
    expect(write({ d2d4: " We play 1.e4 ", c2c4: "Not the English" })).toEqual({
      d2d4: "We play 1.e4",
      c2c4: "Not the English"
    });
    // Left out or blank: removed.
    expect(write({ d2d4: "We play 1.e4", c2c4: "   " })).toEqual({ d2d4: "We play 1.e4" });
    expect(write({})).toEqual({});
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
    expect(update({ acceptedUcis: ["e2e4", "d2d4"] }).wrongMoveFeedback).toEqual({
      d2d4: "We play 1.e4"
    });
    expect(() => update({ wrongMoveFeedback: { d2d4: "Changed" } })).toThrow(
      /"d2d4" is an accepted move/
    );
    expect(
      update({ wrongMoveFeedback: { d2d4: "We play 1.e4", c2c4: "Not the English" } })
        .wrongMoveFeedback
    ).toEqual({ c2c4: "Not the English" });
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
    expect(session.cards.map((card) => [card.positionKey, card.stage])).toEqual([
      [afterE5, "new"],
      [START_KEY, "new"]
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
    expect(inRepertoire.chaptersUsed.map((item) => item.chapterId)).toEqual([firstChapter, "c2"]);

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
    expect(deviation.moves.map((move) => move.status)).toEqual([
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
    expect(second.issue).toEqual(first.issue);
  });

  it("refuses an unknown repertoire or an illegal move; compares an archived repertoire", () => {
    const id = twoChapters();
    const game = { repertoireId: id, color: "white" as const, rootFen: START_FEN, moves: ["e2e4"] };
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

describe("repertoire service: add from a game", () => {
  const GAME_LINES = [["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]];

  function sourceOf(lines: string[][], gameId: string | null = null, rootFen = START_FEN) {
    return {
      gameId,
      headers: { White: "Alice", Black: "Bob", Event: "Club game" },
      rootFen,
      tree: treeOf(rootFen, lines),
      nodeId: null
    };
  }

  function input(
    repertoireId: string,
    source: ReturnType<typeof sourceOf>,
    overrides: Partial<AddFromGameInput> = {}
  ): AddFromGameInput {
    return {
      repertoireId,
      expectedRevision: service.getRepertoire(repertoireId).revision,
      destination: { kind: "new-chapter", title: "", chapterKind: "opening" },
      source,
      scope: { kind: "whole-game" },
      policy: { includedNodeIds: [], coveredNodeIds: [] },
      ...overrides
    };
  }

  /** Previews once for the default policy, then returns the input carrying it. */
  function withDefaults(base: AddFromGameInput): AddFromGameInput {
    return { ...base, policy: service.previewAddFromGame(base).defaultPolicy };
  }

  function insertLibraryGame(id: string) {
    getDb()
      .prepare(
        `INSERT INTO games (id, source, pgn, current_fen, move_tree_json, created_at, updated_at)
          VALUES (?, 'pgn-import', '', ?, '[]', 1, 1)`
      )
      .run(id, START_FEN);
  }

  it("adds a line as a new chapter with decisions and a source link", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const end = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3", "b8c6"]);
    const base = input(id, source, { scope: { kind: "path", toNodeId: end.id } });
    const preview = service.previewAddFromGame(base);
    expect(preview).toMatchObject({
      chapterTitle: "Alice – Bob",
      nodeCount: 4,
      decisionsAdded: 0,
      conflicts: [],
      alreadyPresent: 0
    });
    expect(preview.warnings).toEqual([
      "No moves are accepted: nothing from this material will be trained"
    ]);
    expect(preview.ownMoves.map((move) => move.path)).toEqual(["1. e4", "1. e4 e5 2. Nf3"]);
    expect(preview.defaultPolicy.includedNodeIds).toEqual([
      nodeAt(source.tree, ["e2e4"]).id,
      nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id
    ]);
    // The preview wrote nothing.
    expect(service.getRepertoire(id).chapters).toHaveLength(1);

    const confirmed = withDefaults(base);
    expect(service.previewAddFromGame(confirmed)).toMatchObject({
      decisionsAdded: 2,
      warnings: []
    });
    sent.length = 0;
    const result = service.addFromGame(confirmed);
    expect(result.repertoire.revision).toBe(base.expectedRevision + 1);
    expect(result.repertoire.chapters).toHaveLength(2);
    expect(result.repertoire.decisionCount).toBe(2);
    expect(result.chapter).toMatchObject({ title: "Alice – Bob", kind: "opening", nodeCount: 4 });
    expect(result.chapter.headers).toMatchObject({ White: "Alice", Black: "Bob" });
    expect(result.link).toMatchObject({
      repertoireId: id,
      chapterId: result.chapter.id,
      gameId: null,
      unsaved: true,
      gameNodeId: end.id,
      kind: "source",
      capturedPath: "1. e4 e5 2. Nf3 Nc6"
    });
    expect(service.listGameLinks({ repertoireId: id })).toEqual([result.link]);
    expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toEqual(["e2e4"]);
    expect(sent).toEqual([
      {
        channel: "repertoires:changed",
        payload: { repertoireId: id, revision: result.repertoire.revision, kind: "updated" }
      }
    ]);
  });

  it("reports a conflict and adds the move as an alternative without changing the preference", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const afterE5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "e2e4")!, "e7e5")!);
    const source = sourceOf([["e2e4", "e7e5", "f1c4"]]);
    const confirmed = withDefaults(
      input(id, source, {
        scope: { kind: "path", toNodeId: nodeAt(source.tree, ["e2e4", "e7e5", "f1c4"]).id }
      })
    );
    const preview = service.previewAddFromGame(confirmed);
    expect(preview.conflicts).toEqual([
      {
        positionKey: afterE5,
        fen: expect.any(String),
        existingUcis: ["g1f3"],
        preferredUci: "g1f3",
        newUci: "f1c4",
        newSan: "Bc4",
        path: "1. e4 e5"
      }
    ]);
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.transpositions).toBe(2);
    expect(preview.warnings).toEqual([
      "1 position already has another repertoire move: the new move is added as an alternative and your preferred move stays"
    ]);

    service.addFromGame(confirmed);
    expect(decisionRepository.get(id, afterE5)).toMatchObject({
      acceptedUcis: ["g1f3", "f1c4"],
      preferredUci: "g1f3"
    });
  });

  it("merges into an existing chapter, keeping its comments and counting present moves", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]]);
    const chapter = {
      ...saved.chapter,
      tree: saved.chapter.tree.map((node) =>
        node.uci === "e2e4" ? { ...node, comment: "mine" } : node
      )
    };
    const resaved = service.saveChapter({
      repertoireId: id,
      chapter,
      expectedRevision: saved.repertoire.revision
    });
    const source = sourceOf(GAME_LINES);
    source.tree = source.tree.map((node) =>
      node.uci === "e2e4" ? { ...node, comment: "theirs" } : node
    );
    const confirmed = withDefaults(
      input(id, source, {
        destination: { kind: "existing-chapter", chapterId: resaved.chapter.id },
        scope: { kind: "path", toNodeId: nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id }
      })
    );
    const preview = service.previewAddFromGame(confirmed);
    expect(preview).toMatchObject({ chapterTitle: "Chapter", nodeCount: 3, alreadyPresent: 2 });
    const result = service.addFromGame(confirmed);
    expect(result.repertoire.chapters).toHaveLength(1);
    expect(result.chapter.id).toBe(resaved.chapter.id);
    expect(result.chapter.nodeCount).toBe(3);
    expect(result.chapter.tree.find((node) => node.uci === "e2e4")?.comment).toBe("mine");

    // Merging the same line again adds nothing.
    const again = { ...confirmed, expectedRevision: result.repertoire.revision };
    expect(service.previewAddFromGame(again)).toMatchObject({ alreadyPresent: 3 });
    expect(service.addFromGame(again).chapter.nodeCount).toBe(3);

    const other = sourceOf([["e7e5"]], null, fenAfterUci(START_FEN, "d2d4")!);
    expect(() =>
      service.previewAddFromGame(
        input(id, other, {
          destination: { kind: "existing-chapter", chapterId: resaved.chapter.id }
        })
      )
    ).toThrow(/starts at a different position than the chapter/);
  });

  it("a null policy previews the defaults; adding requires an explicit policy", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const base = input(id, source, {
      scope: { kind: "subtree", fromNodeId: from.id, root: "original" },
      policy: null
    });
    const preview = service.previewAddFromGame(base);
    expect(preview).toEqual(service.previewAddFromGame({ ...base, policy: preview.defaultPolicy }));
    expect(preview.decisionsAdded).toBe(1);
    // Context moves (1. e4 e5 2. Nf3) are left out of both lists.
    expect(preview.opponentMoves.map((move) => move.path)).toEqual([
      "1. e4 e5 2. Nf3 Nc6",
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"
    ]);
    expect(preview.ownMoves.map((move) => move.path)).toEqual(["1. e4 e5 2. Nf3 Nc6 3. Bb5"]);
    expect(() => service.addFromGame(base)).toThrow(
      "Invalid policy: choose which moves to accept before adding"
    );
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
  });

  it("a stale revision writes nothing", () => {
    const { id } = create();
    const confirmed = withDefaults(
      input(id, sourceOf(GAME_LINES), {
        scope: { kind: "subtree", fromNodeId: "root", root: "original" }
      })
    );
    service.addFromGame(confirmed);
    sent.length = 0;
    expect(() => service.addFromGame(confirmed)).toThrow(/Invalid expectedRevision/);
    expect(service.getRepertoire(id).chapters).toHaveLength(2);
    expect(service.listGameLinks({ repertoireId: id })).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("the whole game as a reference chapter adds no decisions", () => {
    const { id } = create();
    const base = input(id, sourceOf(GAME_LINES), {
      destination: { kind: "new-chapter", title: "Model game", chapterKind: "reference" }
    });
    const preview = service.previewAddFromGame(base);
    expect(preview.defaultPolicy).toEqual({ includedNodeIds: [], coveredNodeIds: [] });
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.warnings).toEqual([
      "Whole game added as reference: nothing will be trained until you accept moves"
    ]);
    const result = service.addFromGame(base);
    expect(result.chapter).toMatchObject({ title: "Model game", kind: "reference", nodeCount: 6 });
    expect(result.repertoire.decisionCount).toBe(0);
    expect(result.link.capturedPath).toBe("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6");
  });

  it("a standalone Black-to-move subtree becomes a chapter rooted at that position", () => {
    const { id } = create("black");
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const confirmed = withDefaults(
      input(id, source, { scope: { kind: "subtree", fromNodeId: from.id, root: "standalone" } })
    );
    const result = service.addFromGame(confirmed);
    expect(result.chapter.rootFen).toBe(from.fenAfter);
    expect(result.chapter.tree.map((node) => node.ply)).toEqual([3, 4, 5, 6]);
    expect(result.repertoire.decisionCount).toBe(2);
  });

  it("refuses a policy naming context, unknown or wrong-side moves, and an unknown game", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const e4 = nodeAt(source.tree, ["e2e4"]).id;
    const e5 = nodeAt(source.tree, ["e2e4", "e7e5"]).id;
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id;
    const scope = { kind: "subtree" as const, fromNodeId: from, root: "original" as const };
    expect(() =>
      service.previewAddFromGame(
        input(id, source, { scope, policy: { includedNodeIds: [e4], coveredNodeIds: [] } })
      )
    ).toThrow(`Invalid policy: node "${e4}" is not part of the selected material`);
    expect(() =>
      service.previewAddFromGame(
        input(id, source, { policy: { includedNodeIds: [e5], coveredNodeIds: [] } })
      )
    ).toThrow(`Invalid policy: node "${e5}" is not a white move, so it can't be accepted`);
    expect(() =>
      service.previewAddFromGame(
        input(id, source, { policy: { includedNodeIds: [], coveredNodeIds: [e4] } })
      )
    ).toThrow(`Invalid policy: node "${e4}" is not an opponent move, so it can't be covered`);
    expect(() =>
      service.previewAddFromGame(input(id, source, { scope: { kind: "path", toNodeId: "zz" } }))
    ).toThrow('Invalid scope: node "zz" is not in the game');
    expect(() => service.previewAddFromGame(input(id, sourceOf(GAME_LINES, "missing")))).toThrow(
      "Invalid source gameId: the game is not in the library"
    );
    const broken = sourceOf(GAME_LINES);
    broken.tree[1] = { ...broken.tree[1], uci: "e2e5" };
    expect(() => service.previewAddFromGame(input(id, broken))).toThrow(
      /^Invalid source tree: node "n1" plays an illegal move/
    );
  });

  it("a new line merged into a chapter with a training start trains, and says what won't", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5", "g1f3"]], {
      meta: (tree) => ({
        [nodeAt(tree, ["e2e4", "e7e5", "g1f3"]).id]: { edge: "included", trainingStart: true }
      })
    });
    const source = sourceOf([["d2d4", "d7d5", "c2c4"]]);
    const confirmed = withDefaults(
      input(id, source, {
        destination: { kind: "existing-chapter", chapterId: saved.chapter.id },
        scope: { kind: "path", toNodeId: nodeAt(source.tree, ["d2d4", "d7d5", "c2c4"]).id }
      })
    );
    const preview = service.previewAddFromGame(confirmed);
    expect(preview.decisionsAdded).toBe(1);
    // 1. d4 starts the new line, so its own position isn't asked; 2. c4 is.
    expect(preview.warnings).toEqual([
      "1 chosen move won't be trained: the chapter's training starts after them"
    ]);
    const result = service.addFromGame(confirmed);
    const d4 = result.chapter.tree.find((node) => node.uci === "d2d4")!;
    expect(result.chapter.nodeMeta[d4.id]).toEqual({ edge: "included", trainingStart: true });
    const afterD5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "d2d4")!, "d7d5")!);
    expect(decisionRepository.get(id, afterD5)?.acceptedUcis).toEqual(["c2c4"]);
  });

  it("an opponent context move covers a matched reference edge so the branch trains", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]], {
      meta: (tree) => ({ [nodeAt(tree, ["e2e4", "e7e5"]).id]: { edge: "reference" } })
    });
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const confirmed = withDefaults(
      input(id, source, {
        destination: { kind: "existing-chapter", chapterId: saved.chapter.id },
        scope: { kind: "subtree", fromNodeId: from.id, root: "original" }
      })
    );
    expect(service.previewAddFromGame(confirmed).warnings).toEqual([]);
    const result = service.addFromGame(confirmed);
    const e5 = result.chapter.tree.find((node) => node.uci === "e7e5")!;
    expect(result.chapter.nodeMeta[e5.id]).toEqual({ edge: "covered" });
    const bb5 = result.chapter.tree.find((node) => node.uci === "f1b5")!;
    expect(decisionRepository.get(id, positionKey(bb5.fenBefore))?.acceptedUcis).toEqual(["f1b5"]);
  });

  it("warns about chosen moves below an own reference move it can't accept", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]], {
      meta: (tree) => ({ [nodeAt(tree, ["e2e4"]).id]: { edge: "reference" } })
    });
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const preview = service.previewAddFromGame(
      withDefaults(
        input(id, source, {
          destination: { kind: "existing-chapter", chapterId: saved.chapter.id },
          scope: { kind: "subtree", fromNodeId: from.id, root: "original" }
        })
      )
    );
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.warnings).toEqual([
      "None of the chosen moves will be trained: nothing from this material is asked",
      "1 chosen move won't be trained: Bb5 at 1. e4 e5 2. Nf3 Nc6 3. Bb5 is below an unaccepted move"
    ]);
  });

  it("warns when a whole game's chosen move is below an unticked one", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const nf3 = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id;
    const preview = service.previewAddFromGame(
      input(id, source, {
        destination: { kind: "new-chapter", title: "", chapterKind: "opening" },
        policy: { includedNodeIds: [nf3], coveredNodeIds: [] }
      })
    );
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.warnings).toEqual([
      "None of the chosen moves will be trained: nothing from this material is asked",
      "1 chosen move won't be trained: Nf3 at 1. e4 e5 2. Nf3 is below an unaccepted move"
    ]);
  });

  it("a re-supported stored move is no conflict and a suspended decision isn't counted as new", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5", "g1f3"]]);
    // 1. e4 and the 2. Nf3 decision lose their support; the stored choices stay.
    save(id, [["d2d4"]], { chapterId: saved.chapter.id });
    const afterE5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "e2e4")!, "e7e5")!);
    expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toEqual(["e2e4", "d2d4"]);
    expect(decisionRepository.get(id, afterE5)).toBeTruthy();
    const source = sourceOf([["e2e4", "e7e5", "g1f3"]]);
    const preview = service.previewAddFromGame(
      withDefaults(
        input(id, source, {
          scope: { kind: "path", toNodeId: nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id }
        })
      )
    );
    expect(preview.conflicts).toEqual([]);
    expect(preview.decisionsAdded).toBe(0);
  });

  it("keeps the link when the library game is deleted, and removes links on request", () => {
    const { id } = create();
    insertLibraryGame("game-1");
    const result = service.addFromGame(input(id, sourceOf(GAME_LINES, "game-1")));
    expect(result.link).toMatchObject({ gameId: "game-1", unsaved: false });
    getDb().exec("DELETE FROM games WHERE id = 'game-1'");
    const [link] = service.listGameLinks({ repertoireId: id, chapterId: result.chapter.id });
    expect(link).toMatchObject({
      id: result.link.id,
      gameId: null,
      unsaved: false,
      headers: { White: "Alice" }
    });
    expect(service.getChapter({ repertoireId: id, chapterId: result.chapter.id }).nodeCount).toBe(
      6
    );

    expect(() => service.listGameLinks({ repertoireId: id, chapterId: "nope" })).toThrow(
      "Invalid chapterId: not found"
    );
    expect(() => service.removeGameLink({ repertoireId: id, linkId: "nope" })).toThrow(
      "Invalid linkId: not found"
    );
    const revision = service.getRepertoire(id).revision;
    service.removeGameLink({ repertoireId: id, linkId: link.id });
    expect(service.listGameLinks({ repertoireId: id })).toEqual([]);
    expect(service.getRepertoire(id).revision).toBe(revision);
  });

  it("links a library game as model or played, once per kind, without a revision bump", () => {
    const { id, chapters, revision } = create();
    getDb()
      .prepare(
        `INSERT INTO games (id, source, white, black, pgn, current_fen, move_tree_json, headers_json,
          created_at, updated_at) VALUES ('game-2', 'pgn-import', 'Tal', 'Botvinnik', '', ?, '[]', ?, 1, 1)`
      )
      .run(
        START_FEN,
        JSON.stringify({ white: "Tal", black: "Botvinnik", eco: "B10", event: null })
      );
    const base = {
      repertoireId: id,
      chapterId: chapters[0].id,
      gameId: "game-2",
      gameNodeId: "n3",
      kind: "played" as const,
      capturedPath: "1. e4 c6"
    };
    sent.length = 0;
    const link = service.linkGame(base);
    expect(link).toMatchObject({
      ...base,
      headers: { White: "Tal", Black: "Botvinnik", ECO: "B10" }
    });
    expect(sent).toEqual([
      { channel: "repertoires:changed", payload: { repertoireId: id, revision, kind: "updated" } }
    ]);

    expect(service.linkGame(base)).toEqual(link);
    const moved = service.linkGame({
      ...base,
      chapterId: null,
      gameNodeId: null,
      capturedPath: ""
    });
    expect(moved).toEqual({ ...link, chapterId: null, gameNodeId: null, capturedPath: "" });
    const model = service.linkGame({ ...base, kind: "model" });
    expect(model.id).not.toBe(link.id);
    expect(
      service
        .listGameLinks({ repertoireId: id })
        .map((item) => item.id)
        .sort()
    ).toEqual([link.id, model.id].sort());
    expect(service.listGameLinks({ repertoireId: id })).toContainEqual(moved);
    expect(service.getRepertoire(id).revision).toBe(revision);

    expect(() => service.linkGame({ ...base, gameId: "missing" })).toThrow(
      "Invalid gameId: the game is not in the library"
    );
    expect(() => service.linkGame({ ...base, chapterId: "nope" })).toThrow(
      "Invalid chapterId: not found"
    );
    expect(() => service.linkGame({ ...base, repertoireId: "nope" })).toThrow(
      "Invalid repertoireId: not found"
    );
  });

  it("copies a played game's headers again when it is linked after it finished", () => {
    const { id, chapters } = create();
    const insertGame = getDb().prepare(
      `INSERT INTO games (id, source, white, black, pgn, current_fen, move_tree_json, headers_json,
        created_at, updated_at) VALUES ('game-3', 'engine-game', 'You', 'Stockfish', '', ?, '[]', ?, 1, 1)`
    );
    insertGame.run(START_FEN, JSON.stringify({ white: "You", black: "Stockfish", result: "*" }));
    const base = {
      repertoireId: id,
      chapterId: chapters[0].id,
      gameId: "game-3",
      gameNodeId: "n2",
      kind: "played" as const,
      capturedPath: "1. e4 c6"
    };
    const link = service.linkGame(base);
    expect(link.headers).toEqual({ White: "You", Black: "Stockfish", Result: "*" });

    getDb()
      .prepare("UPDATE games SET headers_json = ? WHERE id = 'game-3'")
      .run(JSON.stringify({ white: "You", black: "Stockfish", result: "1-0" }));
    const finished = service.linkGame(base);
    expect(finished).toEqual({
      ...link,
      headers: { White: "You", Black: "Stockfish", Result: "1-0" }
    });
    expect(service.listGameLinks({ repertoireId: id })).toEqual([finished]);
  });

  it("says a database from before played links needs a reset", () => {
    const { id, chapters } = create();
    getDb().exec(`DROP TABLE repertoire_game_links;
      CREATE TABLE repertoire_game_links (
        id TEXT PRIMARY KEY, repertoire_id TEXT NOT NULL, chapter_id TEXT, game_id TEXT,
        unsaved INTEGER NOT NULL DEFAULT 0, game_node_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('source', 'model')),
        headers_json TEXT NOT NULL DEFAULT '{}', captured_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL)`);
    getDb()
      .prepare(
        `INSERT INTO games (id, source, white, black, pgn, current_fen, move_tree_json, headers_json,
          created_at, updated_at) VALUES ('game-4', 'engine-game', 'You', 'Stockfish', '', ?, '[]', '{}', 1, 1)`
      )
      .run(START_FEN);
    const input = {
      repertoireId: id,
      chapterId: chapters[0].id,
      gameId: "game-4",
      gameNodeId: null,
      capturedPath: ""
    };
    expect(() => service.linkGame({ ...input, kind: "played" })).toThrow(
      "Invalid kind: this database predates played links; reset the development database"
    );
    expect(service.linkGame({ ...input, kind: "model" }).kind).toBe("model");
  });
});

describe("repertoire service: rehearse lines", () => {
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

  it("plays lines with authored replies, rotating to unseen branches, and never writes progress", () => {
    const { id, chapter } = setup();
    const tree = chapter.tree;
    const session = rehearse(id, chapter.id);
    const lineA = `line-${nodeAt(tree, LINES[0]).id}`;
    expect(session).toMatchObject({ status: "active", cursor: 0, mode: "rehearse-lines" });
    expect(session.scope.rehearse).toEqual({ chapterId: chapter.id });
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
    expect(first.rehearsal!.next!.leadUp.map((move) => move.uci)).toEqual(["e2e4", "c7c5"]);
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
    expect(last.rehearsal).toEqual({
      reply: null,
      next: null,
      lineComplete: true,
      endReason: "leaf"
    });
    const finished = service.resumePractice(session.sessionId);
    expect(finished).toMatchObject({ status: "finished", totals: { total: 9, correct: 9 } });
    expect(progressRepository.list(id)).toEqual([]);
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
    expect(progressRepository.list(id)).toEqual([]);
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
    expect(progressRepository.list(id)).toEqual([]);
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
    ).toEqual({
      card: expect.objectContaining({ queueItemId: "q1", state: "revealed" }),
      revealed: { ucis: ["e2e4"], preferredUci: "e2e4", explanation: null }
    });
    expect(
      service.recordPracticeAction({
        sessionId: session.sessionId,
        queueItemId: "q1",
        action: { kind: "skip" }
      })
    ).toEqual({ card: expect.objectContaining({ queueItemId: "q1", state: "revealed" }) });
    expect(current(session.sessionId).queueItemId).toBe("q2");
    expect(progressRepository.list(id)).toEqual([]);
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
    expect(session.cards[0].leadUp.map((move) => move.uci)).toEqual(["e2e4", "c7c5"]);
    expect(session.scope.rehearse).toEqual({ chapterId: chapter.id, fromNodeId: e4.id });

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
    expect(session.cards[0].leadUp.map((move) => move.uci)).toEqual(["e2e4", "c7c5"]);
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
    expect(attempt(session.sessionId, "q1", "e2e4").rehearsal).toEqual({
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
    expect(attempt(session.sessionId, "q1", "e2e4", "same-id")).toEqual(first);
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
    expect(resumed.cards.map((card) => card.state)).toEqual(["answered-correct", "skipped"]);
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
    expect(result).toEqual({
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
    expect(result).toEqual({
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
    expect(attempt(session.sessionId, "q2", "g1f3", "retry-id")).toEqual(result);
    expect(service.resumePractice(session.sessionId).status).toBe("finished");
  });
});
