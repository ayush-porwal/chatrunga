import type { EngineBestMove, EngineInfo, EngineScore, Wdl } from "../types/engine";

export function parseInfoLine(engineId: string, line: string): EngineInfo | null {
  if (!line.startsWith("info ")) return null;
  const tokens = line.split(/\s+/);
  const info: EngineInfo = { engineId, raw: line, receivedAt: Date.now() };

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === "depth" && next) info.depth = Number(next);
    if (token === "seldepth" && next) info.seldepth = Number(next);
    if (token === "multipv" && next) info.multipv = Number(next);
    if (token === "nodes" && next) info.nodes = Number(next);
    if (token === "nps" && next) info.nps = Number(next);
    if (token === "wdl") {
      const win = Number(tokens[index + 1]);
      const draw = Number(tokens[index + 2]);
      const loss = Number(tokens[index + 3]);
      if ([win, draw, loss].every(Number.isFinite)) info.wdl = { win, draw, loss } satisfies Wdl;
    }
    if (token === "score") {
      const type = tokens[index + 1];
      const value = tokens[index + 2];
      if ((type === "cp" || type === "mate") && value) {
        info.score = { type, value: Number(value) } satisfies EngineScore;
      }
    }
    if (token === "pv") {
      info.pv = tokens.slice(index + 1);
      break;
    }
  }

  return info;
}

export function parseBestMove(engineId: string, line: string): EngineBestMove | null {
  if (!line.startsWith("bestmove ")) return null;
  const tokens = line.split(/\s+/);
  const move = tokens[1];
  if (!move || move === "(none)") return null;
  const ponderIndex = tokens.indexOf("ponder");
  return {
    engineId,
    move,
    ponder: ponderIndex > -1 ? tokens[ponderIndex + 1] : undefined
  };
}

/** One `info string` line of lc0's `VerboseMoveStats` output. */
export type Lc0MoveStat = {
  /** UCI move, or "node" for the root summary line. */
  move: string;
  /** Visits. */
  n: number;
  /** Policy prior in [0, 1] (lc0 prints a percentage). */
  p: number;
  /** Value-head evaluation (V) in [-1, 1], side to move; null when lc0 prints "-.----". */
  v: number | null;
  /** Q (search value) in [-1, 1], side to move; null when unavailable. */
  q: number | null;
  /** WL = win - loss in [-1, 1], side to move; null when unavailable. */
  wl: number | null;
  /** Draw probability in [0, 1]; null when unavailable. */
  d: number | null;
};

const LC0_MOVE_STAT = /^info string (\S+)\s+\(\s*\d+\s*\)\s+N:\s+(\d+)/;

function lc0Field(line: string, name: string): number | null {
  const match = line.match(new RegExp(`\\(${name}:\\s*(-?[\\d.]+%?)\\s*\\)`));
  if (!match) return null;
  const raw = match[1];
  const value = Number(raw.replace("%", ""));
  if (!Number.isFinite(value)) return null;
  return raw.endsWith("%") ? value / 100 : value;
}

/**
 * Parses lc0 `VerboseMoveStats` lines, e.g.
 * `info string f1c4  (139 ) N:  0 (+ 0) (P: 23.75%) (WL:  -.-----) ... (V:  -.----)`
 * and the root `info string node  (  27) N: 1 ... (WL: 0.03162) (D: 0.039) ... (V: 0.0331)`.
 * Returns null for any other line.
 */
export function parseLc0MoveStat(line: string): Lc0MoveStat | null {
  const head = line.match(LC0_MOVE_STAT);
  if (!head) return null;
  const p = lc0Field(line, "P");
  if (p === null) return null;
  return {
    move: head[1],
    n: Number(head[2]),
    p,
    v: lc0Field(line, "V"),
    q: lc0Field(line, "Q"),
    wl: lc0Field(line, "WL"),
    d: lc0Field(line, "D")
  };
}
