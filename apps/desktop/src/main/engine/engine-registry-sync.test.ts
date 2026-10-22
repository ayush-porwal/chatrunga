import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AssetId, AssetRecord } from "./asset-manager";

/** The engines table, in memory: one default at a time, as the SQLite repository keeps it. */
const db = vi.hoisted(() => ({ engines: [] as EngineConfig[], nextId: 1 }));
vi.mock("../db/repositories", () => ({
  engineRepository: {
    list: () => db.engines.map((engine) => ({ ...engine })),
    create: (input: Partial<EngineConfig> & Pick<EngineConfig, "name" | "executablePath">) => {
      if (input.isDefault) for (const engine of db.engines) engine.isDefault = false;
      const created = {
        id: `e${db.nextId++}`,
        weightsPath: null,
        isDefault: false,
        isHumanPrediction: false,
        runtime: "custom-uci",
        isAvailable: true,
        ...input
      } as EngineConfig;
      db.engines.push(created);
      return created;
    },
    update: (id: string, patch: Partial<EngineConfig>) => {
      if (patch.isDefault) for (const engine of db.engines) engine.isDefault = false;
      Object.assign(db.engines.find((engine) => engine.id === id)!, patch);
    },
    remove: (id: string) => {
      db.engines = db.engines.filter((engine) => engine.id !== id);
    }
  }
}));

/** What the asset manager reports as installed; anything not listed is missing. */
const installed = vi.hoisted(() => ({ records: {} as Partial<Record<string, string>> }));
vi.mock("./asset-manager", () => ({
  getAssetManager: () => ({
    getInstalled: () =>
      new Proxy({} as Record<AssetId, AssetRecord>, {
        get: (_target, id: string): AssetRecord => {
          const file = installed.records[id];
          return {
            id: id as AssetId,
            state: file ? "installed" : "missing",
            installedPath: file ?? null,
            customPath: null,
            sha256: null,
            manifestVersion: null,
            sizeBytes: 0,
            installedAt: null
          };
        }
      })
  })
}));

/** A fresh module per test: what the sync remembers within a run starts empty (a new launch). */
let syncAssetsToEngineRegistry: () => Promise<string[]>;

const byName = (name: string) => db.engines.find((engine) => engine.name === name);
const defaults = () => db.engines.filter((engine) => engine.isDefault).map((engine) => engine.name);

describe("syncAssetsToEngineRegistry", () => {
  beforeEach(async () => {
    db.engines = [];
    db.nextId = 1;
    installed.records = {};
    vi.resetModules();
    ({ syncAssetsToEngineRegistry } = await import("./engine-registry-sync"));
  });

  it("adds Lc0 on its network once both are installed, after Stockfish, which stays the default", async () => {
    installed.records = { stockfish: "/engines/stockfish", lc0: "/engines/lc0" };
    await syncAssetsToEngineRegistry();
    // No network yet.
    expect(byName("Lc0 (managed)")).toBeUndefined();

    installed.records["lc0-network"] = "/engines/lc0-network.pb.gz";
    await syncAssetsToEngineRegistry();
    expect(byName("Lc0 (managed)")).toMatchObject({
      executablePath: "/engines/lc0",
      weightsPath: "/engines/lc0-network.pb.gz",
      isDefault: false,
      isHumanPrediction: false
    });
    expect(byName("Stockfish (managed)")?.isDefault).toBe(true);
  });

  it("keeps Stockfish the default when Stockfish and Lc0 arrive in the same sync", async () => {
    installed.records = {
      stockfish: "/engines/stockfish",
      lc0: "/engines/lc0",
      "lc0-network": "/engines/lc0-network.pb.gz"
    };
    await syncAssetsToEngineRegistry();
    expect(
      db.engines.filter((engine) => engine.isDefault).map((engine) => engine.name)
    ).toStrictEqual(["Stockfish (managed)"]);
  });

  it("makes Lc0 the default only when no other engine is, until Stockfish arrives in a later sync", async () => {
    installed.records = { lc0: "/engines/lc0", "lc0-network": "/engines/lc0-network.pb.gz" };
    await syncAssetsToEngineRegistry();
    expect(defaults()).toStrictEqual(["Lc0 (managed)"]);

    installed.records.stockfish = "/engines/stockfish";
    await syncAssetsToEngineRegistry();
    expect(defaults()).toStrictEqual(["Stockfish (managed)"]);
  });

  it("keeps an Lc0 default the user chose when Stockfish is installed again", async () => {
    installed.records = {
      stockfish: "/engines/stockfish",
      lc0: "/engines/lc0",
      "lc0-network": "/engines/lc0-network.pb.gz"
    };
    await syncAssetsToEngineRegistry();
    // Settings → Engines → Set as default.
    for (const engine of db.engines) engine.isDefault = engine.name === "Lc0 (managed)";

    delete installed.records.stockfish;
    await syncAssetsToEngineRegistry();
    installed.records.stockfish = "/engines/stockfish";
    await syncAssetsToEngineRegistry();
    expect(byName("Stockfish (managed)")).toBeDefined();
    expect(defaults()).toStrictEqual(["Lc0 (managed)"]);
  });

  it("follows a newly chosen network or Lc0 binary in place", async () => {
    installed.records = { lc0: "/engines/lc0", "lc0-network": "/engines/lc0-network.pb.gz" };
    await syncAssetsToEngineRegistry();
    const id = byName("Lc0 (managed)")?.id;

    installed.records = { lc0: "/opt/homebrew/bin/lc0", "lc0-network": "/nets/BT4.pb.gz" };
    await syncAssetsToEngineRegistry();
    expect(byName("Lc0 (managed)")).toMatchObject({
      id,
      executablePath: "/opt/homebrew/bin/lc0",
      weightsPath: "/nets/BT4.pb.gz"
    });
  });

  it("removes Lc0 when its network or Lc0 goes, leaving Maia, Stockfish and the user's engines", async () => {
    installed.records = {
      stockfish: "/engines/stockfish",
      lc0: "/engines/lc0",
      "lc0-network": "/engines/lc0-network.pb.gz",
      maia3: "/engines/maia3_simplified.onnx"
    };
    db.engines.push({
      id: "own",
      name: "Lc0",
      executablePath: "/usr/local/bin/lc0",
      weightsPath: "/nets/own.pb.gz",
      isDefault: false,
      isHumanPrediction: false,
      isAvailable: true
    } as EngineConfig);
    await syncAssetsToEngineRegistry();
    const lc0Id = byName("Lc0 (managed)")?.id;
    expect(lc0Id).toBeDefined();

    delete installed.records["lc0-network"];
    // The removed rows' ids come back, for their picture copies to be deleted.
    await expect(syncAssetsToEngineRegistry()).resolves.toStrictEqual([lc0Id]);
    expect(db.engines.map((engine) => engine.name).sort()).toStrictEqual([
      "Lc0",
      "Maia (managed)",
      "Stockfish (managed)"
    ]);
  });

  it("keeps one Maia 3 row while the model is installed, following its file, and removes it after", async () => {
    installed.records = {
      stockfish: "/engines/stockfish",
      maia3: "/engines/maia3_simplified.onnx"
    };
    await syncAssetsToEngineRegistry();
    await syncAssetsToEngineRegistry();
    const maia = db.engines.filter((engine) => engine.runtime === "maia3");
    expect(maia).toHaveLength(1);
    expect(maia[0]).toMatchObject({
      name: "Maia (managed)",
      executablePath: "/engines/maia3_simplified.onnx",
      isHumanPrediction: true,
      isDefault: false
    });

    installed.records.maia3 = "/elsewhere/maia3_simplified.onnx";
    await syncAssetsToEngineRegistry();
    expect(byName("Maia (managed)")).toMatchObject({
      id: maia[0].id,
      executablePath: "/elsewhere/maia3_simplified.onnx"
    });

    delete installed.records.maia3;
    await expect(syncAssetsToEngineRegistry()).resolves.toStrictEqual([maia[0].id]);
    expect(byName("Maia (managed)")).toBeUndefined();
  });

  it("finds the Maia row by its runtime (repairing one that lost it), never a user's engine of that name", async () => {
    const row = (id: string, name: string, executablePath: string): EngineConfig =>
      ({
        id,
        name,
        executablePath,
        weightsPath: null,
        isDefault: false,
        isHumanPrediction: false,
        runtime: "custom-uci",
        isAvailable: true
      }) as EngineConfig;
    db.engines = [
      // Renamed by the user, still the Maia row.
      { ...row("renamed", "My Maia 3", "/engines/maia3_simplified.onnx"), runtime: "maia3" },
      row("users", "Maia (managed)", "/opt/engines/some-uci")
    ];
    installed.records = { maia3: "/engines/maia3_simplified.onnx" };
    await syncAssetsToEngineRegistry();
    expect(
      db.engines.filter((engine) => engine.runtime === "maia3").map((e) => e.id)
    ).toStrictEqual(["renamed"]);
    expect(db.engines.find((engine) => engine.id === "users")).toMatchObject({
      executablePath: "/opt/engines/some-uci",
      runtime: "custom-uci"
    });

    // A managed row that lost its runtime (it runs the model file) is repaired, not duplicated.
    db.engines = [row("lost", "Maia (managed)", "/engines/maia3_simplified.onnx")];
    await syncAssetsToEngineRegistry();
    expect(db.engines.map((engine) => [engine.id, engine.runtime])).toStrictEqual([
      ["lost", "maia3"]
    ]);

    // Removing the model removes the Maia row, and only it.
    db.engines.push(row("users", "Maia (managed)", "/opt/engines/some-uci"));
    delete installed.records.maia3;
    await expect(syncAssetsToEngineRegistry()).resolves.toStrictEqual(["lost"]);
    expect(db.engines.map((engine) => engine.id)).toStrictEqual(["users"]);
  });

  it("removes Maia 1's managed rows, keeping a user's own Maia 1 engine as a flagged UCI engine", async () => {
    const maia1 = (id: string, name: string, weightsPath: string): EngineConfig =>
      ({
        id,
        name,
        executablePath: "/engines/lc0",
        weightsPath,
        runtime: "custom-uci",
        isDefault: false,
        isHumanPrediction: true,
        isAvailable: true
      }) as EngineConfig;
    db.engines.push(
      maia1("m1100", "Maia 1100 (managed)", "/engines/maia-1100.pb.gz"),
      maia1("m1900", "Maia 1900 (managed)", "/engines/maia-1900.pb.gz"),
      // Added by the user, not flagged yet: it is flagged (it's no evaluator), never removed.
      { ...maia1("own", "My Maia", "/nets/maia-1500.pb.gz"), isHumanPrediction: false }
    );
    installed.records = {
      stockfish: "/engines/stockfish",
      maia3: "/engines/maia3_simplified.onnx"
    };
    const removed = await syncAssetsToEngineRegistry();
    expect(removed.sort()).toStrictEqual(["m1100", "m1900"]);
    expect(db.engines.map((engine) => engine.name).sort()).toStrictEqual([
      "Maia (managed)",
      "My Maia",
      "Stockfish (managed)"
    ]);
    expect(byName("My Maia")).toMatchObject({ runtime: "custom-uci", isHumanPrediction: true });
    // Neither Maia becomes the default.
    expect(defaults()).toStrictEqual(["Stockfish (managed)"]);
  });
});
