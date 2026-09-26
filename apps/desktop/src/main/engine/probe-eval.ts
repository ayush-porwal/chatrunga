import type { EngineConfig, EngineScore } from "@chaturanga/shared/types/engine";
import { parseInfoLine } from "@chaturanga/shared/engine/uci";
import { createLineSplitter, spawnUciProcess, stopUciProcess, writeUci } from "./uci-process";

/** Covers slow NN weight loads (lc0) plus the search itself. */
const TOTAL_MS = 180_000;

/**
 * One-shot UCI search for a centipawn / mate score, in its own process
 * (independent of EngineManager's interactive engine). Used for draw offers.
 */
export function probeEvalScore(
  config: EngineConfig,
  fen: string,
  moves: string[],
  movetimeMs: number
): Promise<EngineScore | null> {
  return new Promise((resolve, reject) => {
    const proc = spawnUciProcess(config);
    let phase: "uci" | "ready" | "search" = "uci";
    let lastScore: EngineScore | null = null;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopUciProcess(proc);
      if (error) reject(error);
      else resolve(lastScore);
    };
    const timeout = setTimeout(() => finish(new Error("Evaluation timed out")), TOTAL_MS);

    proc.stdout.on(
      "data",
      createLineSplitter((line) => {
        if (phase === "uci") {
          if (line === "uciok") {
            phase = "ready";
            writeUci(proc, "isready");
          }
          return;
        }
        if (phase === "ready") {
          if (line === "readyok") {
            phase = "search";
            writeUci(proc, "ucinewgame");
            writeUci(proc, `position fen ${fen}${moves.length ? ` moves ${moves.join(" ")}` : ""}`);
            writeUci(proc, `go movetime ${Math.max(50, Math.floor(movetimeMs))}`);
          }
          return;
        }
        const info = parseInfoLine(config.id, line);
        if (info?.score) lastScore = info.score;
        if (line.startsWith("bestmove")) finish();
      })
    );
    proc.on("error", (error) => finish(error));
    proc.on("exit", () =>
      finish(phase === "search" ? undefined : new Error("Engine exited before it was ready"))
    );
    writeUci(proc, "uci");
  });
}
