/**
 * Drawing puzzles from an installed database: random ones matching the filters (samplePuzzle),
 * and the puzzle of the day.
 */
import { app } from "electron";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  externalDatabaseSources,
  type InstalledDatabase,
  type PuzzleOfTheDayInput,
  type PuzzleSample,
  type PuzzleSampleInput
} from "@chaturanga/shared/types/database";
import { isOneOf, isRecord } from "@chaturanga/shared/types/guards";
import { externalDatabaseRepository } from "../db/external-database-repository";
import { errorMessage, logger } from "../logger";
import { writePrivateJsonFile } from "../secure-json-file";
import { parseStoredJson } from "../stored-json";
import { onDisk } from "./installed-databases";
import {
  isPlayablePuzzle,
  rowKindForSource,
  sampleFromLichessRow,
  sampleFromPositionRow,
  type PuzzleRowKind
} from "./puzzle-rows";
import {
  ScanCancelledError,
  ScanWorkerError,
  workerScanner,
  type PuzzleScanner,
  type RunningScan,
  type ScanJob,
  type ScanResult
} from "./puzzle-scan";

/** The quick answer for new filters: a random sample of the first matches in the file. */
const QUICK_MATCHES = 500;
/** Puzzles kept per filter set from a scan of the whole file; refilled in the background. */
const POOL_SIZE = 64;
const POOL_REFILL_BELOW = 8;
const MAX_POOLS = 6;

/*
 * How puzzles are drawn. Every scan of a dataset runs in a worker thread (decompressing the whole
 * Lichess file takes seconds of CPU), never in the main process; a scanner that can't run is an
 * error the caller sees, not a reason to scan here instead.
 *
 * Per database file and filter set there is a pool. Cold (an empty pool): the request waits for a
 * quick scan that stops after the first QUICK_MATCHES matches (plus as many as the session has
 * excluded, so fresh ones remain) and keeps a random POOL_SIZE of them. Those rows are the pool's
 * interim sample — a prefix of the file — and serve this and the following requests while a scan
 * of the whole file (queued, at most MAX_FULL_SCANS at once, newest filters first) builds a uniform
 * reservoir; that replaces the interim rows, and is refilled the same way when it runs low. When
 * the quick scan reaches the end of the file (rare filters, or none matching) it saw every match,
 * so it is the full answer and no whole-file scan follows.
 *
 * Identical requests in flight share one quick scan; a request for other filters stops the quick
 * scans of earlier ones (those requests fail as replaced), since only the newest one is waited for.
 */

/** Whole-file scans running at once, each decompressing the file in its own worker. */
const MAX_FULL_SCANS = 2;
/** A failed whole-file scan is tried again by a request at least this long after the failure. */
const FULL_SCAN_RETRY_MS = 30_000;

type QuickScan = RunningScan & { limit: number };

type SamplePool = {
  key: string;
  /** Candidate rows still to serve, a uniform sample of every match in the file. */
  rows: string[][];
  /**
   * When the file has no more matches than a pool holds: every one of them. Serving takes rows
   * out of `rows`; this set refills it (a new session may exclude fewer puzzles than the last).
   */
  all: string[][] | null;
  /** From the latest quick scan, while `rows` waits for a whole-file scan (see above). */
  interim: string[][];
  /**
   * The quick scan result last put into the pool. Requests that joined one scan each see its
   * result; only the first fills the pool, so a later one can't put back a row already served.
   */
  appliedQuick: ScanResult | null;
  /** Quick scans in flight, joined by identical requests. */
  quick: Set<QuickScan>;
  /** The job of the whole-file scan, running (`full`) or waiting for a free slot (`queued`). */
  fullJob: ScanJob | null;
  full: RunningScan | null;
  queued: boolean;
  /** When the last whole-file scan failed: it is retried once FULL_SCAN_RETRY_MS have passed. */
  fullFailedAt: number | null;
};

/** Per database + filters. A small pool, filled from one scan of the whole file, serves many puzzles. */
const pools = new Map<string, SamplePool>();
/** Pools waiting for a whole-file scan; the newest is started first. */
const fullScanQueue: SamplePool[] = [];
let runningFullScans = 0;

/** The worker bundled next to the main entry (see electron.vite.config.ts). */
const SCAN_WORKER = join(dirname(fileURLToPath(import.meta.url)), "puzzle-scan-worker.js");
let scanner: PuzzleScanner = workerScanner(SCAN_WORKER);

/** Replaces the worker scanner (tests run scans in their own thread); null restores the worker. */
export function setPuzzleScanner(next: PuzzleScanner | null): void {
  scanner = next ?? workerScanner(SCAN_WORKER);
}

/** A scan whose `cancel` rejects its result at once, whatever the scanner does to stop. */
function startScan(job: ScanJob): RunningScan {
  const running = scanner(job);
  let stop: () => void = () => undefined;
  const stopped = new Promise<never>(
    (_, reject) => (stop = () => reject(new ScanCancelledError()))
  );
  return {
    result: Promise.race([running.result, stopped]),
    cancel: () => {
      stop();
      running.cancel();
    }
  };
}

/** Per database, file version (a replaced file is a new pool) and filters. */
function poolKey(input: PuzzleSampleInput, fileVersion: string): string {
  return JSON.stringify([
    input.databaseId,
    fileVersion,
    input.lichess ?? null,
    input.position ?? null,
    input.ids ?? null
  ]);
}

function poolFor(key: string): SamplePool {
  const existing = pools.get(key);
  if (existing) return existing;
  const pool: SamplePool = {
    key,
    rows: [],
    all: null,
    interim: [],
    appliedQuick: null,
    quick: new Set(),
    fullJob: null,
    full: null,
    queued: false,
    fullFailedAt: null
  };
  pools.set(key, pool);
  // Oldest filter sets go first (their scans stop).
  for (const oldKey of [...pools.keys()]) {
    if (pools.size <= MAX_POOLS) break;
    dropPool(oldKey);
  }
  return pool;
}

function dropPool(key: string): void {
  const pool = pools.get(key);
  if (!pool) return;
  pools.delete(key);
  for (const quick of pool.quick) quick.cancel();
  pool.full?.cancel();
  const queued = fullScanQueue.indexOf(pool);
  if (queued >= 0) fullScanQueue.splice(queued, 1);
}

/** Forgets every pool of a database (removed, or its file replaced). */
export function dropPools(databaseId: string): void {
  // Pool keys are JSON arrays that start with the database id (see poolKey).
  const prefix = `${JSON.stringify([databaseId]).slice(0, -1)},`;
  for (const key of [...pools.keys()]) if (key.startsWith(prefix)) dropPool(key);
}

/** A request for other filters: earlier requests' quick scans stop (their whole-file scans go on). */
function supersedeQuickScans(current: SamplePool): void {
  for (const pool of pools.values()) {
    if (pool === current) continue;
    for (const quick of pool.quick) quick.cancel();
  }
}

/** The shared quick scan of at least `limit` matches, started if none is in flight. */
function quickScan(pool: SamplePool, job: ScanJob, limit: number): QuickScan {
  for (const quick of pool.quick) if (quick.limit >= limit) return quick;
  const quick: QuickScan = { ...startScan({ ...job, maxMatches: limit }), limit };
  pool.quick.add(quick);
  const forget = () => void pool.quick.delete(quick);
  quick.result.then(forget, forget);
  return quick;
}

/** Queues a whole-file scan when the pool runs low (not after a recent failure). */
function requestFullScan(pool: SamplePool, job: ScanJob): void {
  if (pool.all || pool.rows.length >= POOL_REFILL_BELOW || pool.full || pool.queued) return;
  if (pool.fullFailedAt !== null && Date.now() - pool.fullFailedAt < FULL_SCAN_RETRY_MS) return;
  pool.fullJob = job;
  pool.queued = true;
  fullScanQueue.push(pool);
  pumpFullScans();
}

function pumpFullScans(): void {
  while (runningFullScans < MAX_FULL_SCANS && fullScanQueue.length) {
    const pool = fullScanQueue.pop()!;
    pool.queued = false;
    if (pools.get(pool.key) !== pool || !pool.fullJob) continue;
    runningFullScans += 1;
    const scan = startScan(pool.fullJob);
    pool.full = scan;
    scan.result
      .then((result) => {
        if (pools.get(pool.key) !== pool) return;
        fillPool(pool, result);
        pool.fullFailedAt = null;
      })
      .catch((error: unknown) => {
        if (error instanceof ScanCancelledError || pools.get(pool.key) !== pool) return; // Dropped.
        // Puzzles keep coming from the interim rows (or new quick scans); tried again later.
        pool.fullFailedAt = Date.now();
        logger.warn("databases", "scanning a puzzle database in full failed:", errorMessage(error));
      })
      .finally(() => {
        pool.full = null;
        runningFullScans -= 1;
        pumpFullScans();
      });
  }
}

/** Takes a row that makes a puzzle from the pool: its whole-file sample first, else the interim one. */
function serveFromPool(
  pool: SamplePool,
  build: (row: string[]) => PuzzleSample | null
): PuzzleSample | null {
  let sample = takeFromPool(pool, build);
  if (!sample && pool.all) {
    // Every match is known: serve them again (the excluded ones are skipped).
    pool.rows = [...pool.all];
    sample = takeFromPool(pool, build);
  }
  return sample ?? takeFromPool({ rows: pool.interim }, build);
}

/** What a failed scan means for the person asking for a puzzle. */
function sampleError(database: InstalledDatabase, error: unknown): Error {
  if (error instanceof ScanCancelledError)
    return new Error("This puzzle search was replaced by a newer one.");
  if (error instanceof ScanWorkerError) {
    return new Error(
      `Couldn't search ${database.name} for puzzles: ${error.message}. Try again, or restart Chaturanga if it keeps happening.`
    );
  }
  return new Error(
    `Couldn't read ${database.name}: ${errorMessage(error)}. Download the database again.`
  );
}

/**
 * A random puzzle matching the filters, drawn from the whole file (see the comment above `pools`
 * for how a new set of filters is answered while the file is scanned in the background).
 */
export async function samplePuzzle(input: PuzzleSampleInput): Promise<PuzzleSample> {
  const registered = externalDatabaseRepository.get(input.databaseId);
  if (!registered) throw new Error("Puzzle database not found. Download a database first.");
  const database = await onDisk(registered);
  if (!database) {
    dropPools(registered.id);
    throw new Error(`${registered.name} is missing from disk. Download the database again.`);
  }

  const kind: PuzzleRowKind = rowKindForSource(database.sourceId);
  const excluded = new Set(input.excludeIds);
  const file = await stat(database.filePath);
  const pool = poolFor(poolKey(input, `${file.size}:${file.mtimeMs}`));
  supersedeQuickScans(pool);
  const job: ScanJob = {
    filePath: database.filePath,
    compressed: database.format.endsWith(".zst"),
    kind,
    input,
    // Exclusions are applied when serving, so the rows fit any session with these filters.
    excludeIds: [],
    // Room for every puzzle asked for by id, so the pool holds them all.
    size: Math.max(POOL_SIZE, input.ids?.length ?? 0)
  };
  const build = (row: string[]) => {
    try {
      const sample = (kind === "lichess" ? sampleFromLichessRow : sampleFromPositionRow)(
        database,
        row,
        input
      );
      return sample && !excluded.has(sample.id) ? sample : null;
    } catch {
      return null; // Malformed row (e.g. an illegal FEN): skip it.
    }
  };

  // Several candidates, so a malformed or excluded row (checked only when serving) doesn't hide
  // the valid ones; the excluded rows count towards the limit, so it still reaches fresh ones.
  const limit = QUICK_MATCHES + excluded.size;
  let scanned = 0;
  let sample = serveFromPool(pool, build);
  // A joined scan may have stopped short of this request's limit: then one more, of its own.
  while (!sample && !pool.all && scanned < limit) {
    const quick = quickScan(pool, job, limit);
    let result: ScanResult;
    try {
      result = await quick.result;
    } catch (error) {
      if (!(error instanceof ScanCancelledError)) {
        logger.warn(
          "databases",
          `scanning ${database.name} for puzzles failed:`,
          errorMessage(error)
        );
      }
      throw sampleError(database, error);
    }
    // A scan that reached the end of the file saw every match: no larger one would find more.
    scanned = result.complete ? Infinity : quick.limit;
    if (pool.appliedQuick !== result) {
      pool.appliedQuick = result;
      // It read the whole file (few matches, or none): that is the pool a full scan would give.
      if (result.complete) fillPool(pool, result);
      else pool.interim = [...result.rows];
    }
    sample = serveFromPool(pool, build);
  }
  requestFullScan(pool, job);
  if (!sample) {
    throw new Error(
      input.ids
        ? "No puzzles left to try again."
        : "No puzzle matched those filters. Try fewer themes or a wider rating range."
    );
  }
  return sample;
}

/*
 * Puzzle of the day. The first DAILY_CANDIDATES rows of the file that make a good daily puzzle
 * (one scan in the scanner, stopping there; samplePuzzle's pools are left alone) are the
 * candidates, and the date picks one by a stable hash: the same date and file give the same
 * puzzle, another date (almost always) another one. No network. The latest pick is kept in
 * userData (DAILY_RECORD_FILE), so starting the app again the same day doesn't scan.
 */

/**
 * Candidates read from the file's start: years of different days, and a short scan (the first call
 * of the day, after each start, reads only until this many rows matched).
 */
const DAILY_CANDIDATES = 2_000;
/** Plays a Lichess candidate needs, when the file says (rows below it are kept only if none pass). */
const DAILY_MIN_PLAYS = 1000;
/** Lichess: mid-strength, well-liked puzzles. */
const DAILY_LICHESS_FILTERS: NonNullable<PuzzleSampleInput["lichess"]> = {
  ratingMin: 1400,
  ratingMax: 2100,
  popularityMin: 85,
  lengths: [],
  themes: [],
  openings: [],
  side: "any"
};
/** Position sets: the middle of their 1–4 difficulty scale. */
const DAILY_POSITION_FILTERS: NonNullable<PuzzleSampleInput["position"]> = {
  difficultyMin: 2,
  difficultyMax: 3,
  tags: []
};
const DAILY_CACHE_SIZE = 4;
/** The latest pick, in userData: `{ date, databaseId, fileStamp, sample }` (see DailyRecord). */
const DAILY_RECORD_FILE = "puzzle-of-the-day.json";

/** Per date, database and file version: the day's puzzle (or the scan finding it). */
const dailyPuzzles = new Map<string, Promise<PuzzleSample | null>>();

/** The stored pick: for a date, from a database whose file had this `size:mtimeMs` stamp. */
type DailyRecord = { date: string; databaseId: string; fileStamp: string; sample: PuzzleSample };

function dailyRecordPath(): string {
  return join(app.getPath("userData"), DAILY_RECORD_FILE);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** A puzzle that can be played (an older build or a damaged file may lack fields or a position). */
function isStoredSample(value: unknown): value is PuzzleSample {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.databaseId === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.sourceName === "string" &&
    typeof value.initialFen === "string" &&
    isStringArray(value.solutionMoves) &&
    value.solutionMoves.length > 0 &&
    isStringArray(value.themes) &&
    isStringArray(value.openingTags) &&
    isOneOf(["white", "black"], value.sideToMove) &&
    isPlayablePuzzle({
      initialFen: value.initialFen,
      solutionMoves: value.solutionMoves,
      sideToMove: value.sideToMove
    })
  );
}

/** The stored pick when it is for this date, database and file; null otherwise (or unreadable). */
async function storedDailyPuzzle(
  date: string,
  databaseId: string,
  fileStamp: string
): Promise<PuzzleSample | null> {
  let record: unknown;
  try {
    record = parseStoredJson<unknown>(await readFile(dailyRecordPath(), "utf8"));
  } catch {
    return null; // None yet, or unreadable: the next pick overwrites it.
  }
  if (!isRecord(record)) return null;
  if (record.date !== date || record.databaseId !== databaseId || record.fileStamp !== fileStamp)
    return null;
  const sample = record.sample;
  return isStoredSample(sample) && sample.databaseId === databaseId ? sample : null;
}

/** The day's puzzle from the stored pick, else from a scan (then stored for the next start). */
async function dailyPuzzle(
  database: InstalledDatabase,
  date: string,
  fileStamp: string
): Promise<PuzzleSample | null> {
  const stored = await storedDailyPuzzle(date, database.id, fileStamp);
  if (stored) return stored;
  const sample = await pickDailyPuzzle(database, date);
  if (sample) {
    const record: DailyRecord = { date, databaseId: database.id, fileStamp, sample };
    // Not kept, the next start scans again; the puzzle is still today's.
    await writePrivateJsonFile(dailyRecordPath(), record).catch((error: unknown) =>
      logger.warn("databases", "saving the puzzle of the day failed:", errorMessage(error))
    );
  }
  return sample;
}

/** The installed puzzle databases to take the day's puzzle from: the Lichess set first. */
function dailySources(): InstalledDatabase[] {
  const kinds = new Map<string, string>(
    externalDatabaseSources.map((source) => [source.id, source.kind])
  );
  return externalDatabaseRepository
    .list()
    .filter((database) => {
      const kind = kinds.get(database.sourceId);
      return kind === "puzzle" || kind === "position";
    })
    .sort(
      (a, b) =>
        Number(rowKindForSource(b.sourceId) === "lichess") -
        Number(rowKindForSource(a.sourceId) === "lichess")
    );
}

/** FNV-1a: a hash of the date that is the same on every run and platform. */
function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The day's puzzle of this file version from memory, else found (see dailyPuzzle) and kept. */
function rememberedDailyPuzzle(
  database: InstalledDatabase,
  date: string,
  fileStamp: string
): Promise<PuzzleSample | null> {
  const key = JSON.stringify([date, database.id, fileStamp]);
  const known = dailyPuzzles.get(key);
  if (known) return known;
  const daily = dailyPuzzle(database, date, fileStamp);
  dailyPuzzles.set(key, daily);
  // A failure isn't remembered: the next call scans again.
  daily.catch(() => dailyPuzzles.delete(key));
  for (const oldKey of [...dailyPuzzles.keys()]) {
    if (dailyPuzzles.size <= DAILY_CACHE_SIZE) break;
    dailyPuzzles.delete(oldKey);
  }
  return daily;
}

/**
 * The day's puzzle from the installed puzzle databases (the Lichess set first); null when none is
 * installed or none of them has a puzzle to give. Answered from memory after the first call, and
 * from the stored pick after a restart the same day.
 */
export async function puzzleOfTheDay(input: PuzzleOfTheDayInput): Promise<PuzzleSample | null> {
  // A database that can't be read is skipped, so a broken file doesn't hide a healthy one; the
  // error comes back only when every installed database failed.
  let failure: unknown = null;
  let answered = false;
  for (const registered of dailySources()) {
    try {
      const database = await onDisk(registered);
      if (!database) continue;
      const file = await stat(database.filePath);
      const sample = await rememberedDailyPuzzle(
        database,
        input.date,
        `${file.size}:${file.mtimeMs}`
      );
      answered = true;
      if (sample) return sample;
    } catch (error) {
      logger.warn(
        "databases",
        `puzzle of the day from ${registered.name} failed:`,
        errorMessage(error)
      );
      failure = error;
    }
  }
  if (failure && !answered) throw failure;
  return null;
}

async function pickDailyPuzzle(
  database: InstalledDatabase,
  date: string
): Promise<PuzzleSample | null> {
  const kind = rowKindForSource(database.sourceId);
  const filtered: PuzzleSampleInput =
    kind === "lichess"
      ? { databaseId: database.id, lichess: DAILY_LICHESS_FILTERS }
      : { databaseId: database.id, position: DAILY_POSITION_FILTERS };
  // A file with no puzzle in that band (a small or unusual set) still has a puzzle of the day.
  for (const input of [filtered, { databaseId: database.id }]) {
    let result: ScanResult;
    try {
      result = await startScan({
        filePath: database.filePath,
        compressed: database.format.endsWith(".zst"),
        kind,
        input,
        excludeIds: [],
        // As many kept as matched: the file's first matches, in file order (no random sampling).
        size: DAILY_CANDIDATES,
        maxMatches: DAILY_CANDIDATES
      }).result;
    } catch (error) {
      logger.warn(
        "databases",
        `finding the puzzle of the day in ${database.name} failed:`,
        errorMessage(error)
      );
      throw sampleError(database, error);
    }
    const played =
      kind === "lichess"
        ? result.rows.filter((row) => Number(row[6]) >= DAILY_MIN_PLAYS)
        : result.rows;
    const candidates = played.length ? played : result.rows;
    const start = stableHash(date) % Math.max(candidates.length, 1);
    // The picked row may not make a puzzle (an illegal move): the next one does instead.
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const row = candidates[(start + offset) % candidates.length];
      try {
        const sample = (kind === "lichess" ? sampleFromLichessRow : sampleFromPositionRow)(
          database,
          row,
          input
        );
        if (sample) return sample;
      } catch {
        // Malformed row: skip it.
      }
    }
  }
  return null;
}

/** A scan's rows become the pool; a complete scan that kept every match holds all of them. */
function fillPool(pool: SamplePool, result: ScanResult): void {
  pool.rows = result.rows;
  pool.interim = [];
  if (result.complete && result.matches <= result.rows.length) pool.all = [...result.rows];
}

/** Takes random rows out of the pool until one makes a puzzle (excluded or broken rows are dropped). */
function takeFromPool(
  pool: Pick<SamplePool, "rows">,
  build: (row: string[]) => PuzzleSample | null
): PuzzleSample | null {
  while (pool.rows.length) {
    const index = Math.floor(Math.random() * pool.rows.length);
    const [row] = pool.rows.splice(index, 1);
    const sample = build(row);
    if (sample) return sample;
  }
  return null;
}
