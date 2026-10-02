import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Where Lc0 usually lives when the user installed it themselves (upstream publishes no macOS or
 * Linux binaries, so there's no download): Homebrew, /usr/local, the distro's bin and games dirs,
 * then the PATH. An app started from the Finder gets a minimal PATH, so the fixed list comes first.
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
  const fromPath = (input.pathEnv ?? "").split(path.delimiter).filter(Boolean);
  return [...new Set([...fixed, ...fromPath])].map((dir) => path.join(dir, name));
}

/** The first candidate that is an executable file, or null. */
export function detectLc0(
  candidates: readonly string[] = lc0Candidates({
    platform: process.platform,
    pathEnv: process.env.PATH,
    home: homedir()
  }),
  isExecutableFile: (file: string) => boolean = executableFile
): string | null {
  return candidates.find((file) => isExecutableFile(file)) ?? null;
}

function executableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
