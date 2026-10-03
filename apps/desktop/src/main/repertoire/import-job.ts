/**
 * One bounded PGN import parse (design §10 Import step 1, §11): the text (or a file, read in
 * pieces) is split into games as it arrives, every game is parsed as soon as it ends, and the
 * byte, game, move, depth and comment limits are enforced along the way, so an oversized input
 * fails at the first limit it crosses instead of after the whole file. Runs in the import worker
 * (import-worker.ts); it has no Electron dependency, so tests and the benchmark call it directly.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ImportProgressEvent } from "@chaturanga/shared/types/repertoire";
import { createPgnGameSplitter } from "@chaturanga/shared/chess/pgn-game-splitter";
import {
  createRepertoirePgnReader,
  type ParsedRepertoireGame,
  type RepertoirePgnLimits
} from "@chaturanga/shared/chess/repertoire-pgn";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { validateTree } from "./chapter-validation";

/** A parsed game with its validated tree and each node's position key (empty when rejected). */
export type ImportedGame = ParsedRepertoireGame & { positionKeys: Record<string, string> };

/** Every game of an import, as the parse gives them. */
export type ImportedPgn = { games: ImportedGame[] };

/** Where the PGN comes from: text already in memory, or a file streamed from disk. */
export type ImportSource = { kind: "text"; text: string } | { kind: "file"; path: string };

export type ImportLimits = Required<RepertoirePgnLimits> & {
  /** Largest input, in bytes (UTF-8). */
  maxBytes: number;
};

/** Design §11 defaults: 20 MiB, 1,000 chapters, 100,000 moves, 128 levels, 20,000-character comments. */
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxGames: 1000,
  maxNodes: 100_000,
  maxDepth: 128,
  maxCommentLength: 20_000
};

/** Shortest gap between two progress reports of the same phase. */
export const IMPORT_PROGRESS_INTERVAL_MS = 100;
/** Characters of in-memory text parsed between two yields to the event loop. */
export const IMPORT_CHUNK_CHARS = 32 * 1024;
/** Longest stretch of tree validation between two yields to the event loop. */
const VALIDATION_SLICE_MS = 20;

/** The progress a parse reports; the service adds the job id and the final phases. */
export type ImportProgress = Omit<ImportProgressEvent, "jobId" | "error" | "phase"> & {
  phase: "reading" | "parsing" | "validating";
};

/** The parse was cancelled; nothing was kept. */
export class ImportCancelledError extends Error {
  constructor() {
    super("The import was cancelled.");
    this.name = "ImportCancelledError";
  }
}

export type ImportRunOptions = {
  onProgress?: (progress: ImportProgress) => void;
  /** Checked between games and between pieces of input. */
  isCancelled?: () => boolean;
  progressIntervalMs?: number;
  chunkChars?: number;
  /** Clock for the progress cadence (tests). */
  now?: () => number;
};

/** The size in words: `20 MiB`, or bytes for small limits. */
function formatSize(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1 ? `${Math.round(mib * 10) / 10} MiB` : `${bytes} bytes`;
}

function tooLarge(limits: ImportLimits): Error {
  return new Error(
    `This PGN is larger than ${formatSize(limits.maxBytes)}; split it and import it in parts.`
  );
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Parses every game of the source into the same result `parseRepertoirePgn` gives, with every
 * tree validated as a commit stores it (`validateTree`; a tree that fails it rejects its game) and
 * every node's position key precomputed,
 * reporting progress at most every `progressIntervalMs` per phase (a new phase is always reported).
 * Throws the actionable limit error, `No PGN game found.`, or `ImportCancelledError`.
 */
export async function runImport(
  source: ImportSource,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
  {
    onProgress,
    isCancelled = () => false,
    progressIntervalMs = IMPORT_PROGRESS_INTERVAL_MS,
    chunkChars = IMPORT_CHUNK_CHARS,
    now = () => performance.now()
  }: ImportRunOptions = {}
): Promise<ImportedPgn> {
  const reader = createRepertoirePgnReader(limits);
  let bytesRead = 0;
  let totalBytes: number | null = null;
  let lastPhase: ImportProgress["phase"] | null = null;
  let lastAt = 0;
  const report = (phase: ImportProgress["phase"]) => {
    if (!onProgress) return;
    const at = now();
    if (phase === lastPhase && at - lastAt < progressIntervalMs) return;
    lastPhase = phase;
    lastAt = at;
    onProgress({
      phase,
      bytesRead,
      totalBytes,
      gamesSeen: reader.gamesSeen,
      nodesSeen: reader.nodesSeen
    });
  };
  const checkCancelled = () => {
    if (isCancelled()) throw new ImportCancelledError();
  };
  const splitter = createPgnGameSplitter((game) => {
    checkCancelled();
    reader.push(game);
  });

  if (source.kind === "text") {
    totalBytes = Buffer.byteLength(source.text);
    if (totalBytes > limits.maxBytes) throw tooLarge(limits);
    report("reading");
    for (let start = 0; start < source.text.length; start += chunkChars) {
      checkCancelled();
      const chunk = source.text.slice(start, start + chunkChars);
      splitter.write(chunk);
      bytesRead += Buffer.byteLength(chunk);
      report("parsing");
      await yieldToEventLoop();
    }
  } else {
    totalBytes = (await stat(source.path)).size;
    if (totalBytes > limits.maxBytes) throw tooLarge(limits);
    report("reading");
    const stream = createReadStream(source.path, { encoding: "utf8", highWaterMark: chunkChars });
    try {
      for await (const chunk of stream as AsyncIterable<string>) {
        checkCancelled();
        // The file may have grown since it was measured.
        if (stream.bytesRead > limits.maxBytes) throw tooLarge(limits);
        splitter.write(chunk);
        bytesRead = stream.bytesRead;
        report("parsing");
      }
    } finally {
      stream.destroy();
    }
  }
  checkCancelled();
  splitter.end();
  report("validating");
  const parsed = reader.finish();
  // Every tree is validated here, as a commit would, so the commit only prunes and stores it; the
  // position keys a commit's reindex needs are computed here too (design §11).
  let sliceStart = now();
  const games: ImportedGame[] = [];
  for (const game of parsed.games) {
    if (game.rejected) {
      games.push({ ...game, positionKeys: {} });
    } else {
      try {
        const tree = validateTree(game.tree, game.rootFen);
        const positionKeys: Record<string, string> = {};
        for (const node of tree) positionKeys[node.id] = positionKey(node.fenAfter);
        games.push({ ...game, tree, positionKeys });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        games.push({
          ...game,
          nodeCount: 0,
          warnings: [...game.warnings, reason],
          rejected: reason,
          positionKeys: {}
        });
      }
    }
    if (now() - sliceStart >= VALIDATION_SLICE_MS) {
      report("validating");
      await yieldToEventLoop();
      checkCancelled();
      sliceStart = now();
    }
  }
  return { games };
}

/**
 * Parses PGN text in this thread exactly as the import worker does (the benchmark's entry point):
 * same result, limits, messages and progress cadence as `repertoires.previewImport`.
 */
export function importPreviewFromText(
  pgn: string,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportedPgn> {
  return runImport({ kind: "text", text: pgn }, limits, { onProgress });
}

/** What the service sends a worker: the job, through `workerData`. */
export type ImportWorkerJob = { jobId: string; source: ImportSource; limits: ImportLimits };

/** What the service may post to a running worker: stop, or send the next result messages. */
export type ImportWorkerRequest = { type: "cancel" } | { type: "more" };

/** Nodes (a game counts as 50) a worker sends before waiting for the service's `more`. */
export const RESULT_BATCH_COST = 4000;

/** Most tree nodes one result message carries (the main thread copies each message at once). */
export const RESULT_SLICE_NODES = 2000;

/**
 * What a worker posts back: progress, then exactly one of the final three. A successful parse
 * sends each game (`game`, then its tree in `nodes` slices) before `done`, so no single message
 * makes the main thread copy a whole import.
 */
export type ImportWorkerMessage =
  | { type: "progress"; progress: ImportProgress }
  | { type: "game"; game: Omit<ImportedGame, "tree" | "positionKeys"> }
  | { type: "nodes"; nodes: ImportedGame["tree"]; keys: [string, string][] }
  | { type: "done" }
  /** The worker waits for `more` before sending further result messages. */
  | { type: "wait" }
  | { type: "failed"; message: string }
  | { type: "cancelled" };

/** The messages that carry `result` to the main thread, in order, ending with `done`. */
export function* resultMessages(result: ImportedPgn): Generator<ImportWorkerMessage> {
  for (const { tree, positionKeys, ...game } of result.games) {
    yield { type: "game", game };
    for (let start = 0; start < tree.length; start += RESULT_SLICE_NODES) {
      const nodes = tree.slice(start, start + RESULT_SLICE_NODES);
      const keys: [string, string][] = [];
      for (const node of nodes) {
        const key = positionKeys[node.id];
        if (key !== undefined) keys.push([node.id, key]);
      }
      yield { type: "nodes", nodes, keys };
    }
  }
  yield { type: "done" };
}
