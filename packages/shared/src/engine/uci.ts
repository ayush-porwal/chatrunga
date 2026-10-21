import type { EngineBestMove, EngineInfo, EngineScore, Wdl } from "../types/engine";
import { isOneOf } from "../types/guards";

/** The `info` fields given as one number after their name. */
const NUMBER_FIELDS = ["depth", "seldepth", "multipv", "nodes", "nps"] as const;

export function parseInfoLine(engineId: string, line: string): EngineInfo | null {
  if (!line.startsWith("info ")) return null;
  const tokens = line.split(/\s+/);
  const info: EngineInfo = { engineId, raw: line, receivedAt: Date.now() };

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (isOneOf(NUMBER_FIELDS, token) && next) info[token] = Number(next);
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
