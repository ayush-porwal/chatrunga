/**
 * The `uci` handshake as every engine process in the app reads it (the live engine, review, the
 * engine test, draw probes): what the engine says about itself, and how long to wait. Each caller
 * keeps its own way of waiting; the parsing and the limits live here once.
 */

/** Lc0 loads its network before `uciok` (large nets take a while); Stockfish answers at once. */
export const UCIOK_TIMEOUT_MS = 120_000;
/** The engine test only needs `uciok` to say the binary works. */
export const TEST_UCIOK_TIMEOUT_MS = 60_000;
export const READYOK_TIMEOUT_MS = 30_000;

export const UCIOK_TIMEOUT_MESSAGE =
  "Timed out waiting for uciok. Leela Chess Zero must load NN weights — set the weights file or add `--weights=/path/to/weights.pb.gz`.";

export type UciIdentity = {
  name?: string;
  author?: string;
  /** Option names the engine advertised (`option name … type …`). */
  options: Set<string>;
};

export function createUciIdentity(): UciIdentity {
  return { options: new Set() };
}

/** Reads one handshake line into `identity`; true once the engine says `uciok`. */
export function readHandshakeLine(identity: UciIdentity, line: string): boolean {
  if (line === "uciok") return true;
  if (line.startsWith("id name ")) identity.name = line.slice(8).trim();
  else if (line.startsWith("id author ")) identity.author = line.slice(10).trim();
  else {
    const option = /^option name (.+?) type /.exec(line);
    if (option?.[1]) identity.options.add(option[1]);
  }
  return false;
}

/** Maia runs on lc0 and names itself (or its author) so. */
export function isHumanPredictionEngine(identity: UciIdentity): boolean {
  return Boolean(identity.name?.toLowerCase().includes("maia") || identity.author?.toLowerCase().includes("maia"));
}
