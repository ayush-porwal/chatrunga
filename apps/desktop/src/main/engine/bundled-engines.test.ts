import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => "/dev/app")
  }
}));

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true)
}));

vi.mock("electron", () => electronMock);
vi.mock("node:fs", () => fsMock);

describe("bundled engines", () => {
  it("resolves dev bundled Stockfish paths", async () => {
    const { bundledEngineRoot, bundledStockfishPath, listBundledEngines } = await import(
      "./bundled-engines"
    );

    expect(bundledEngineRoot()).toBe("/dev/app/src/main/assets/engines");
    expect(bundledStockfishPath()).toContain(`/stockfish/${process.platform}-${process.arch}/`);
    expect(listBundledEngines()[0]).toMatchObject({
      id: "bundled-stockfish",
      runtime: "native-bundled",
      isBundled: true,
      isAvailable: true
    });
  });

  it("marks bundled Stockfish unavailable when the binary is missing", async () => {
    fsMock.existsSync.mockReturnValueOnce(false);
    const { listBundledEngines } = await import("./bundled-engines");

    expect(listBundledEngines()[0]?.isAvailable).toBe(false);
  });
});
