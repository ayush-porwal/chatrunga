import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { CpuFeature } from "./engine-manifest";

const exec = promisify(execFile);

/**
 * Best-effort x86-64 feature detection, used only to choose between per-ISA Stockfish builds
 * when a release has no universal build. Returns null when unknown (non-x64, Windows, or the
 * probe failed); callers then pick the most compatible build.
 */
export async function detectCpuFeatures(
  platform: string = process.platform,
  arch: string = process.arch
): Promise<ReadonlySet<CpuFeature> | null> {
  if (arch !== "x64") return null;
  try {
    if (platform === "linux") {
      const cpuinfo = await readFile("/proc/cpuinfo", "utf-8");
      const flags = /^flags\s*:\s*(.*)$/m.exec(cpuinfo)?.[1]?.split(/\s+/) ?? [];
      return parseFeatures(flags.map((flag) => flag.toLowerCase()));
    }
    if (platform === "darwin") {
      const { stdout } = await exec("sysctl", [
        "-n",
        "machdep.cpu.features",
        "machdep.cpu.leaf7_features"
      ]);
      return parseFeatures(stdout.toLowerCase().split(/\s+/));
    }
  } catch {
    // Fall through: unknown.
  }
  return null;
}

/** Maps Linux cpuinfo flags / macOS sysctl feature names to our feature set. */
export function parseFeatures(tokens: readonly string[]): ReadonlySet<CpuFeature> {
  const set = new Set(tokens);
  const out = new Set<CpuFeature>();
  if (set.has("avx2")) out.add("avx2");
  if (set.has("bmi2")) out.add("bmi2");
  if (set.has("sse4_1") || set.has("sse4.1")) out.add("sse41");
  if (set.has("popcnt")) out.add("popcnt");
  return out;
}

let cached: Promise<ReadonlySet<CpuFeature> | null> | null = null;

/** Detects once per process. */
export function cpuFeatures(): Promise<ReadonlySet<CpuFeature> | null> {
  cached ??= detectCpuFeatures();
  return cached;
}
