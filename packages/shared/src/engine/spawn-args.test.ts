import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { EngineConfig } from "../types/engine";
import { engineProcessCwd, spawnArgsForEngine } from "./spawn-args";

function base(): EngineConfig {
  return {
    id: "1",
    name: "lc0",
    executablePath: "/bin/lc0",
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [],
    protocol: "uci",
    runtime: "custom-uci",
    isBundled: false,
    isAvailable: true,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0
  };
}

describe("engineProcessCwd", () => {
  it("defaults to dirname(executablePath) when workingDirectory unset", () => {
    const config = base();
    config.executablePath = join("/opt", "lc0", "lc0");
    config.workingDirectory = null;
    expect(engineProcessCwd(config)).toBe(join("/opt", "lc0"));
  });

  it("honors explicit workingDirectory from config", () => {
    const config = base();
    config.executablePath = join("/opt", "lc0", "lc0");
    config.workingDirectory = "/data/models";
    expect(engineProcessCwd(config)).toBe("/data/models");
  });
});

describe("spawnArgsForEngine", () => {
  it("prefers weights path flag when weightsPath is set and strips duplicates from args", () => {
    const config = base();
    config.weightsPath = "/data/net.pb.gz";
    config.args = ["--threads=2", "--weights=/ignored/path"];
    expect(spawnArgsForEngine(config)).toEqual(["--weights=/data/net.pb.gz", "--threads=2"]);
  });

  it("passes through args when weightsPath is absent", () => {
    const config = base();
    config.args = ["--foo=bar"];
    expect(spawnArgsForEngine(config)).toEqual(["--foo=bar"]);
  });
});
