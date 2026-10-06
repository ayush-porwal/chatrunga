import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

type Level = "info" | "warn" | "error";

const MAX_LOG_BYTES = 1_000_000;
let logFile: string | null | undefined;

/** `<logs>/main.log`, rotated to `main.old.log` past 1 MB. Null when unavailable (e.g. tests). */
function resolveLogFile(): string | null {
  if (logFile !== undefined) return logFile;
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "main.log");
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > MAX_LOG_BYTES) {
      renameSync(logFile, join(dir, "main.old.log"));
    }
  } catch {
    logFile = null;
  }
  return logFile;
}

function write(level: Level, scope: string, args: unknown[]): void {
  const line = `[${scope}] ${format(...args)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  // Packaged builds have no visible console: every line is persisted, timestamped (info lines are
  // few: lifecycle steps such as quitting; the UCI trace only with CHATURANGA_UCI_LOG=1).
  const file = resolveLogFile();
  if (!file) return;
  try {
    appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`);
  } catch {
    // Logging must never throw.
  }
}

export const logger = {
  info: (scope: string, ...args: unknown[]) => write("info", scope, args),
  warn: (scope: string, ...args: unknown[]) => write("warn", scope, args),
  error: (scope: string, ...args: unknown[]) => write("error", scope, args)
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
