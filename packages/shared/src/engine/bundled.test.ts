import { describe, expect, it } from "vitest";
import { BUNDLED_STOCKFISH_ID, stockfishEngine, stockfishWasmEngine } from "./bundled";

describe("bundled engine catalog", () => {
  it("exposes browser Stockfish as bundled WASM", () => {
    expect(stockfishWasmEngine()).toMatchObject({
      id: BUNDLED_STOCKFISH_ID,
      name: "Stockfish",
      runtime: "wasm",
      isBundled: true,
      isAvailable: true,
      isDefault: true
    });
  });

  it("can represent unavailable native bundled binaries before packaging assets exist", () => {
    const engine = stockfishEngine({
      executablePath: "/missing/stockfish",
      isAvailable: false,
      runtime: "native-bundled"
    });
    expect(engine.executablePath).toBe("/missing/stockfish");
    expect(engine.isAvailable).toBe(false);
  });
});
