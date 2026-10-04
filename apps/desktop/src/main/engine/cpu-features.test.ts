import { describe, expect, it } from "vitest";
import { detectCpuFeatures, parseFeatures } from "./cpu-features";

describe("cpu features", () => {
  it("maps Linux cpuinfo flags and macOS sysctl names", () => {
    expect(
      [...parseFeatures("fpu sse4_1 sse4_2 popcnt avx avx2 bmi1 bmi2".split(" "))].sort()
    ).toEqual(["avx2", "bmi2", "popcnt", "sse41"]);
    expect([...parseFeatures("fpu sse4.1 popcnt".split(" "))].sort()).toEqual(["popcnt", "sse41"]);
    expect(parseFeatures([]).size).toBe(0);
  });

  it("is unknown off x86-64 and on Windows", async () => {
    expect(await detectCpuFeatures("darwin", "arm64")).toBeNull();
    expect(await detectCpuFeatures("win32", "x64")).toBeNull();
  });
});
