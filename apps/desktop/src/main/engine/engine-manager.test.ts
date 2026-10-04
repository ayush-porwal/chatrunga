import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EngineBestMove,
  EngineConfig,
  EngineError,
  EngineInfo
} from "@chaturanga/shared/types/engine";

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
const pids = () =>
  sent().flatMap((line) => (line.startsWith("pid ") ? [Number(line.slice(4))] : []));

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function collect(manager: InstanceType<typeof EngineManager>) {
  const bestMoves: EngineBestMove[] = [];
  const infos: EngineInfo[] = [];
  const errors: EngineError[] = [];
  manager.on("bestmove", (move) => bestMoves.push(move));
  manager.on("info", (info) => infos.push(info));
  manager.on("error", (error) => errors.push(error));
  return { bestMoves, infos, errors };
}

const expectEventually = (check: () => boolean) =>
  vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 10 });

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
      await manager.start({
        engineId: "sf",
        searchId: `m${ply}`,
        side: "black",
        fen: START,
        moves: moves.slice(0, ply + 1),
        moveTimeMs: 10
      });
      await expectEventually(() => events.bestMoves.length === ply / 2 + 1);
    }
    expect(spawns()).toBe(1);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(1);
    expect(events.bestMoves.map((move) => move.searchId)).toEqual(["m0", "m2"]);
    expect(events.errors).toEqual([]);
  });

  it("live analysis searches until stopped, or to the depth / for the time asked for", async () => {
    collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "a",
      fen: START,
      moves: [],
      multipv: 2
    });
    await expectEventually(() => sent().includes("go infinite"));
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "b",
      fen: START,
      moves: [],
      multipv: 2,
      depth: 18
    });
    await expectEventually(() => sent().includes("go depth 18"));
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "c",
      fen: START,
      moves: [],
      multipv: 2,
      moveTimeMs: 5000
    });
    await expectEventually(() => sent().includes("go movetime 5000"));
  });

  it("dispose resolves once the warm process has exited (a draw probe then runs alone)", async () => {
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "a",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    await manager.dispose();
    expect(sent()).toContain("exit");
  });

  it("dispose kills an engine that ignores quit and SIGTERM, and resolves once it has exited", async () => {
    fakeEngine("stubborn", ["stubborn"]);
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "stubborn",
      searchId: "a",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    const [pid] = pids();
    await manager.dispose();
    expect(isRunning(pid)).toBe(false);
  }, 10_000);

  it("switching engines starts the new process only after the old one has exited", async () => {
    fakeEngine("lc0", ["slow-exit"]);
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "lc0",
      searchId: "a",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "b",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.some((info) => info.searchId === "b"));
    const log = sent();
    expect(spawns()).toBe(2);
    expect(log.indexOf("exit")).toBeGreaterThan(-1);
    expect(log.indexOf("exit")).toBeLessThan(log.lastIndexOf("spawn"));
  });

  it("a search superseded while the old process exits never starts one", async () => {
    fakeEngine("lc0", ["slow-exit"]);
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "lc0",
      searchId: "a",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    const replaced = manager.startAnalysis({
      engineId: "sf",
      searchId: "b",
      fen: START,
      moves: [],
      multipv: 1
    });
    // "b" now waits for the slow-exiting lc0, which has been told to quit.
    await expectEventually(() => sent().includes("quit"));
    await Promise.all([
      replaced,
      manager.startAnalysis({ engineId: "sf", searchId: "c", fen: START, moves: [], multipv: 1 })
    ]);
    await expectEventually(() => events.infos.some((info) => info.searchId === "c"));
    expect(spawns()).toBe(2);
    expect(events.infos.some((info) => info.searchId === "b")).toBe(false);
    expect(events.errors).toEqual([]);
  });

  it("a search requested during a draw probe starts only after the probe finished", async () => {
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "a",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    let finishProbe = () => {};
    const probeDone = new Promise<void>((resolve) => {
      finishProbe = resolve;
    });
    let warmExitedFirst = false;
    const probe = manager.runExclusive(async () => {
      warmExitedFirst = sent().includes("exit");
      await probeDone;
      return "score";
    });
    const search = manager.startAnalysis({
      engineId: "sf",
      searchId: "b",
      fen: START,
      moves: [],
      multipv: 1
    });
    // The warm process is gone: a search that didn't wait for the probe would start one now.
    await expectEventually(() => sent().includes("exit"));
    // oxlint-disable-next-line chaturanga/no-test-sleep -- an absence check: no event marks a spawn that didn't happen
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(spawns()).toBe(1);
    finishProbe();
    await expect(probe).resolves.toBe("score");
    await search;
    await expectEventually(() => events.infos.some((info) => info.searchId === "b"));
    expect(warmExitedFirst).toBe(true);
    expect(spawns()).toBe(2);
    expect(events.errors).toEqual([]);
  });

  it("starts a new game when the position doesn't continue the last one", async () => {
    const events = collect(manager);
    await manager.start({
      engineId: "sf",
      searchId: "a",
      side: "black",
      fen: START,
      moves: ["e2e4"],
      moveTimeMs: 10
    });
    await expectEventually(() => events.bestMoves.length === 1);
    await manager.start({
      engineId: "sf",
      searchId: "b",
      side: "black",
      fen: START,
      moves: ["d2d4"],
      moveTimeMs: 10
    });
    await expectEventually(() => events.bestMoves.length === 2);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(2);
  });

  it("moving through analysis positions reuses the process and drops the old search's output", async () => {
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "p1",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.some((info) => info.searchId === "p1"));
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "p2",
      fen: START,
      moves: ["e2e4"],
      multipv: 1
    });
    const seen = events.infos.length;
    await expectEventually(() => events.infos.slice(seen).some((info) => info.searchId === "p2"));
    expect(spawns()).toBe(1);
    // The first search's bestmove (after stop) was consumed, not relayed.
    expect(events.bestMoves).toEqual([]);
    expect(events.infos.slice(seen).every((info) => info.searchId === "p2")).toBe(true);
    expect(sent()).toContain("setoption name Threads value 2");
  });

  it("drops a search superseded while it waits, without reporting an error", async () => {
    const events = collect(manager);
    const first = manager.startAnalysis({
      engineId: "sf",
      searchId: "old",
      fen: START,
      moves: [],
      multipv: 1
    });
    const second = manager.startAnalysis({
      engineId: "sf",
      searchId: "new",
      fen: START,
      moves: ["d2d4"],
      multipv: 1
    });
    await Promise.all([first, second]);
    await expectEventually(() => events.infos.some((info) => info.searchId === "new"));
    expect(events.infos.some((info) => info.searchId === "old")).toBe(false);
    expect(events.errors).toEqual([]);
    expect(sent().filter((line) => line === "go infinite")).toHaveLength(1);
  });

  it("stop ends the search but keeps the engine warm; a new engine config respawns", async () => {
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "p1",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    await manager.stop();
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "p2",
      fen: START,
      moves: [],
      multipv: 1
    });
    expect(spawns()).toBe(1);
    fakeEngine("other", ["variant"]);
    await manager.startAnalysis({
      engineId: "other",
      searchId: "p3",
      fen: START,
      moves: [],
      multipv: 1
    });
    expect(spawns()).toBe(2);
  });

  it("a new game resets the engine even when it starts from the same position", async () => {
    const events = collect(manager);
    await manager.start({
      engineId: "sf",
      searchId: "a",
      gameKey: "g1",
      side: "white",
      fen: START,
      moves: [],
      moveTimeMs: 10
    });
    await expectEventually(() => events.bestMoves.length === 1);
    await manager.start({
      engineId: "sf",
      searchId: "b",
      gameKey: "g2",
      side: "white",
      fen: START,
      moves: [],
      moveTimeMs: 10
    });
    await expectEventually(() => events.bestMoves.length === 2);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(2);
  });

  it("a slow startup doesn't hold up a newer search or a stop", async () => {
    fakeEngine("slow", ["slow-start"]);
    const events = collect(manager);
    const started = Date.now();
    const slow = manager.startAnalysis({
      engineId: "slow",
      searchId: "slow",
      fen: START,
      moves: [],
      multipv: 1
    });
    // The slow engine is up and waiting for its uciok.
    await expectEventually(() => sent().includes("uci"));
    await manager.stop();
    await slow;
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "fast",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.some((info) => info.searchId === "fast"));
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(events.errors).toEqual([]);
  });

  it("coalesces info lines per MultiPV slot", async () => {
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "p",
      fen: START,
      moves: [],
      multipv: 1
    });
    // Wait for 50 lines (one each depth): the fake prints one every 5 ms, so about 250 ms of them.
    await expectEventually(() => events.infos.some((info) => (info.depth ?? 0) >= 50));
    await manager.stop();
    // At most ~10 batches a second reach the renderer.
    expect(events.infos.length).toBeGreaterThan(0);
    expect(events.infos.length).toBeLessThan(10);
  });

  it("relays Stockfish's lines, not its info strings, and a progress report never hides a line", async () => {
    fakeEngine("stockfish", ["stockfish"]);
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "stockfish",
      searchId: "castled",
      fen: START,
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"],
      multipv: 3
    });
    // Each depth ends with a `currmove` report after its three lines: the last line of slot 1
    // in every batch, unless it's kept from taking that line's place.
    await expectEventually(() => events.infos.some((info) => (info.depth ?? 0) >= 30));
    await manager.stop();

    expect(events.errors).toEqual([]);
    expect(events.infos.some((info) => info.raw.startsWith("info string"))).toBe(false);
    expect(events.infos.every((info) => info.score && info.pv?.length)).toBe(true);
    expect(new Set(events.infos.map((info) => info.multipv))).toEqual(new Set([1, 2, 3]));
    expect(events.infos.find((info) => info.multipv === 1)).toMatchObject({
      searchId: "castled",
      seldepth: expect.any(Number),
      nps: 1048576,
      wdl: { win: 120, draw: 840, loss: 40 },
      score: { type: "cp", value: 35 }
    });
  });

  it("ends a search with the engine's reason when the engine quits during it", async () => {
    fakeEngine("stockfish", ["stockfish"]);
    const events = collect(manager);
    // Castling as chessops writes it (the king taking its rook): Stockfish 19 quits on it.
    await manager.startAnalysis({
      engineId: "stockfish",
      searchId: "refused",
      fen: START,
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1h1"],
      multipv: 1
    });
    await expectEventually(() => events.errors.length === 1);
    expect(events.errors[0]).toEqual({
      engineId: "stockfish",
      searchId: "refused",
      message: "stockfish quit during the search (exit 1): Illegal move: e1h1"
    });
    expect(events.infos).toEqual([]);

    // The next search starts a new process.
    await manager.startAnalysis({
      engineId: "stockfish",
      searchId: "next",
      fen: START,
      moves: ["e2e4"],
      multipv: 1
    });
    await expectEventually(() => events.infos.some((info) => info.searchId === "next"));
    expect(spawns()).toBe(2);
    expect(events.errors).toHaveLength(1);
  });
});

describe("EngineManager review cancels", () => {
  it("keeps a running job's cancel until it finishes", () => {
    const manager = new EngineManager();
    manager.trackReview("r1", true);
    manager.cancelReview("r1");
    expect(manager.isReviewCancelled("r1")).toBe(true);
    manager.trackReview("r1", false);
    manager.clearReviewCancellation("r1");
    expect(manager.isReviewCancelled("r1")).toBe(false);
  });

  it("keeps a cancel that arrives before its job starts", () => {
    const manager = new EngineManager();
    manager.cancelReview("early");
    manager.trackReview("early", true);
    expect(manager.isReviewCancelled("early")).toBe(true);
    manager.clearReviewCancellation("early");
    expect(manager.isReviewCancelled("early")).toBe(false);
  });

  it("forgets the oldest cancels of jobs that aren't running, so late ones don't pile up", () => {
    const manager = new EngineManager();
    manager.trackReview("running", true);
    manager.cancelReview("running");
    for (let index = 0; index < 100; index += 1) manager.cancelReview(`finished-${index}`);
    expect(manager.isReviewCancelled("finished-0")).toBe(false);
    expect(manager.isReviewCancelled("finished-83")).toBe(false);
    expect(manager.isReviewCancelled("finished-84")).toBe(true);
    expect(manager.isReviewCancelled("finished-99")).toBe(true);
    // A running job's cancel is never dropped for them.
    expect(manager.isReviewCancelled("running")).toBe(true);
  });

  it("cancelling everything cancels only what's running", () => {
    const manager = new EngineManager();
    manager.trackReview("a", true);
    manager.trackReview("b", true);
    manager.trackReview("b", false);
    manager.cancelAllReviews();
    expect(manager.isReviewCancelled("a")).toBe(true);
    expect(manager.isReviewCancelled("b")).toBe(false);
  });
});

describe("continuesGame", () => {
  it("is true only for the same start with earlier moves unchanged", () => {
    expect(
      continuesGame(
        { fen: START, moves: ["e2e4"] },
        { fen: START, moves: ["e2e4", "e7e5", "g1f3"] }
      )
    ).toBe(true);
    expect(continuesGame({ fen: START, moves: ["e2e4"] }, { fen: START, moves: ["d2d4"] })).toBe(
      false
    );
    expect(
      continuesGame({ fen: START, moves: ["e2e4", "e7e5"] }, { fen: START, moves: ["e2e4"] })
    ).toBe(false);
    expect(continuesGame(null, { fen: START, moves: [] })).toBe(false);
  });
});
