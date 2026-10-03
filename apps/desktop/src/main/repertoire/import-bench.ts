/**
 * Import benchmark harness (design §12: import up to 100,000 occurrences with cancellable progress
 * and no parser task blocking an event loop for more than 50 ms). Not part of the app bundle: only
 * tests and the benchmark script import it. It generates repertoire-shaped PGN and times the same
 * parse the import worker runs, reporting the longest event-loop stall seen meanwhile.
 */
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
  DEFAULT_IMPORT_LIMITS,
  importPreviewFromText,
  type ImportLimits,
  type ImportProgress
} from "./import-job";

export { importPreviewFromText };

export type BenchPgnOptions = {
  games: number;
  /** Main-line moves per game (each a node). */
  movesPerGame: number;
  /** Two-move side variations per game replacing the first move (at most 12). */
  variationsPerGame?: number;
  /** A comment of this many characters on every main-line move (0: none). */
  commentLength?: number;
};

/** Knight shuffles: legal from the start position for any number of moves. */
const SHUFFLE = ["Nf3", "Nf6", "Ng1", "Ng8"];
/** Other first moves for White; each variation answers it with 1...Nf6. */
const ALTERNATIVES = ["Nc3", "e4", "d4", "c4", "g3", "b3", "e3", "d3", "f4", "a3", "h3", "Nh3"];

/**
 * Multi-game PGN of known size: `games × (movesPerGame + 2 × variationsPerGame)` nodes, every move
 * legal and no two siblings repeating.
 */
export function generateRepertoirePgn({
  games,
  movesPerGame,
  variationsPerGame = 0,
  commentLength = 0
}: BenchPgnOptions): string {
  const comment = commentLength ? ` { ${"c".repeat(commentLength)} }` : "";
  const variations = ALTERNATIVES.slice(0, variationsPerGame)
    .map((first) => ` (1. ${first} Nf6)`)
    .join("");
  const out: string[] = [];
  for (let game = 0; game < games; game++) {
    const moves: string[] = [];
    for (let ply = 0; ply < movesPerGame; ply++) {
      const san = SHUFFLE[ply % 4];
      moves.push((ply % 2 === 0 ? `${ply / 2 + 1}. ${san}` : san) + comment);
      if (ply === 0) moves.push(variations.trim());
    }
    out.push(`[Event "Bench ${game + 1}"]\n[Result "*"]\n\n${moves.filter(Boolean).join(" ")} *\n`);
  }
  return out.join("\n");
}

export type ImportBenchResult = {
  bytes: number;
  games: number;
  nodes: number;
  /** Wall time of the whole parse. */
  totalMs: number;
  /** Longest event-loop stall during the parse (the design budget is 50 ms). */
  maxBlockMs: number;
  progressEvents: number;
};

/** Times one in-thread parse of `pgn` with the import's limits and progress cadence. */
export async function benchmarkImport(
  pgn: string,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS
): Promise<ImportBenchResult> {
  const progress: ImportProgress[] = [];
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const started = performance.now();
  const parsed = await importPreviewFromText(pgn, limits, (event) => progress.push(event));
  const totalMs = performance.now() - started;
  histogram.disable();
  return {
    bytes: Buffer.byteLength(pgn),
    games: parsed.games.length,
    nodes: parsed.games.reduce((sum, game) => sum + game.nodeCount, 0),
    totalMs,
    maxBlockMs: histogram.max / 1e6,
    progressEvents: progress.length
  };
}
