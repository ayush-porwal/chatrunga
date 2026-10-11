/**
 * Large-collection benchmark for repertoires (design §11). `RUN_PERF=1` runs it at full size
 * (100 repertoires, 1,000 chapters, ~100,000 occurrences, a 5,000-move chapter, a 300-ply game
 * and a 100,000-move PGN) and prints p50/p95 per workload against the §11 targets; `PERF_OUT`
 * also writes the results as JSON. Without `RUN_PERF` it runs at tiny sizes as a smoke test, so
 * the harness stays working in CI. Run it with `node scripts/bench-repertoire.mjs`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir, totalmem, type, release, arch } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  buildChapterLookup,
  collectDecisions,
  computeScopeStates
} from "@chaturanga/shared/chess/repertoire-index";
import { compareGameToRepertoire } from "@chaturanga/shared/chess/repertoire-compare";
import { exportRepertoirePgn } from "@chaturanga/shared/chess/repertoire-pgn";
import { buildTreeModel } from "../renderer/src/features/game/move-tree-model";
import {
  collapseStudyTree,
  COLLAPSE_DEPTH,
  expandPathTo,
  subtreeSizes
} from "../renderer/src/features/repertoire/study-tree-model";
import {
  extendLeaf,
  generateChapter,
  generateGame,
  seededRandom,
  type TreeShape
} from "./large-repertoire";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repertoire-perf-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData, getName: () => "Chaturanga", getVersion: () => "0.0.0" },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: {}
}));

const { closeDb } = await import("../main/db");
const service = await import("../main/repertoire/service");
const { chapterRepository, decisionRepository, positionIndexRepository, transaction } =
  await import("../main/repertoire/repository");
const { reindex, requireRepertoire } = await import("../main/repertoire/core");
const { backupDocument, backupEntryOf } = await import("../main/repertoire/backup-restore");
const { stripForExport } = await import("@chaturanga/shared/chess/repertoire-backup");

/** Builds the derived state of a repertoire seeded straight through the repository. */
function reindexSeeded(repertoireId: string): void {
  transaction(() => reindex(requireRepertoire(repertoireId), Date.now()));
}
const { importPreviewFromText, runImport } = await import("../main/repertoire/import-job");

const FULL = process.env.RUN_PERF === "1";
const SIZE = FULL
  ? {
      repertoires: 100,
      chaptersPer: 10,
      movesPerChapter: 100,
      bigChapter: 5000,
      gamePlies: 300,
      importChapters: 1000,
      singleChapters: 500,
      singleMoves: 100,
      runs: 30
    }
  : {
      repertoires: 3,
      chaptersPer: 3,
      movesPerChapter: 20,
      bigChapter: 200,
      gamePlies: 40,
      importChapters: 10,
      singleChapters: 12,
      singleMoves: 20,
      runs: 3
    };

/** Runs of the workloads timed whole, once each (the import parse, a restore). */
const REPEATS = FULL ? 3 : 1;

const SMALL_SHAPE = (nodes: number): TreeShape => ({
  nodes,
  mainline: Math.min(24, nodes),
  meanLine: 6,
  maxDepth: 40
});
const BIG_SHAPE = (nodes: number): TreeShape => ({
  nodes,
  mainline: 40,
  meanLine: 10,
  maxDepth: 80
});

type Stat = { name: string; p50: number; p95: number; max: number; runs: number };
const results: Stat[] = [];
const facts: Record<string, number | string> = {};

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Times `run` (after one warm-up call) and records p50/p95/max in milliseconds. */
function measure(name: string, run: () => unknown, runs = SIZE.runs): Stat {
  run();
  const times: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const stat = {
    name,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    max: times[times.length - 1],
    runs
  };
  results.push(stat);
  return stat;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * An event-loop probe: the longest gap between two of its turns is the longest task that blocked
 * the loop meanwhile. `stop` waits one more turn so the synchronous tail of the work is counted.
 */
function probeEventLoop(): { stop: () => Promise<number> } {
  let probing = true;
  let lastTick = performance.now();
  let longest = 0;
  const tick = () => {
    const at = performance.now();
    longest = Math.max(longest, at - lastTick);
    lastTick = at;
    if (probing) setImmediate(tick);
  };
  setImmediate(tick);
  return {
    stop: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      probing = false;
      return longest;
    }
  };
}

/** Prints the results table (and writes it as JSON to `PERF_OUT` when set). */
function reportResults(): void {
  const machine = `${type()} ${release()} ${arch()}, ${cpus()[0]?.model ?? "?"} × ${cpus().length}, ${Math.round(totalmem() / 2 ** 30)} GiB, Node ${process.version}`;
  const lines = [
    `Repertoire benchmark (${FULL ? "full size" : "smoke size"}) — ${machine}`,
    "| Workload | p50 ms | p95 ms | max ms | runs |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...results.map(
      (stat) =>
        `| ${stat.name} | ${round(stat.p50)} | ${round(stat.p95)} | ${round(stat.max)} | ${stat.runs} |`
    ),
    "",
    ...Object.entries(facts).map(([key, value]) => `- ${key}: ${value}`)
  ];
  console.log(lines.join("\n"));
  if (process.env.PERF_OUT) {
    writeFileSync(
      process.env.PERF_OUT,
      JSON.stringify({ machine, full: FULL, results, facts }, null, 2)
    );
  }
}

type RepertoireDetail = ReturnType<typeof service.createRepertoire>;

/**
 * Generates a new repertoire's chapters, one per shape, and stores them as the app would: the
 * first takes the place of the repertoire's own first chapter and is saved through the service
 * (after the others go straight to the repository and the repertoire is reindexed).
 */
function seedChapters(
  random: () => number,
  detail: RepertoireDetail,
  plan: { shapes: readonly TreeShape[]; idPrefix: string }
): { chapters: RepertoireChapter[]; saved: ReturnType<typeof service.saveChapter> } {
  const [firstShape, ...otherShapes] = plan.shapes;
  const chapterAt = (shape: TreeShape, c: number, id: string) =>
    generateChapter(random, shape, {
      id,
      title: `Chapter ${c + 1}`,
      sortOrder: c,
      color: detail.color
    });
  const chapters = [chapterAt(firstShape, 0, detail.chapters[0].id)];
  otherShapes.forEach((shape, index) => {
    const c = index + 1;
    const chapter = chapterAt(shape, c, `${plan.idPrefix}${c}`);
    chapters.push(chapter);
    chapterRepository.upsert(detail.id, chapter, Date.now());
  });
  reindexSeeded(detail.id);
  const saved = service.saveChapter({
    repertoireId: detail.id,
    chapter: chapters[0],
    expectedRevision: detail.revision
  });
  return { chapters, saved };
}

/**
 * The benchmark's collection: repertoires of alternating colour, each with small chapters; the
 * first chapter of the first repertoire is the large one.
 */
function seedCollection(random: () => number): Map<string, RepertoireChapter[]> {
  const chaptersByRepertoire = new Map<string, RepertoireChapter[]>();
  for (let r = 0; r < SIZE.repertoires; r++) {
    const color = r % 2 ? "black" : "white";
    const detail = service.createRepertoire({ name: `Repertoire ${r + 1}`, color });
    const shapes = Array.from({ length: SIZE.chaptersPer }, () =>
      SMALL_SHAPE(SIZE.movesPerChapter)
    );
    if (r === 0) shapes[0] = BIG_SHAPE(SIZE.bigChapter);
    const { chapters, saved } = seedChapters(random, detail, { shapes, idPrefix: `r${r}c` });
    chapters[0] = saved.chapter;
    chaptersByRepertoire.set(detail.id, chapters);
  }
  return chaptersByRepertoire;
}

/** The node at the greatest ply (the first such in lookup order). */
function deepestNode(lookup: ReturnType<typeof buildChapterLookup>): string {
  const plyOf = (id: string) => lookup.nodesById.get(id)!.ply;
  return lookup.order.reduce((best, id) => (plyOf(id) > plyOf(best) ? id : best));
}

/** The tree with the root's comment replaced. */
function withRootComment(tree: readonly RepertoireChapter["tree"][number][], comment: string) {
  return tree.map((node) => (node.id === "root" ? { ...node, comment } : node));
}

describe("repertoire performance (design §11)", { timeout: 600_000 }, () => {
  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
    reportResults();
  });

  const random = seededRandom(20261003);
  const repertoireIds: string[] = [];
  const chaptersByRepertoire = new Map<string, RepertoireChapter[]>();
  let bigChapter: RepertoireChapter;

  it("seeds a representative collection through the real repository", () => {
    const started = performance.now();
    for (const [id, chapters] of seedCollection(random)) {
      repertoireIds.push(id);
      chaptersByRepertoire.set(id, chapters);
    }
    bigChapter = chaptersByRepertoire.get(repertoireIds[0])![0];
    const occurrences = [...chaptersByRepertoire.values()]
      .flat()
      .reduce((sum, chapter) => sum + chapter.tree.length, 0);
    facts["repertoires"] = SIZE.repertoires;
    facts["chapters"] = SIZE.repertoires * SIZE.chaptersPer;
    facts["occurrences (tree nodes, roots included)"] = occurrences;
    facts["largest chapter (moves)"] = bigChapter.tree.length - 1;
    facts["seeding (generate + save + reindex), s"] = round((performance.now() - started) / 1000);
    expect(service.listRepertoires()).toHaveLength(SIZE.repertoires);
  });

  it("opens a warm large chapter: load, lookup, scope states, collapsed tree model", () => {
    const repertoireId = repertoireIds[0];
    const chapterId = bigChapter.id;
    const load = measure("Chapter open: SQLite load + JSON parse (getChapter)", () =>
      service.getChapter({ repertoireId, chapterId })
    );
    const lookupStat = measure("Chapter open: buildChapterLookup", () =>
      buildChapterLookup(bigChapter)
    );
    const lookup = buildChapterLookup(bigChapter);
    const scope = measure("Chapter open: computeScopeStates", () =>
      computeScopeStates(bigChapter, lookup)
    );
    const sizes = subtreeSizes(lookup);
    const collapse = measure("Chapter open: subtreeSizes + collapseStudyTree", () =>
      collapseStudyTree(lookup, {
        expanded: new Set(),
        sizes: subtreeSizes(lookup)
      })
    );
    const collapsed = collapseStudyTree(lookup, {
      expanded: new Set(),
      sizes
    });
    measure("Tree model of every move (buildTreeModel, uncollapsed)", () =>
      buildTreeModel(bigChapter.tree)
    );
    const modelCollapsed = measure("Tree model of the collapsed tree (buildTreeModel)", () =>
      buildTreeModel(collapsed.nodes)
    );
    const total = load.p95 + lookupStat.p95 + scope.p95 + collapse.p95 + modelCollapsed.p95;
    facts["chapter open, sum of p95 steps (target < 300 ms)"] = round(total);

    // Selecting a deep node: the path is expanded, the model recomputed.
    const deepest = deepestNode(lookup);
    measure("Select a deep node: collapseStudyTree + buildTreeModel", () =>
      buildTreeModel(
        collapseStudyTree(lookup, { expanded: expandPathTo(new Set(), lookup, deepest), sizes })
          .nodes
      )
    );

    for (const depth of [4, COLLAPSE_DEPTH, 8, 12]) {
      const visible = collapseStudyTree(lookup, {
        expanded: new Set(),
        depth,
        sizes
      });
      facts[`visible tree rows at collapse depth ${depth}`] =
        `${visible.nodes.length} (${visible.placeholders.size} "more moves" rows)`;
    }
    facts["visible tree rows uncollapsed"] = bigChapter.tree.length;
    expect(collapsed.nodes.length).toBeLessThanOrEqual(bigChapter.tree.length);
  });

  it("collects decisions over every chapter of the collection", () => {
    const all = [...chaptersByRepertoire.values()].flat();
    measure(
      `collectDecisions over ${all.length} chapters`,
      () => collectDecisions("white", all),
      Math.max(3, Math.round(SIZE.runs / 3))
    );
    // What was timed did the work: the collection's chapters hold decisions.
    expect(collectDecisions("white", all).size).toBeGreaterThan(0);
  });

  it("compares a long finished game against a repertoire", () => {
    const repertoireId = repertoireIds[0];
    const chapters = chaptersByRepertoire.get(repertoireId)!;
    const moves = generateGame(random, bigChapter.tree, SIZE.gamePlies);
    facts["comparison game plies"] = moves.length;
    const compare = () =>
      compareGameToRepertoire(
        { color: "white", rootFen: START_FEN, moves },
        { id: repertoireId, name: "R", revision: 1, chapters, decisions: [] }
      );
    measure(`compareGameToRepertoire (${moves.length} plies, pure)`, compare);
    // Every ply of the long game is judged, not just a prefix.
    expect(compare().moves).toHaveLength(moves.length);
    // The service caches by game hash: drop a different number of final plies on every run.
    let trim = 0;
    measure(`compareGame via service (≤ ${moves.length} plies, SQLite + compare)`, () => {
      const played = moves.slice(0, moves.length - (trim++ % Math.max(1, moves.length - 1)));
      service.compareGame({ repertoireId, color: "white", rootFen: START_FEN, moves: played });
    });
  });

  it("lists the hub summaries", () => {
    measure("Hub: listRepertoires (summary query)", () => service.listRepertoires());
    expect(service.listRepertoires()).toHaveLength(SIZE.repertoires);
  });

  it("parses a 100,000-move PGN import with bounded blocking", async () => {
    const chapters: RepertoireChapter[] = [];
    for (let index = 0; index < SIZE.importChapters; index++) {
      chapters.push(
        generateChapter(random, SMALL_SHAPE(SIZE.movesPerChapter), {
          id: `i${index}`,
          title: `Imported ${index + 1}`,
          sortOrder: index,
          color: "white"
        })
      );
    }
    const pgn = exportRepertoirePgn(chapters);
    facts["import PGN size, MiB"] = round(Buffer.byteLength(pgn) / 2 ** 20);

    const runs = REPEATS;
    const durations: number[] = [];
    let maxBlock = 0;
    let maxProgressGap = 0;
    let nodes = 0;
    for (let run = 0; run < runs; run++) {
      const probe = probeEventLoop();
      let lastProgress = performance.now();
      let progressGap = 0;
      const started = performance.now();
      const parsed = await importPreviewFromText(pgn, undefined, () => {
        const at = performance.now();
        progressGap = Math.max(progressGap, at - lastProgress);
        lastProgress = at;
      });
      const longest = await probe.stop();
      durations.push(performance.now() - started);
      maxBlock = Math.max(maxBlock, longest);
      maxProgressGap = Math.max(maxProgressGap, progressGap);
      nodes = parsed.games.reduce((sum, game) => sum + game.nodeCount, 0);
    }
    durations.sort((a, b) => a - b);
    results.push({
      name: `Import preview parse (importPreviewFromText, ${nodes} moves, ${SIZE.importChapters} games)`,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations[durations.length - 1],
      runs
    });
    facts["import: longest event-loop block (target ≤ 50 ms)"] = round(maxBlock);
    // The same parse in smaller pieces, to show how the piece size bounds a blocking task.
    for (const chunkChars of [32 * 1024, 16 * 1024]) {
      const probe = probeEventLoop();
      await runImport({ kind: "text", text: pgn }, undefined, { chunkChars });
      const longest = await probe.stop();
      facts[`import: longest event-loop block with ${chunkChars / 1024} KiB pieces, ms`] =
        round(longest);
    }
    facts["import: longest gap between progress events, ms"] = round(maxProgressGap);
    expect(nodes).toBe(SIZE.importChapters * SIZE.movesPerChapter);
  });
  it("saves one chapter of a single large repertoire without stalling the main thread", async () => {
    // One repertoire holding every chapter: a save used to reindex all of them (audit R02).
    const detail = service.createRepertoire({ name: "Single large repertoire", color: "white" });
    const seeded = seedChapters(random, detail, {
      shapes: Array.from({ length: SIZE.singleChapters }, () => SMALL_SHAPE(SIZE.singleMoves)),
      idPrefix: "single"
    });
    const { chapters } = seeded;
    let saved = seeded.saved;
    const occurrences = chapters.reduce((sum, chapter) => sum + chapter.tree.length, 0);
    facts["single repertoire: chapters × moves"] =
      `${SIZE.singleChapters} × ${SIZE.singleMoves} (${occurrences} occurrences)`;

    const target = chapters[Math.floor(SIZE.singleChapters / 2)];
    let chapter = service.getChapter({ repertoireId: detail.id, chapterId: target.id });
    let revision = saved.repertoire.revision;
    const save = (next: RepertoireChapter) => {
      saved = service.saveChapter({
        repertoireId: detail.id,
        chapter: next,
        expectedRevision: revision
      });
      revision = saved.repertoire.revision;
      chapter = saved.chapter;
    };
    let edit = 0;
    const commentOnly = () => {
      edit += 1;
      save({ ...chapter, tree: withRootComment(chapter.tree, `Edit ${edit}`) });
    };
    const addMove = () => save({ ...chapter, tree: extendLeaf(random, chapter.tree) });
    measure("Single repertoire: comment-only saveChapter", commentOnly);
    measure("Single repertoire: saveChapter adding one move", addMove);
    // A decision's prompt: the start position (in every chapter) and the least shared one.
    const decisions = decisionRepository.list(detail.id);
    const sharing = (key: string) =>
      new Set(positionIndexRepository.occurrences(detail.id, key).map((row) => row.chapterId)).size;
    const ranked = decisions
      .map((decision) => ({ key: decision.positionKey, count: sharing(decision.positionKey) }))
      .sort((a, b) => a.count - b.count);
    for (const { key, count } of [ranked[ranked.length - 1], ranked[0]]) {
      measure(`Single repertoire: updateDecision prompt (position in ${count} chapters)`, () => {
        edit += 1;
        revision = service.updateDecision({
          repertoireId: detail.id,
          expectedRevision: revision,
          positionKey: key,
          patch: { prompt: `Prompt ${edit}` }
        }).repertoire.revision;
      });
    }
    chapter = service.getChapter({ repertoireId: detail.id, chapterId: target.id });

    // The longest main-thread gap while saves arrive through the write gate, as the IPC handlers
    // run them, interleaved with other event-loop work.
    for (const [name, run] of [
      ["comment-only saves", commentOnly],
      ["one-move saves", addMove]
    ] as const) {
      const probe = probeEventLoop();
      for (let index = 0; index < SIZE.runs; index++) {
        await service.withRepertoireWriteGate(run);
        await new Promise((resolve) => setImmediate(resolve));
      }
      facts[`single repertoire: longest main-thread block during ${name}, ms`] = round(
        await probe.stop()
      );
    }
    expect(chapter.revision).toBeGreaterThan(1);

    // Restoring this repertoire's backup as a copy. Without the bundled restore worker (as here)
    // it runs in this thread: its duration is how long it blocked the main thread before the
    // worker. The packaged app restores in the worker; e2e/repertoire-perf.spec.ts measures that.
    const json = transaction(
      () =>
        JSON.stringify(
          backupDocument([stripForExport(backupEntryOf(requireRepertoire(detail.id)), true)], 0, {
            name: "Chaturanga",
            version: "0.0.0"
          })
        ),
      "read"
    );
    const restores: number[] = [];
    for (let run = 0; run < REPEATS; run++) {
      const preview = (await service.previewBackupImport({ json }))!;
      const started = performance.now();
      await service.restoreBackup({
        jobId: preview.jobId,
        selections: [{ sourceId: detail.id, mode: "new-copy", includeProgress: true }]
      });
      restores.push(performance.now() - started);
    }
    restores.sort((a, b) => a - b);
    results.push({
      name: "Single repertoire: restoreBackup as a copy, in this thread (no worker)",
      p50: percentile(restores, 50),
      p95: percentile(restores, 95),
      max: restores[restores.length - 1],
      runs: restores.length
    });
  });
});
