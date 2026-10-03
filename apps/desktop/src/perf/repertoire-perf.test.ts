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
import { generateChapter, generateGame, seededRandom, type TreeShape } from "./large-repertoire";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repertoire-perf-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: {}
}));

const { closeDb } = await import("../main/db");
const service = await import("../main/repertoire/service");
const { chapterRepository } = await import("../main/repertoire/repository");
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
      runs: 30
    }
  : {
      repertoires: 3,
      chaptersPer: 3,
      movesPerChapter: 20,
      bigChapter: 200,
      gamePlies: 40,
      importChapters: 10,
      runs: 3
    };

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

afterAll(() => {
  closeDb();
  rmSync(userData, { recursive: true, force: true });
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
});

describe("repertoire performance (design §11)", { timeout: 600_000 }, () => {
  const random = seededRandom(20261003);
  const repertoireIds: string[] = [];
  const chaptersByRepertoire = new Map<string, RepertoireChapter[]>();
  let bigChapter: RepertoireChapter;

  it("seeds a representative collection through the real repository", () => {
    const started = performance.now();
    let occurrences = 0;
    for (let r = 0; r < SIZE.repertoires; r++) {
      const color = r % 2 ? "black" : "white";
      const detail = service.createRepertoire({ name: `Repertoire ${r + 1}`, color });
      const chapters: RepertoireChapter[] = [];
      for (let c = 0; c < SIZE.chaptersPer; c++) {
        const big = r === 0 && c === 0;
        const chapter = generateChapter(
          random,
          big ? BIG_SHAPE(SIZE.bigChapter) : SMALL_SHAPE(SIZE.movesPerChapter),
          {
            id: c === 0 ? detail.chapters[0].id : `r${r}c${c}`,
            title: `Chapter ${c + 1}`,
            sortOrder: c,
            color
          }
        );
        chapters.push(chapter);
        occurrences += chapter.tree.length;
        if (c > 0) chapterRepository.upsert(detail.id, chapter, Date.now());
      }
      // Saving the first chapter reindexes the whole repertoire once.
      const saved = service.saveChapter({
        repertoireId: detail.id,
        chapter: chapters[0],
        expectedRevision: detail.revision
      });
      chapters[0] = saved.chapter;
      repertoireIds.push(detail.id);
      chaptersByRepertoire.set(detail.id, chapters);
    }
    bigChapter = chaptersByRepertoire.get(repertoireIds[0])![0];
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
    const deepest = lookup.order.reduce((best, id) =>
      lookup.nodesById.get(id)!.ply > lookup.nodesById.get(best)!.ply ? id : best
    );
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
    const stat = measure(
      `collectDecisions over ${all.length} chapters`,
      () => collectDecisions("white", all),
      Math.max(3, Math.round(SIZE.runs / 3))
    );
    expect(stat.p95).toBeGreaterThanOrEqual(0);
  });

  it("compares a long finished game against a repertoire", () => {
    const repertoireId = repertoireIds[0];
    const chapters = chaptersByRepertoire.get(repertoireId)!;
    const moves = generateGame(random, bigChapter.tree, SIZE.gamePlies);
    facts["comparison game plies"] = moves.length;
    measure(`compareGameToRepertoire (${moves.length} plies, pure)`, () =>
      compareGameToRepertoire(
        { color: "white", rootFen: START_FEN, moves },
        { id: repertoireId, name: "R", revision: 1, chapters, decisions: [] }
      )
    );
    // The service caches by game hash: drop a different number of final plies on every run.
    let trim = 0;
    measure(`compareGame via service (≤ ${moves.length} plies, SQLite + compare)`, () => {
      const played = moves.slice(0, moves.length - (trim++ % Math.max(1, moves.length - 1)));
      service.compareGame({ repertoireId, color: "white", rootFen: START_FEN, moves: played });
    });
  });

  it("lists the hub summaries", () => {
    const stat = measure("Hub: listRepertoires (summary query)", () => service.listRepertoires());
    expect(stat.p95).toBeGreaterThanOrEqual(0);
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

    const runs = FULL ? 3 : 1;
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
});
