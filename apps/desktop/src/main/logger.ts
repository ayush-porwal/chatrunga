import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { format } from "node:util";

/** "trace": high-volume debugging output (the UCI transcript), on the console only. */
type Level = "trace" | "info" | "warn" | "error";

const MAX_LOG_BYTES = 1_000_000;
let logFile: string | null | undefined;
/** The size of main.log as this process has written it. */
let logBytes = 0;

/** `<logs>/main.log`, rotated to `main.old.log` past 1 MB. Null when unavailable (e.g. tests). */
function resolveLogFile(): string | null {
  if (logFile !== undefined) return logFile;
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "main.log");
    logBytes = statSync(logFile, { throwIfNoEntry: false })?.size ?? 0;
    if (logBytes > MAX_LOG_BYTES) rotate(logFile);
  } catch {
    logFile = null;
  }
  return logFile;
}

function rotate(file: string): void {
  renameSync(file, join(dirname(file), "main.old.log"));
  logBytes = 0;
}

function write(level: Level, scope: string, args: unknown[]): void {
  const line = `[${scope}] ${format(...args)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  // Packaged builds have no visible console: everything but the trace is persisted, timestamped
  // (info lines are few: lifecycle steps such as quitting).
  if (level === "trace") return;
  const file = resolveLogFile();
  if (!file) return;
  try {
    const entry = `${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`;
    appendFileSync(file, entry);
    logBytes += Buffer.byteLength(entry);
    if (logBytes > MAX_LOG_BYTES) rotate(file);
  } catch {
    // Logging must never throw.
  }
}

export const logger = {
  trace: (scope: string, ...args: unknown[]) => write("trace", scope, args),
  info: (scope: string, ...args: unknown[]) => write("info", scope, args),
  warn: (scope: string, ...args: unknown[]) => write("warn", scope, args),
  error: (scope: string, ...args: unknown[]) => write("error", scope, args)
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
