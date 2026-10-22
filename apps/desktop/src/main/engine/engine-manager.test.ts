import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EngineBestMove,
  EngineConfig,
  EngineError,
  EngineInfo
} from "@chaturanga/shared/types/engine";
import {
  Maia3UnavailableError,
  type Maia3Evaluator,
  type Maia3Output,
  type Maia3Query
} from "@chaturanga/shared/engine/maia3";
import { MAX_THINK_MS, MIN_THINK_MS } from "../maia/think-time";

const FAKE = join(__dirname, "__fixtures__", "fake-live-uci.mjs");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const dir = mkdtempSync(join(tmpdir(), "chaturanga-engine-test-"));
let logFile = "";
const engines = new Map<string, EngineConfig>();

vi.mock("./engine-config", () => ({
  engineConfigForId: (id: string) => engines.get(id) ?? null,
  engineResourceOptions: () => ({ threads: 2, hashMb: 16 })
}));

/** The next engine process to start, scripted by a test (see scriptedEngine); else a real one. */
let nextProcess: ChildProcessWithoutNullStreams | null = null;
vi.mock("./uci-process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./uci-process")>();
  return {
    ...actual,
    spawnUciProcess: (config: EngineConfig) => {
      const proc = nextProcess;
      nextProcess = null;
      return proc ?? actual.spawnUciProcess(config);
    }
  };
});

const { EngineManager, continuesGame } = await import("./engine-manager");

/**
 * The next engine process started is scripted: `reply` answers each command it is sent, through
 * `say` (a line of output), and decides when it exits and when its output has all been read.
 */
function scriptedEngine(
  reply: (
    command: string,
    engine: { say: (line: string) => void; exit: (code: number) => void; close: () => void }
  ) => void
): void {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: undefined,
    exitCode: null as number | null,
    signalCode: null,
    killed: false,
    kill: () => {
      proc.killed = true;
      return true;
    }
  });
  const engine = {
    say: (line: string) => proc.stdout.write(`${line}\n`),
    exit: (code: number) => {
      proc.exitCode = code;
      proc.emit("exit", code, null);
    },
    // Its output read to the end, the process is closed (as Node reports it, after its exit).
    close: () => {
      proc.stdout.once("end", () => proc.emit("close", proc.exitCode, null));
      proc.stdout.end();
    }
  };
  const stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      for (const command of chunk.toString("utf8").split("\n").filter(Boolean))
        reply(command, engine);
      done();
    }
  });
  nextProcess = Object.assign(proc, { stdin }) as unknown as ChildProcessWithoutNullStreams;
}

/** A scripted engine's handshake. */
function handshake(command: string, say: (line: string) => void): void {
  if (command === "uci") {
    say("id name Scripted");
    say("uciok");
  } else if (command === "isready") say("readyok");
}

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

/** Whether some line reached `depth`. */
const reachedDepth = (infos: readonly EngineInfo[], depth: number) =>
  infos.some((info) => (info.depth ?? 0) >= depth);

/** A line with a score and moves. */
const isScoredLine = (info: EngineInfo) => Boolean(info.score && info.pv?.length);

type EngineScript = Parameters<typeof scriptedEngine>[0];

/** Stockfish without its network file: it writes its ERROR lines and quits at `go`. */
const quitsWithoutNetwork: EngineScript = (command, { say, exit, close }) => {
  handshake(command, say);
  if (command !== "go infinite") return;
  exit(1);
  say("info string ERROR: The network file nn-fake.nnue was not loaded successfully.");
  say("info string ERROR: The engine will be terminated now.");
  close();
};

/** At `go`, a line whose moves come without its score, then a progress report. */
const linesWithoutScores: EngineScript = (command, { say }) => {
  handshake(command, say);
  if (command !== "go infinite") return;
  say("info depth 5 seldepth 7 multipv 1 nodes 4096 pv e2e4 e7e5");
  say("info depth 6 currmove d2d4 currmovenumber 1");
};

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
    expect(events.bestMoves.map((move) => move.searchId)).toStrictEqual(["m0", "m2"]);
    expect(events.errors).toStrictEqual([]);
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

  it("sends ucinewgame (then isready) before the position only for a fresh analysis (Restart)", async () => {
    collect(manager);
    const analyse = (searchId: string, fresh?: boolean) =>
      manager.startAnalysis({ engineId: "sf", searchId, fen: START, moves: [], multipv: 1, fresh });
    await analyse("a");
    await expectEventually(() => sent().includes("go infinite"));
    await analyse("b", false);
    expect(sent()).not.toContain("ucinewgame");

    await analyse("c", true);
    await expectEventually(() => sent().filter((line) => line === "go infinite").length === 3);
    const lastSearch = sent().slice(sent().lastIndexOf("ucinewgame"));
    expect(lastSearch.slice(0, 3)).toStrictEqual([
      "ucinewgame",
      "isready",
      `position fen ${START}`
    ]);
    expect(sent().filter((line) => line === "ucinewgame")).toHaveLength(1);
    expect(spawns()).toBe(1);
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
    expect(events.errors).toStrictEqual([]);
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
    expect(events.errors).toStrictEqual([]);
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
    expect(events.bestMoves).toStrictEqual([]);
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
    expect(events.errors).toStrictEqual([]);
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
    expect(events.errors).toStrictEqual([]);
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
    await expectEventually(() => reachedDepth(events.infos, 50));
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
    await expectEventually(() => reachedDepth(events.infos, 30));
    await manager.stop();

    expect(events.errors).toStrictEqual([]);
    expect(events.infos.some((info) => info.raw.startsWith("info string"))).toBe(false);
    expect(events.infos.every(isScoredLine)).toBe(true);
    expect(new Set(events.infos.map((info) => info.multipv))).toStrictEqual(new Set([1, 2, 3]));
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
    expect(events.errors[0]).toStrictEqual({
      engineId: "stockfish",
      searchId: "refused",
      message: "stockfish quit during the search (exit 1): Illegal move: e1h1"
    });
    expect(events.infos).toStrictEqual([]);

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

  it("gives the engine's first reason when its error lines are read after its exit is reported", async () => {
    // Stockfish without its network file: it writes its ERROR lines and quits at `go`. Node can
    // report the exit before those lines are read.
    scriptedEngine(quitsWithoutNetwork);
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "no-network",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.errors.length === 1);
    expect(events.errors[0]).toStrictEqual({
      engineId: "sf",
      searchId: "no-network",
      message:
        "sf quit during the search (exit 1): The network file nn-fake.nnue was not loaded successfully."
    });
  });

  it("a progress report doesn't hide a line whose moves came without its score", async () => {
    scriptedEngine(linesWithoutScores);
    const events = collect(manager);
    await manager.startAnalysis({
      engineId: "sf",
      searchId: "split",
      fen: START,
      moves: [],
      multipv: 1
    });
    await expectEventually(() => events.infos.length > 0);
    expect(events.infos[0]).toMatchObject({ searchId: "split", depth: 5, pv: ["e2e4", "e7e5"] });
  });
});

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/** A Maia 3 stand-in: each request waits until the test answers it (or its signal aborts). */
function pendingMaia() {
  const requests: {
    queries: readonly Maia3Query[];
    options?: { priority?: string; signal?: AbortSignal };
    answer: (policy: Record<string, number>) => void;
    fail: (error: Error) => void;
  }[] = [];
  const evaluator: Maia3Evaluator = {
    isInstalled: () => true,
    dispose: () => undefined,
    evaluate: (queries, options) =>
      new Promise<Maia3Output[]>((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        requests.push({
          queries,
          options,
          answer: (policy) => resolve(queries.map(() => ({ policy, value: 0.5 }))),
          fail: reject
        });
      })
  };
  return { evaluator, requests };
}

function maiaRow(): EngineConfig {
  const config: EngineConfig = {
    id: "maia",
    name: "Maia (managed)",
    executablePath: "/engines/maia3_simplified.onnx",
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [],
    protocol: "uci",
    runtime: "maia3",
    isAvailable: true,
    isDefault: false,
    isHumanPrediction: true,
    createdAt: 0,
    updatedAt: 0
  };
  engines.set(config.id, config);
  return config;
}

const maiaGame = {
  engineId: "maia",
  side: "black" as const,
  fen: START,
  moves: ["e2e4"],
  maia: { rating: 1800, opponentRating: 1400 }
};

describe("EngineManager Maia games", () => {
  let manager: InstanceType<typeof EngineManager>;
  let maia: ReturnType<typeof pendingMaia>;

  beforeEach(() => {
    maiaRow();
    maia = pendingMaia();
    // 0.7 of the way through the policy: the second move of a 60/40 split.
    manager = new EngineManager({ maia3: () => maia.evaluator, random: () => 0.7 });
  });

  afterEach(() => {
    vi.useRealTimers();
    return manager.dispose();
  });

  it("plays a move drawn from Maia's policy at once in an untimed game, at its rating against the user's", async () => {
    const events = collect(manager);
    const started = manager.start({ ...maiaGame, searchId: "m1" });
    await vi.waitFor(() => expect(maia.requests).toHaveLength(1));
    expect(maia.requests[0].queries).toStrictEqual([
      { fen: AFTER_E4, eloSelf: 1800, eloOppo: 1400 }
    ]);
    expect(maia.requests[0].options?.priority).toBe("game");
    maia.requests[0].answer({ e7e5: 0.6, c7c5: 0.4 });
    await started;
    expect(events.bestMoves).toStrictEqual([{ engineId: "maia", searchId: "m1", move: "c7c5" }]);
    expect(events.errors).toStrictEqual([]);
  });

  it("drops a move superseded or stopped while Maia evaluates, without an error", async () => {
    const events = collect(manager);
    const first = manager.start({ ...maiaGame, searchId: "old" });
    await vi.waitFor(() => expect(maia.requests).toHaveLength(1));
    const second = manager.start({ ...maiaGame, searchId: "new" });
    await first;
    expect(maia.requests[0].options?.signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(maia.requests).toHaveLength(2));
    const stopped = manager.stop();
    await second;
    await stopped;
    // A late answer changes nothing.
    maia.requests[1].answer({ e7e5: 1 });
    await Promise.resolve();
    expect(events.bestMoves).toStrictEqual([]);
    expect(events.errors).toStrictEqual([]);
  });

  it("thinks for a human-like time in a timed game, and a stop cancels the wait", async () => {
    vi.useFakeTimers();
    const events = collect(manager);
    const clock = { wtime: 300_000, btime: 300_000, winc: 0, binc: 0 };
    const started = manager.start({ ...maiaGame, searchId: "timed", clock });
    await vi.waitFor(() => expect(maia.requests).toHaveLength(1));
    maia.requests[0].answer({ e7e5: 0.6, c7c5: 0.4 });
    await vi.advanceTimersByTimeAsync(MIN_THINK_MS - 1);
    expect(events.bestMoves).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(MAX_THINK_MS);
    await started;
    expect(events.bestMoves.map((move) => move.move)).toStrictEqual(["c7c5"]);

    const next = manager.start({
      ...maiaGame,
      moves: ["e2e4", "c7c5", "g1f3"],
      searchId: "t2",
      clock
    });
    await vi.waitFor(() => expect(maia.requests).toHaveLength(2));
    maia.requests[1].answer({ d7d6: 1 });
    await vi.advanceTimersByTimeAsync(10);
    await manager.stop();
    await next;
    await vi.advanceTimersByTimeAsync(MAX_THINK_MS);
    expect(events.bestMoves).toHaveLength(1);
  });

  it("reports Maia failing as a UCI engine's failure: an error event and a rejection", async () => {
    const events = collect(manager);
    const started = manager.start({ ...maiaGame, searchId: "m1" });
    await vi.waitFor(() => expect(maia.requests).toHaveLength(1));
    maia.requests[0].fail(new Maia3UnavailableError("The Maia 3 model isn't installed."));
    await expect(started).rejects.toThrow(/isn't installed/);
    expect(events.errors).toStrictEqual([
      { engineId: "maia", searchId: "m1", message: "The Maia 3 model isn't installed." }
    ]);
  });

  it("refuses Maia for live analysis, and its engine test loads Maia 3", async () => {
    const events = collect(manager);
    await expect(
      manager.startAnalysis({ engineId: "maia", searchId: "a1", fen: START, moves: [] })
    ).rejects.toThrow(/Maia can't be used for analysis/);
    expect(events.errors).toHaveLength(1);

    const tested = manager.testEngine("maia");
    await vi.waitFor(() => expect(maia.requests).toHaveLength(1));
    maia.requests[0].answer({ e2e4: 1 });
    await expect(tested).resolves.toStrictEqual({
      ok: true,
      name: "Maia 3",
      author: "CSSLab",
      isHumanPrediction: true
    });
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
