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
    installed.records = {
      stockfish: "/engines/stockfish",
      lc0: "/engines/lc0",
      "maia-1500": "/engines/maia-1500.pb.gz"
    };
    await syncAssetsToEngineRegistry();
    // No network yet: only Maia runs in Lc0.
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
    expect(byName("Maia 1500 (managed)")).toMatchObject({
      weightsPath: "/engines/maia-1500.pb.gz",
      isHumanPrediction: true
    });
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
      "maia-1100": "/engines/maia-1100.pb.gz"
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
      "Maia 1100 (managed)",
      "Stockfish (managed)"
    ]);

    const maiaId = byName("Maia 1100 (managed)")?.id;
    installed.records["lc0-network"] = "/engines/lc0-network.pb.gz";
    delete installed.records.lc0;
    await expect(syncAssetsToEngineRegistry()).resolves.toStrictEqual([maiaId]);
    expect(byName("Lc0 (managed)")).toBeUndefined();
    expect(byName("Maia 1100 (managed)")).toBeUndefined();
    expect(byName("Stockfish (managed)")).toBeDefined();
  });
});
