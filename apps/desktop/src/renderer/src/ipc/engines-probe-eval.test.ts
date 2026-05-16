import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEnginesProbeEval } from "./engines-probe-eval";

const input = {
  engineId: "engine-1",
  fen: "startpos",
  moves: [],
  movetimeMs: 250
};

describe("invokeEnginesProbeEval", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails clearly without the desktop preload API", async () => {
    vi.stubGlobal("window", {});

    await expect(invokeEnginesProbeEval(input)).rejects.toThrow("desktop app");
  });

  it("prefers the root preload function", async () => {
    const enginesProbeEval = vi.fn().mockResolvedValue({ type: "cp", value: 42 });
    const nested = vi.fn();
    vi.stubGlobal("window", {
      chaturanga: {
        enginesProbeEval,
        engines: { probeEval: nested }
      }
    });

    await expect(invokeEnginesProbeEval(input)).resolves.toEqual({ type: "cp", value: 42 });
    expect(enginesProbeEval).toHaveBeenCalledWith(input);
    expect(nested).not.toHaveBeenCalled();
  });

  it("falls back to the nested preload function", async () => {
    const nested = vi.fn().mockResolvedValue(null);
    vi.stubGlobal("window", {
      chaturanga: {
        engines: { probeEval: nested }
      }
    });

    await expect(invokeEnginesProbeEval(input)).resolves.toBeNull();
    expect(nested).toHaveBeenCalledWith(input);
  });
});
