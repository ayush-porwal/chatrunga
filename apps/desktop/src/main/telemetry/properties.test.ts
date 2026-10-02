import { describe, expect, it } from "vitest";
import { engineFamily, modelProperties, plyBucket, reviewFailureCode } from "./properties";

describe("telemetry properties", () => {
  it("codes review failures without their text", () => {
    expect(reviewFailureCode(new Error("Engine not found"))).toBe("engine_not_found");
    expect(reviewFailureCode(new Error("spawn /x ENOENT"))).toBe("engine_unavailable");
    expect(reviewFailureCode(new Error("sf exited unexpectedly (code 9)"))).toBe("engine_exited");
    expect(reviewFailureCode(new Error("Stockfish did not answer go movetime 1000 within 30s."))).toBe("timeout");
    expect(reviewFailureCode(new Error("Timed out waiting for uciok"))).toBe("timeout");
    expect(reviewFailureCode("something else")).toBe("unknown");
  });

  it("reduces engines to coarse families and names models with their vendor", () => {
    expect(engineFamily({ name: "My engine", executablePath: "/opt/stockfish-17" })).toBe("stockfish");
    expect(engineFamily({ name: "Leela", executablePath: "C:\\\\x\\\\lc0.exe" })).toBe("lc0");
    expect(engineFamily({ name: "Dragon 3", executablePath: "/opt/dragon" })).toBe("other");
    expect(modelProperties("openai/gpt-x")).toEqual({
      model: "openai/gpt-x",
      model_vendor: "openai",
      model_is_default: false
    });
    expect(modelProperties(" my-own/fine-tune ")).toEqual({
      model: "my-own/fine-tune",
      model_vendor: "custom",
      model_is_default: false
    });
    expect(modelProperties("").model_is_default).toBe(true);
    expect([0, 10, 40, 41, 120, 300].map(plyBucket)).toEqual(["0", "1-20", "21-40", "41-80", "81-120", "121+"]);
  });
});
