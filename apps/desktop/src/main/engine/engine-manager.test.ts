import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineBestMove, EngineConfig, EngineError, EngineInfo } from "@chaturanga/shared/types/engine";

const FAKE = join(__dirname, "__fixtures__", "fake-live-uci.mjs");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const dir = mkdtempSync(join(tmpdir(), "chaturanga-engine-test-"));
let logFile = "";
const engines = new Map<string, EngineConfig>();

vi.mock("./engine-config", () => ({
  engineConfigForId: (id: string) => engines.get(id) ?? null,
  engineResourceOptions: () => ({ threads: 2, hashMb: 16 })
}));

const { EngineManager, continuesGame } = await import("./engine-manager");

function fakeEngine(id: string, extraArgs: string[] = []): EngineConfig {
  const config: EngineConfig = {
    id,
    name: id,
    executablePath: process.execPath,
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [FAKE, logFile, ...extraArgs],
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0
  };
  engines.set(id, config);
  return config;
}

const sent = () => readFileSync(logFile, "utf8").split("\n").filter(Boolean);
const spawns = () => sent().filter((line) => line === "spawn").length;

function collect(manager: InstanceType<typeof EngineManager>) {
  const bestMoves: EngineBestMove[] = [];
  const infos: EngineInfo[] = [];
  const errors: EngineError[] = [];
  manager.on("bestmove", (move) => bestMoves.push(move));
  manager.on("info", (info) => infos.push(info));
  manager.on("error", (error) => errors.push(error));
  return { bestMoves, infos, errors };
}

const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 10 });

describe("EngineManager", () => {
  let manager: InstanceType<typeof EngineManager>;
  let count = 0;

  beforeEach(() => {
    count += 1;
    logFile = join(dir, `log-${count}.txt`);
    manager = new EngineManager();
    fakeEngine("sf");
  });

  afterEach(() => manager.dispose());
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps one process for a whole engine game and sends ucinewgame only at the start", async () => {
    const events = collect(manager);
    const moves = ["e2e4", "e7e5", "g1f3", "b8c6"];
    for (let ply = 0; ply < moves.length; ply += 2) {
      await manager.start({ engineId: "sf", searchId: `m${ply}`, side: "black", fen: START, moves: moves.slice(0, ply + 1), moveTimeMs: 10 });
      await until(() => events.bestMoves.length === ply / 2 + 1);
    }
    expect(spawns()).toBe(1);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(1);
    expect(events.bestMoves.map((move) => move.searchId)).toEqual(["m0", "m2"]);
    expect(events.errors).toEqual([]);
  });

  it("dispose resolves once the warm process has exited (a draw probe then runs alone)", async () => {
    const events = collect(manager);
    await manager.startAnalysis({ engineId: "sf", searchId: "a", fen: START, moves: [], multipv: 1 });
    await until(() => events.infos.length > 0);
    await manager.dispose();
    expect(sent()).toContain("exit");
  });

  it("starts a new game when the position doesn't continue the last one", async () => {
    const events = collect(manager);
    await manager.start({ engineId: "sf", searchId: "a", side: "black", fen: START, moves: ["e2e4"], moveTimeMs: 10 });
    await until(() => events.bestMoves.length === 1);
    await manager.start({ engineId: "sf", searchId: "b", side: "black", fen: START, moves: ["d2d4"], moveTimeMs: 10 });
    await until(() => events.bestMoves.length === 2);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(2);
  });

  it("moving through analysis positions reuses the process and drops the old search's output", async () => {
    const events = collect(manager);
    await manager.startAnalysis({ engineId: "sf", searchId: "p1", fen: START, moves: [], multipv: 1 });
    await until(() => events.infos.some((info) => info.searchId === "p1"));
    await manager.startAnalysis({ engineId: "sf", searchId: "p2", fen: START, moves: ["e2e4"], multipv: 1 });
    const seen = events.infos.length;
    await until(() => events.infos.slice(seen).some((info) => info.searchId === "p2"));
    expect(spawns()).toBe(1);
    // The first search's bestmove (after stop) was consumed, not relayed.
    expect(events.bestMoves).toEqual([]);
    expect(events.infos.slice(seen).every((info) => info.searchId === "p2")).toBe(true);
    expect(sent()).toContain("setoption name Threads value 2");
  });

  it("drops a search superseded while it waits, without reporting an error", async () => {
    const events = collect(manager);
    const first = manager.startAnalysis({ engineId: "sf", searchId: "old", fen: START, moves: [], multipv: 1 });
    const second = manager.startAnalysis({ engineId: "sf", searchId: "new", fen: START, moves: ["d2d4"], multipv: 1 });
    await Promise.all([first, second]);
    await until(() => events.infos.some((info) => info.searchId === "new"));
    expect(events.infos.some((info) => info.searchId === "old")).toBe(false);
    expect(events.errors).toEqual([]);
    expect(sent().filter((line) => line === "go infinite")).toHaveLength(1);
  });

  it("stop ends the search but keeps the engine warm; a new engine config respawns", async () => {
    const events = collect(manager);
    await manager.startAnalysis({ engineId: "sf", searchId: "p1", fen: START, moves: [], multipv: 1 });
    await until(() => events.infos.length > 0);
    await manager.stop();
    await manager.startAnalysis({ engineId: "sf", searchId: "p2", fen: START, moves: [], multipv: 1 });
    expect(spawns()).toBe(1);
    fakeEngine("other", ["variant"]);
    await manager.startAnalysis({ engineId: "other", searchId: "p3", fen: START, moves: [], multipv: 1 });
    expect(spawns()).toBe(2);
  });

  it("a new game resets the engine even when it starts from the same position", async () => {
    const events = collect(manager);
    await manager.start({ engineId: "sf", searchId: "a", gameKey: "g1", side: "white", fen: START, moves: [], moveTimeMs: 10 });
    await until(() => events.bestMoves.length === 1);
    await manager.start({ engineId: "sf", searchId: "b", gameKey: "g2", side: "white", fen: START, moves: [], moveTimeMs: 10 });
    await until(() => events.bestMoves.length === 2);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(2);
  });

  it("a slow startup doesn't hold up a newer search or a stop", async () => {
    fakeEngine("slow", ["slow-start"]);
    const events = collect(manager);
    const started = Date.now();
    const slow = manager.startAnalysis({ engineId: "slow", searchId: "slow", fen: START, moves: [], multipv: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await manager.stop();
    await slow;
    await manager.startAnalysis({ engineId: "sf", searchId: "fast", fen: START, moves: [], multipv: 1 });
    await until(() => events.infos.some((info) => info.searchId === "fast"));
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(events.errors).toEqual([]);
  });

  it("coalesces info lines per MultiPV slot", async () => {
    const events = collect(manager);
    await manager.startAnalysis({ engineId: "sf", searchId: "p", fen: START, moves: [], multipv: 1 });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await manager.stop();
    // The fake prints a line every 5 ms; at most ~10 batches a second reach the renderer.
    expect(events.infos.length).toBeGreaterThan(0);
    expect(events.infos.length).toBeLessThan(10);
  });
});

describe("continuesGame", () => {
  it("is true only for the same start with earlier moves unchanged", () => {
    expect(continuesGame({ fen: START, moves: ["e2e4"] }, { fen: START, moves: ["e2e4", "e7e5", "g1f3"] })).toBe(true);
    expect(continuesGame({ fen: START, moves: ["e2e4"] }, { fen: START, moves: ["d2d4"] })).toBe(false);
    expect(continuesGame({ fen: START, moves: ["e2e4", "e7e5"] }, { fen: START, moves: ["e2e4"] })).toBe(false);
    expect(continuesGame(null, { fen: START, moves: [] })).toBe(false);
  });
});
