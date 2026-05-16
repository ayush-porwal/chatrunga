import { dirname } from "node:path";
import type { EngineConfig } from "../types/engine";

function withoutWeightsCliArgs(args: string[]): string[] {
  return args.filter((a) => !/^--weights(=|$)/.test(a));
}

/**
 * Spawn working directory used for UCI engines.
 * Matches common desktop GUIs (e.g. bundled engines with files next to the binary): cwd is the
 * executable's directory unless `working_directory` was set manually (advanced / legacy installs).
 */
export function engineProcessCwd(config: EngineConfig): string {
  const custom = config.workingDirectory?.trim();
  if (custom) return custom;
  return dirname(config.executablePath.trim());
}

/** Command-line args passed to the engine process (includes `--weights=` when configured in settings). */
export function spawnArgsForEngine(config: EngineConfig): string[] {
  const weights = config.weightsPath?.trim();
  if (!weights) return [...config.args];
  const rest = withoutWeightsCliArgs(config.args);
  return [`--weights=${weights}`, ...rest];
}
