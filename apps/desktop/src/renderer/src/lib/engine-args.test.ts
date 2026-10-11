import { describe, expect, it } from "vitest";
import { splitEngineArgs } from "./engine-args";

describe("splitEngineArgs", () => {
  it("splits on whitespace and keeps quoted segments together", () => {
    expect(splitEngineArgs("")).toStrictEqual([]);
    expect(splitEngineArgs("  --threads 4  ")).toStrictEqual(["--threads", "4"]);
    expect(splitEngineArgs('--weights "/path with spaces/net.pb" -v')).toStrictEqual([
      "--weights",
      "/path with spaces/net.pb",
      "-v"
    ]);
    expect(splitEngineArgs('"unterminated value')).toStrictEqual(["unterminated value"]);
  });
});
