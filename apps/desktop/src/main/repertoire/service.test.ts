import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";

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

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { attemptRepository, progressRepository, decisionRepository, positionIndexRepository } =
  await import("./repository");

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
  } = {}
) {
  const detail = service.getRepertoire(repertoireId);
  const existing = detail.chapters.find(
    (chapter) => chapter.id === (options.chapterId ?? detail.chapters[0]?.id)
  );
  const rootFen = options.rootFen ?? existing?.rootFen ?? START_FEN;
  const tree = treeOf(rootFen, lines);
  const chapter: RepertoireChapter = {
    id: options.chapterId ?? existing!.id,
    title: "Chapter",
    sortOrder: existing?.sortOrder ?? detail.chapters.length,
    kind: options.kind ?? "opening",
    enabled: options.enabled ?? true,
    rootFen,
    revision: 0,
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

  it("summarises due work and where to continue", () => {
    const { id } = create();
    const saved = save(id, [["e2e4"]]);
    expect(service.getDueSummary()).toEqual({ dueCount: 0, repertoireCount: 0, continue: null });
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
      continue: { repertoireId: id, chapterId: saved.chapter.id, nodeId: "root" }
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
    const result = service.commitImport({
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
    expect(() =>
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: 2,
        selections: []
      })
    ).toThrow(/Invalid jobId/);
  });

  it("cancelling leaves no rows, and a stale revision on commit writes nothing", async () => {
    const { id, revision } = create();
    const cancelled = await service.previewImport({ pgn: TWO_GAMES });
    service.cancelImport(cancelled.jobId);
    expect(() =>
      service.commitImport({
        jobId: cancelled.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).toThrow(/Invalid jobId/);
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    expect(() =>
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: revision + 1,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).toThrow("Invalid expectedRevision: repertoire changed (stored 1, expected 2)");
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM repertoire_chapters").get()).toEqual({
      n: 1
    });
    expect(() =>
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: false }]
      })
    ).toThrow(/choose at least one game/);
  });

  it("keeps only the newest import previews and refuses a game included twice", async () => {
    const { id, revision } = create();
    const first = await service.previewImport({ pgn: TWO_GAMES });
    for (let count = 0; count < 3; count++) await service.previewImport({ pgn: TWO_GAMES });
    const one = [{ gameIndex: 0, title: "", kind: "opening" as const, include: true }];
    expect(() =>
      service.commitImport({
        jobId: first.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: one
      })
    ).toThrow(/Invalid jobId/);
    const latest = await service.previewImport({ pgn: TWO_GAMES });
    expect(() =>
      service.commitImport({
        jobId: latest.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [...one, ...one]
      })
    ).toThrow(/included only once/);
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
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
});
