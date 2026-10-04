import { describe, expect, it } from "vitest";
import { splitEngineArgs } from "./engine-args";

describe("splitEngineArgs", () => {
  it("splits on whitespace and keeps quoted segments together", () => {
    expect(splitEngineArgs("")).toEqual([]);
    expect(splitEngineArgs("  --threads 4  ")).toEqual(["--threads", "4"]);
    expect(splitEngineArgs('--weights "/path with spaces/net.pb" -v')).toEqual([
      "--weights",
      "/path with spaces/net.pb",
      "-v"
    ]);
    expect(splitEngineArgs('"unterminated value')).toEqual(["unterminated value"]);
  });
});
