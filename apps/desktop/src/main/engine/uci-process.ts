import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { engineProcessCwd, spawnArgsForEngine } from "@chaturanga/shared/engine/spawn-args";

/** Set CHATURANGA_UCI_LOG=1 to print UCI transcripts and engine stderr. */
export const LOG_UCI = process.env.CHATURANGA_UCI_LOG === "1";

const liveProcesses = new Set<ChildProcessWithoutNullStreams>();

/**
 * Spawns a UCI engine with piped stdio. Every engine process in the app goes
 * through here so that:
 * - a write to an engine that already died (EPIPE) can't surface as an
 *   unhandled stream error and take down the main process;
 * - `killAllEngineProcesses()` can reap everything on quit, including
 *   review / probe sessions the EngineManager doesn't own.
 */
export function spawnUciProcess(config: EngineConfig): ChildProcessWithoutNullStreams {
  const proc = spawn(config.executablePath, spawnArgsForEngine(config), {
    cwd: engineProcessCwd(config),
    stdio: "pipe"
  });
  proc.stdin.on("error", () => undefined);
  liveProcesses.add(proc);
  proc.once("exit", () => liveProcesses.delete(proc));
  proc.once("error", () => liveProcesses.delete(proc));
  return proc;
}

/** Writes one UCI command line; a no-op once the process is gone. */
export function writeUci(proc: ChildProcessWithoutNullStreams | null, command: string): void {
  if (!proc || proc.killed || !proc.stdin.writable) return;
  proc.stdin.write(`${command}\n`);
}

/** Politely asks the engine to quit, then kills it. */
export function stopUciProcess(proc: ChildProcessWithoutNullStreams | null): void {
  if (!proc) return;
  writeUci(proc, "quit");
  if (!proc.killed) proc.kill();
}

export function killAllEngineProcesses(): void {
  for (const proc of liveProcesses) stopUciProcess(proc);
  liveProcesses.clear();
}

/** Splits streamed stdout into trimmed, non-empty lines. */
export function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (line) onLine(line);
    }
  };
}
