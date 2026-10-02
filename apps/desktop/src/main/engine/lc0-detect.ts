import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** A candidate that hasn't answered by then (a hung network mount on the PATH) is skipped. */
const CANDIDATE_TIMEOUT_MS = 1_000;

/**
 * Where Lc0 usually lives when the user installed it themselves (upstream publishes no macOS or
 * Linux binaries, so there's no download): Homebrew, /usr/local, the distro's bin and games dirs,
 * then the PATH. An app started from the Finder gets a minimal PATH, so the fixed list comes first.
 * Only absolute directories: a relative PATH entry would store a path that can't be spawned.
 */
export function lc0Candidates(input: {
  platform: NodeJS.Platform;
  pathEnv: string | undefined;
  home: string;
}): string[] {
  const name = input.platform === "win32" ? "lc0.exe" : "lc0";
  const fixed =
    input.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin"]
      : input.platform === "linux"
        ? ["/usr/bin", "/usr/local/bin", "/usr/games", "/snap/bin", path.join(input.home, ".local/bin")]
        : [];
  const fromPath = (input.pathEnv ?? "").split(path.delimiter).filter((dir) => dir && path.isAbsolute(dir));
  return [...new Set([...fixed, ...fromPath])].map((dir) => path.join(dir, name));
}

/**
 * The first candidate that is an executable file, or null. Checked one at a time without blocking
 * the main process; each check gives up after {@link CANDIDATE_TIMEOUT_MS}.
 */
export async function detectLc0(
  candidates: readonly string[] = lc0Candidates({
    platform: process.platform,
    pathEnv: process.env.PATH,
    home: homedir()
  }),
  isExecutableFile: (file: string) => Promise<boolean> = executableFile,
  timeoutMs = CANDIDATE_TIMEOUT_MS
): Promise<string | null> {
  for (const file of candidates) {
    if (await withTimeout(isExecutableFile(file), timeoutMs)) return file;
  }
  return null;
}

async function executableFile(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function withTimeout(check: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    check.catch(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    })
  ]).finally(() => clearTimeout(timer));
}
