import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EngineConfig, EngineScore } from "@chaturanga/shared/types/engine";
import { spawnArgsForEngine, engineProcessCwd } from "@chaturanga/shared/engine/spawn-args";
import { parseBestMove, parseInfoLine } from "./uci";

const HANDSHAKE_MS = 120_000;
const TOTAL_MS = 180_000;

/**
 * One-shot UCI search for a centipawn / mate score (does not touch EngineManager's process).
 */
export async function probeEvalScore(
  config: EngineConfig,
  fen: string,
  moves: string[],
  movetimeMs: number
): Promise<EngineScore | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastScore: EngineScore | null = null;
    let buffer = "";
    let handshakePhase = true;
    const pendingWaits: Array<{
      predicate: (line: string) => boolean;
      resolve: () => void;
      reject: (e: Error) => void;
      timeoutHandle: ReturnType<typeof setTimeout>;
    }> = [];

    const proc = spawn(config.executablePath, spawnArgsForEngine(config), {
      cwd: engineProcessCwd(config),
      stdio: "pipe"
    }) as ChildProcessWithoutNullStreams;

    function settle(score: EngineScore | null, error?: Error) {
      if (settled) return;
      settled = true;
      for (const wait of pendingWaits) {
        clearTimeout(wait.timeoutHandle);
      }
      pendingWaits.length = 0;
      try {
        proc.stdin.write("quit\n");
      } catch {
        /* ignore */
      }
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      if (error) reject(error);
      else resolve(score);
    }

    function enqueueWait(predicate: (line: string) => boolean, ms: number, message: string): Promise<void> {
      return new Promise<void>((res, rej) => {
        const timeoutHandle = setTimeout(() => {
          const idx = pendingWaits.findIndex((w) => w.timeoutHandle === timeoutHandle);
          if (idx >= 0) pendingWaits.splice(idx, 1);
          rej(new Error(message));
        }, ms);
        pendingWaits.push({
          predicate,
          resolve: () => {
            clearTimeout(timeoutHandle);
            const idx = pendingWaits.findIndex((w) => w.timeoutHandle === timeoutHandle);
            if (idx >= 0) pendingWaits.splice(idx, 1);
            res();
          },
          reject: (e: Error) => {
            clearTimeout(timeoutHandle);
            const idx = pendingWaits.findIndex((w) => w.timeoutHandle === timeoutHandle);
            if (idx >= 0) pendingWaits.splice(idx, 1);
            rej(e);
          },
          timeoutHandle
        });
      });
    }

    function tryConsumeWait(line: string): boolean {
      const head = pendingWaits[0];
      if (!head || !head.predicate(line)) return false;
      head.resolve();
      return true;
    }

    const totalTimer = setTimeout(() => settle(null, new Error("Evaluation timed out")), TOTAL_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
        if (handshakePhase) {
          if (tryConsumeWait(raw)) continue;
          continue;
        }

        const info = parseInfoLine(config.id, raw);
        if (info?.score) lastScore = info.score;

        const best = parseBestMove(config.id, raw);
        if (best) {
          clearTimeout(totalTimer);
          settle(lastScore);
          return;
        }
      }
    });

    proc.on("error", (error) => {
      clearTimeout(totalTimer);
      settle(null, error);
    });

    proc.on("exit", () => {
      if (!handshakePhase && !settled) {
        clearTimeout(totalTimer);
        settle(lastScore);
      }
    });

    void (async () => {
      try {
        const uciOk = enqueueWait((line) => line === "uciok", HANDSHAKE_MS, "Timed out waiting for uciok");
        proc.stdin.write("uci\n");
        await uciOk;

        const readyOk = enqueueWait((line) => line === "readyok", HANDSHAKE_MS, "Timed out waiting for readyok");
        proc.stdin.write("isready\n");
        await readyOk;

        handshakePhase = false;

        proc.stdin.write("ucinewgame\n");
        proc.stdin.write(`position fen ${fen}${moves.length ? ` moves ${moves.join(" ")}` : ""}\n`);
        proc.stdin.write(`go movetime ${Math.max(50, Math.floor(movetimeMs))}\n`);
      } catch (error) {
        clearTimeout(totalTimer);
        settle(null, error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}
