/**
 * The incremental reindex of one changed chapter (core.ts `reindexChapter`) against the full
 * rebuild it replaces: random edit sequences over small repertoires full of transpositions, each
 * edit's decisions, index rows and progress compared with what a full reindex makes of the same
 * starting state.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireEdgeKind
} from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { seededRandom } from "../../perf/large-repertoire";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-reindex-chapter-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: {}
}));

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const repository = await import("./repository");
const core = await import("./core");
const { chapterRepository, decisionRepository, positionIndexRepository, progressRepository } =
  repository;

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);

afterAll(() => {
  service.setRepertoireClock();
  closeDb();
  rmSync(userData, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec("DELETE FROM repertoires");
  now = 1_000_000_000_000;
});

/** Knight shuffles and a few central pawn moves: few positions, many transpositions. */
const MOVES = new Set([
  "g1f3",
  "b1c3",
  "f3g1",
  "c3b1",
  "g8f6",
  "b8c6",
  "f6g8",
  "c6b8",
  "e2e4",
  "d2d4",
  "e7e5",
  "d7d5"
]);

function legalUcis(fen: string): string[] {
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const ucis: string[] = [];
  for (const [from, dests] of position.allDests()) {
    for (const to of dests) {
      const uci = makeUci({ from, to });
      if (MOVES.has(uci)) ucis.push(uci);
    }
  }
  return ucis.sort();
}

function play(fen: string, uci: string): string {
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  position.play(parseUci(uci)!);
  return makeFen(position.toSetup());
}

type Random = () => number;
const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];

let nodeIds = 0;

/** Adds a random line of 1–4 moves below a random node (a new branch where it can). */
function addLine(random: Random, chapter: RepertoireChapter): RepertoireChapter {
  const tree = chapter.tree.map((node) => ({ ...node, children: [...node.children] }));
  const byId = new Map(tree.map((node) => [node.id, node]));
  let parent = pick(random, tree);
  const length = 1 + Math.floor(random() * 4);
  for (let step = 0; step < length && parent.ply < 10; step++) {
    const taken = new Set(parent.children.map((id) => byId.get(id)!.uci));
    const options = legalUcis(parent.fenAfter).filter((uci) => !taken.has(uci));
    if (!options.length) break;
    const uci = pick(random, options);
    const node: MoveNode = {
      id: `m${++nodeIds}`,
      parentId: parent.id,
      san: uci,
      uci,
      fenBefore: parent.fenAfter,
      fenAfter: play(parent.fenAfter, uci),
      ply: parent.ply + 1,
      nags: [],
      comment: null,
      arrows: [],
      highlights: [],
      children: []
    };
    if (random() < 0.3) parent.children.unshift(node.id);
    else parent.children.push(node.id);
    tree.push(node);
    byId.set(node.id, node);
    parent = node;
  }
  return { ...chapter, tree };
}

/** Deletes a random non-root node and everything below it. */
function deleteSubtree(random: Random, chapter: RepertoireChapter): RepertoireChapter {
  const candidates = chapter.tree.filter((node) => node.parentId !== null);
  if (!candidates.length) return chapter;
  const target = pick(random, candidates);
  const dropped = new Set([target.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const node of chapter.tree) {
      if (node.parentId && dropped.has(node.parentId) && !dropped.has(node.id)) {
        dropped.add(node.id);
        grew = true;
      }
    }
  }
  return {
    ...chapter,
    tree: chapter.tree
      .filter((node) => !dropped.has(node.id))
      .map((node) => ({ ...node, children: node.children.filter((id) => !dropped.has(id)) })),
    nodeMeta: Object.fromEntries(
      Object.entries(chapter.nodeMeta).filter(([id]) => !dropped.has(id))
    )
  };
}

const EDGES: RepertoireEdgeKind[] = ["included", "included", "reference", "covered"];

/** Changes a random node's training marks: its edge, or a start, stop or disabled flag. */
function setMarks(random: Random, chapter: RepertoireChapter): RepertoireChapter {
  const node = pick(random, chapter.tree);
  const current = chapter.nodeMeta[node.id] ?? { edge: "included" as const };
  const roll = random();
  const next = { ...current };
  if (roll < 0.55) next.edge = pick(random, EDGES);
  else if (roll < 0.7) next.trainingStart = !current.trainingStart || undefined;
  else if (roll < 0.85) next.trainingStop = !current.trainingStop || undefined;
  else next.disabled = !current.disabled || undefined;
  return { ...chapter, nodeMeta: { ...chapter.nodeMeta, [node.id]: next } };
}

function newChapter(random: Random, id: string, sortOrder: number): RepertoireChapter {
  let chapter: RepertoireChapter = {
    id,
    title: id,
    sortOrder,
    kind: "opening",
    enabled: true,
    rootFen: START_FEN,
    revision: 0,
    nodeCount: 0,
    dueCount: 0,
    headers: {},
    tree: [
      {
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
      }
    ],
    nodeMeta: {}
  };
  const lines = 1 + Math.floor(random() * 4);
  for (let line = 0; line < lines; line++) chapter = addLine(random, chapter);
  return chapter;
}

/** Everything the reindex derives for a repertoire (index rows without their revision tag). */
function derived(repertoireId: string) {
  return {
    decisions: decisionRepository.list(repertoireId),
    rows: positionIndexRepository.list(repertoireId),
    progress: progressRepository
      .list(repertoireId)
      .sort((a, b) => a.positionKey.localeCompare(b.positionKey))
  };
}

/** Puts back a snapshot of decisions and progress (a full reindex rewrites the index rows). */
function restoreDerived(repertoireId: string, snapshot: ReturnType<typeof derived>): void {
  const db = getDb();
  db.prepare("DELETE FROM repertoire_decisions WHERE repertoire_id = ?").run(repertoireId);
  db.prepare("DELETE FROM repertoire_progress WHERE repertoire_id = ?").run(repertoireId);
  for (const decision of snapshot.decisions) decisionRepository.upsert(decision, now);
  for (const progress of snapshot.progress) progressRepository.upsert(progress);
}

/**
 * Runs `edit` (one incremental write), then rebuilds the same starting state in full and checks
 * the two agree: the same decisions (accepted sets, preferences, fingerprints), index rows and
 * progress (suspension, fingerprints, due times), and the same `decisionsChanged`. The full
 * rebuild runs in a transaction that is rolled back, so the edit's own result is what stays.
 */
function expectSameAsFullReindex(repertoireId: string, edit: () => number | null): void {
  const before = derived(repertoireId);
  const decisionsChanged = edit();
  const incremental = derived(repertoireId);
  const db = getDb();
  db.exec("BEGIN");
  try {
    restoreDerived(repertoireId, before);
    const full = core.reindex(core.requireRepertoire(repertoireId), now);
    expect(incremental).toEqual(derived(repertoireId));
    if (decisionsChanged !== null) expect(decisionsChanged).toBe(full.decisionsChanged);
  } finally {
    db.exec("ROLLBACK");
  }
}

/**
 * Runs `update` (a decision edit) once with the full reindex in place of reindexPositions, in a
 * transaction that is rolled back, then checks the edit's real run gives the same derived state.
 * The caller runs it for real afterwards; a refused edit throws before anything is compared.
 */
function expectSameAsFullUpdate(repertoireId: string, update: () => unknown): void {
  const db = getDb();
  const positions = vi
    .spyOn(core, "reindexPositions")
    .mockImplementation((record, _keys, at) => core.reindex(record, at));
  let reference: ReturnType<typeof derived>;
  db.exec("BEGIN");
  try {
    update();
    reference = derived(repertoireId);
  } finally {
    db.exec("ROLLBACK");
    positions.mockRestore();
  }
  db.exec("BEGIN");
  try {
    update();
    expect(derived(repertoireId)).toEqual(reference);
  } finally {
    db.exec("ROLLBACK");
  }
}

/**
 * A full reindex of the current state changes nothing (the state every write leaves). Also checks
 * the one-chapter due count a save returns against the chapter list's.
 */
function expectFixpoint(repertoireId: string): void {
  for (const summary of chapterRepository.summaries(repertoireId, now + 3 * 86_400_000)) {
    expect(chapterRepository.dueCount(summary.id, now + 3 * 86_400_000)).toBe(summary.dueCount);
  }
  const state = derived(repertoireId);
  const db = getDb();
  db.exec("BEGIN");
  try {
    const full = core.reindex(core.requireRepertoire(repertoireId), now);
    expect(full).toEqual({ decisionsChanged: 0, progressChanged: false });
    expect(derived(repertoireId)).toEqual(state);
  } finally {
    db.exec("ROLLBACK");
  }
}

/** Gives a random supported decision progress, as a graded practice card would. */
function practise(random: Random, repertoireId: string): void {
  const supported = decisionRepository
    .list(repertoireId)
    .filter((decision) => decision.acceptanceFingerprint !== "");
  if (!supported.length) return;
  const decision = pick(random, supported);
  progressRepository.upsert({
    repertoireId,
    positionKey: decision.positionKey,
    stage: 1 + Math.floor(random() * 4),
    dueAt: now + Math.floor(random() * 10) * 86_400_000,
    lastAttemptAt: now,
    lapses: 0,
    unaidedSuccesses: 1,
    acceptanceFingerprint: decision.acceptanceFingerprint,
    schedulerVersion: 1,
    suspended: false
  });
}

function runSequence(seed: number, color: RepertoireColor, steps: number): void {
  const random = seededRandom(seed);
  const created = service.createRepertoire({ name: `Seed ${seed}`, color });
  const id = created.id;
  let revision = created.revision;
  let chapterCount = 0;
  const saveChapter = (chapter: RepertoireChapter) => {
    const result = service.saveChapter({ repertoireId: id, expectedRevision: revision, chapter });
    revision = result.repertoire.revision;
    return result.decisionsChanged;
  };
  const chapters = () => chapterRepository.list(id);

  // A few chapters sharing the start position and many transpositions.
  saveChapter(addLine(random, addLine(random, chapters()[0])));
  for (let index = 0; index < 3; index++) {
    saveChapter(newChapter(random, `c${seed}-${++chapterCount}`, index + 1));
  }

  for (let step = 0; step < steps; step++) {
    now += 60_000;
    const roll = random();
    const chapter = pick(random, chapters());
    if (roll < 0.06) {
      practise(random, id);
    } else if (roll < 0.2) {
      // A decision edit: drop or restore accepted moves (edges change: full reindex), or change
      // only the decision (its position alone is reconciled).
      const decisions = decisionRepository.list(id);
      if (decisions.length) {
        const decision = pick(random, decisions);
        const accepted = decision.acceptedUcis.filter(() => random() < 0.7);
        const kind = random();
        const patch =
          kind < 0.3
            ? { acceptedUcis: accepted }
            : kind < 0.55
              ? { preferredUci: accepted[0] ?? null }
              : kind < 0.8
                ? { prompt: `Prompt ${step}`, hint: random() < 0.5 ? null : "A hint" }
                : { paused: !decision.paused };
        const update = () =>
          service.updateDecision({
            repertoireId: id,
            expectedRevision: revision,
            positionKey: decision.positionKey,
            patch
          });
        try {
          expectSameAsFullUpdate(id, update);
          revision = update().repertoire.revision;
        } catch (error) {
          // Refused (e.g. a move with no occurrence left): nothing was written.
          if (!(error instanceof Error) || !error.message.startsWith("Invalid ")) throw error;
        }
      }
    } else if (roll < 0.25 && chapters().length > 1) {
      expectSameAsFullReindex(id, () => {
        revision = service.removeChapter({
          repertoireId: id,
          expectedRevision: revision,
          chapterId: chapter.id
        }).repertoire.revision;
        return null;
      });
    } else if (roll < 0.3) {
      const added = newChapter(random, `c${seed}-${++chapterCount}`, Math.floor(random() * 6));
      expectSameAsFullReindex(id, () => saveChapter(added));
    } else {
      const edits: ((value: RepertoireChapter) => RepertoireChapter)[] = [
        (value) => addLine(random, value),
        (value) => addLine(random, value),
        (value) => deleteSubtree(random, value),
        (value) => setMarks(random, value),
        (value) => setMarks(random, value),
        (value) => ({ ...value, enabled: !value.enabled }),
        (value) => ({ ...value, kind: value.kind === "opening" ? "reference" : "opening" }),
        (value) => ({ ...value, sortOrder: Math.floor(random() * 6) }),
        (value) => ({
          ...value,
          title: `${value.title}!`,
          tree: value.tree.map((node, index) =>
            index === 0 ? { ...node, comment: `step ${step}` } : node
          )
        })
      ];
      const edited = pick(random, edits)(chapter);
      expectSameAsFullReindex(id, () => saveChapter(edited));
    }
    expectFixpoint(id);
  }
}

describe("reindexChapter", () => {
  it.each([
    [1, "white"],
    [2, "black"],
    [3, "white"],
    [4, "black"],
    [5, "white"],
    [6, "black"]
  ] as const)("matches a full reindex across random edits (seed %i, %s)", (seed, color) => {
    runSequence(seed, color, 120);
  });

  it("doesn't rebuild the whole repertoire for a comment-only or one-move save", () => {
    const created = service.createRepertoire({ name: "Spied", color: "white" });
    const random = seededRandom(7);
    let revision = created.revision;
    const save = (chapter: RepertoireChapter) => {
      const result = service.saveChapter({
        repertoireId: created.id,
        expectedRevision: revision,
        chapter
      });
      revision = result.repertoire.revision;
      return result;
    };
    save(addLine(random, chapterRepository.get(created.chapters[0].id)!));
    save(newChapter(random, "second", 1));
    const chapter = chapterRepository.get("second")!;

    const fullReindex = vi.spyOn(core, "reindex");
    const listChapters = vi.spyOn(chapterRepository, "list");
    const replaceIndex = vi.spyOn(positionIndexRepository, "replace");
    const replaceChapterRows = vi.spyOn(positionIndexRepository, "replaceChapter");
    try {
      const commented = save({
        ...chapter,
        title: "Renamed",
        tree: chapter.tree.map((node) => ({ ...node, comment: "A note", nags: ["$1"] }))
      });
      expect(commented.decisionsChanged).toBe(0);
      expect(commented.chapter.title).toBe("Renamed");
      // Nothing the index reads changed: no full rebuild and not even the chapter's rows.
      expect(fullReindex).not.toHaveBeenCalled();
      expect(listChapters).not.toHaveBeenCalled();
      expect(replaceIndex).not.toHaveBeenCalled();
      expect(replaceChapterRows).not.toHaveBeenCalled();

      save(addLine(random, commented.chapter));
      // A structural save rewrites only this chapter's rows.
      expect(fullReindex).not.toHaveBeenCalled();
      expect(listChapters).not.toHaveBeenCalled();
      expect(replaceIndex).not.toHaveBeenCalled();
      expect(replaceChapterRows).toHaveBeenCalledTimes(1);
    } finally {
      fullReindex.mockRestore();
      listChapters.mockRestore();
      replaceIndex.mockRestore();
      replaceChapterRows.mockRestore();
    }
    expectFixpoint(created.id);
  });

  it("reconciles only the decision's position for a decision-only edit", () => {
    const created = service.createRepertoire({ name: "Decision", color: "white" });
    const random = seededRandom(10);
    let revision = service.saveChapter({
      repertoireId: created.id,
      expectedRevision: created.revision,
      chapter: addLine(random, addLine(random, chapterRepository.get(created.chapters[0].id)!))
    }).repertoire.revision;
    revision = service.saveChapter({
      repertoireId: created.id,
      expectedRevision: revision,
      chapter: newChapter(random, "other", 1)
    }).repertoire.revision;
    const root = decisionRepository.list(created.id)[0];

    const fullReindex = vi.spyOn(core, "reindex");
    const listChapters = vi.spyOn(chapterRepository, "list");
    try {
      const prompted = service.updateDecision({
        repertoireId: created.id,
        expectedRevision: revision,
        positionKey: root.positionKey,
        patch: { prompt: "What now?", paused: true }
      });
      expect(prompted.decision).toMatchObject({ prompt: "What now?", paused: true });
      // Clearing the preference: reconciliation fills in the first supported choice again.
      const cleared = service.updateDecision({
        repertoireId: created.id,
        expectedRevision: prompted.repertoire.revision,
        positionKey: root.positionKey,
        patch: { preferredUci: null }
      });
      expect(cleared.decision.preferredUci).toBe(root.preferredUci);
      expect(fullReindex).not.toHaveBeenCalled();
      expect(listChapters).not.toHaveBeenCalled();
    } finally {
      fullReindex.mockRestore();
      listChapters.mockRestore();
    }
    expectFixpoint(created.id);
  });

  it("falls back to the full reindex when the stored index doesn't cover the chapter", () => {
    const created = service.createRepertoire({ name: "Stale", color: "white" });
    const random = seededRandom(8);
    const saved = service.saveChapter({
      repertoireId: created.id,
      expectedRevision: created.revision,
      chapter: addLine(random, chapterRepository.get(created.chapters[0].id)!)
    });
    // An index from an older key version (or none at all) can't seed an incremental update.
    getDb()
      .prepare(
        "UPDATE repertoire_position_index SET key_version = key_version - 1 WHERE chapter_id = ?"
      )
      .run(saved.chapter.id);
    const replaceIndex = vi.spyOn(positionIndexRepository, "replace");
    try {
      service.saveChapter({
        repertoireId: created.id,
        expectedRevision: saved.repertoire.revision,
        chapter: addLine(random, saved.chapter)
      });
      expect(replaceIndex).toHaveBeenCalledTimes(1);
    } finally {
      replaceIndex.mockRestore();
    }
    expectFixpoint(created.id);
  });

  it("treats only index inputs as changes (sameIndexInputs)", () => {
    const random = seededRandom(9);
    const chapter = newChapter(random, "same", 0);
    const child = chapter.tree[0].children[0];
    expect(core.sameIndexInputs(chapter, { ...chapter, title: "Other", headers: { A: "b" } })).toBe(
      true
    );
    expect(
      core.sameIndexInputs(chapter, {
        ...chapter,
        tree: chapter.tree.map((node) => ({
          ...node,
          comment: "c",
          nags: ["$2"],
          arrows: [{ orig: "e2", dest: "e4", color: "green" }],
          san: "x"
        }))
      })
    ).toBe(true);
    expect(core.sameIndexInputs(chapter, { ...chapter, enabled: false })).toBe(false);
    expect(core.sameIndexInputs(chapter, { ...chapter, kind: "reference" })).toBe(false);
    expect(core.sameIndexInputs(chapter, { ...chapter, sortOrder: 3 })).toBe(false);
    expect(core.sameIndexInputs(chapter, addLine(random, chapter))).toBe(false);
    expect(
      core.sameIndexInputs(chapter, {
        ...chapter,
        nodeMeta: { ...chapter.nodeMeta, [child]: { edge: "reference" } }
      })
    ).toBe(false);
    expect(
      core.sameIndexInputs(
        { ...chapter, nodeMeta: { [child]: { edge: "included" } } },
        { ...chapter, nodeMeta: { [child]: { edge: "included", trainingStop: true } } }
      )
    ).toBe(false);
    expect(
      core.sameIndexInputs(
        { ...chapter, nodeMeta: { [child]: { edge: "included", disabled: false } } },
        { ...chapter, nodeMeta: { [child]: { edge: "included" } } }
      )
    ).toBe(true);
  });
});
