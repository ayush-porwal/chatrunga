import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trapReviewMoves } from "@chaturanga/shared/chess/__fixtures__/trap-game";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import {
  scanFromReview,
  type GeneratedPuzzle,
  type GeneratePuzzlesInput
} from "@chaturanga/shared/chess/puzzle-generator";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import {
  DEFAULT_GAME_PUZZLE_SETTINGS,
  GAME_PUZZLE_DEPTHS,
  type GamePuzzleEngineState,
  type GamePuzzleGenerationEvent,
  type GamePuzzleSettings
} from "@chaturanga/shared/types/game-puzzles";
import { uniformRatings } from "@chaturanga/shared/types/ratings";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-puzzle-queue-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("../db");
const { gameRepository } = await import("../db/repositories");
const { gamePuzzleRepository: repository } = await import("./repository");
const { GamePuzzleQueue, attachReviewHook } = await import("./generation-queue");

const T0 = Date.UTC(2026, 9, 20, 12);
const TRAP_PGN = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#";

const stockfish: EngineConfig = {
  id: "sf",
  name: "Stockfish",
  executablePath: "/engines/stockfish",
  workingDirectory: null,
  weightsPath: null,
  imagePath: null,
  args: [],
  protocol: "uci",
  runtime: "custom-uci",
  isAvailable: true,
  isDefault: true,
  createdAt: 0,
  updatedAt: 0
};

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function saveGame(id: string, playedAt: number, headers = '[White "Me"]\n[Black "Rival"]'): void {
  const { game } = importPgnText(`${headers}\n[TimeControl "600+0"]\n\n${TRAP_PGN} 0-1`);
  gameRepository.saveImported({ ...game, id, source: "lichess" }, playedAt);
}

function settings(patch: Partial<GamePuzzleSettings> = {}): GamePuzzleSettings {
  return {
    ...DEFAULT_GAME_PUZZLE_SETTINGS,
    sources: [...DEFAULT_GAME_PUZZLE_SETTINGS.sources],
    timeControls: [...DEFAULT_GAME_PUZZLE_SETTINGS.timeControls],
    kinds: ["mistake"],
    depth: "quick",
    limit: null,
    ...patch
  };
}

function foundPuzzle(input: GeneratePuzzlesInput): GeneratedPuzzle {
  return {
    ply: 3,
    kind: "mistake",
    tags: [],
    solverSide: input.userSide,
    startFen: input.rootFen,
    setupMove: input.moves[0] ?? null,
    solution: ["g1f3"],
    playedMove: input.moves[2] ?? "",
    winBefore: 55,
    winAfter: 30,
    difficulty: null,
    difficultyCapped: false,
    userChance: null,
    chanceRating: null,
    themes: [],
    positionKey: "key",
    generatorVersion: 1,
    depths: input.depths
  };
}

/* ------------------------------------------------------------------ the fakes */

let events: GamePuzzleGenerationEvent[] = [];
let watchers: { predicate: (event: GamePuzzleGenerationEvent) => boolean; done: () => void }[] = [];
/** Resolves at the first event (from now on) that `predicate` holds for. */
function eventWhere(predicate: (event: GamePuzzleGenerationEvent) => boolean): Promise<void> {
  return new Promise((done) => watchers.push({ predicate, done }));
}
const finished = (gameId: string) => eventWhere((event) => event.finished?.gameId === gameId);
/** The games the queue reported finished, in order. */
const results = () => events.flatMap((event) => (event.finished ? [event.finished] : []));
/** Each progress the renderer was sent, as "phase done". */
const progressSent = () =>
  events.flatMap((event) => {
    const progress = event.status.current?.progress;
    return progress ? [`${progress.phase} ${progress.done}`] : [];
  });

let engineState: GamePuzzleEngineState = "ready";
let idleMs = Number.POSITIVE_INFINITY;
/** Polls of the held search not yet taken by the test, and the test's waits for the next. */
let polls: (() => void)[] = [];
let pollWaiters: ((release: () => void) => void)[] = [];
/** The next poll of a held search: releasing it ends that wait. */
function nextPoll(): Promise<() => void> {
  const pending = polls.shift();
  if (pending) return Promise.resolve(pending);
  return new Promise((resolve) => pollWaiters.push(resolve));
}
let opened = 0;
let closed = 0;
let generated: GeneratePuzzlesInput[] = [];
/** The fake generator's work for one game (default: one search, then one puzzle). */
let generateGame: (input: GeneratePuzzlesInput) => Promise<GeneratedPuzzle[]>;
let clock = T0;
/** A generator that does `steps[n]` for the n-th game it is given. */
function inTurn(
  ...steps: ((input: GeneratePuzzlesInput) => Promise<GeneratedPuzzle[]>)[]
): (input: GeneratePuzzlesInput) => Promise<GeneratedPuzzle[]> {
  let turn = 0;
  return (input) => {
    const step = steps[turn];
    turn += 1;
    return step(input);
  };
}
const queues: InstanceType<typeof GamePuzzleQueue>[] = [];

function newQueue(): InstanceType<typeof GamePuzzleQueue> {
  const queue = new GamePuzzleQueue({
    engine: () => ({ state: engineState, config: engineState === "ready" ? stockfish : null }),
    openEngine: () => {
      opened += 1;
      return Promise.resolve({ analyse: () => Promise.resolve([]), close: () => (closed += 1) });
    },
    maia: () => null,
    openingBook: () => null,
    usernames: () => Promise.resolve(["me"]),
    playerRatings: () => uniformRatings(1234),
    engineIdleMs: () => idleMs,
    emit: (event) => {
      events.push(event);
      const matched = watchers.filter((watcher) => watcher.predicate(event));
      watchers = watchers.filter((watcher) => !matched.includes(watcher));
      for (const watcher of matched) watcher.done();
    },
    generate: (input) => {
      generated.push(input);
      return generateGame(input);
    },
    wait: (_ms, signal) =>
      new Promise((resolve, reject) => {
        const release = () => resolve();
        const waiter = pollWaiters.shift();
        if (waiter) waiter(release);
        else polls.push(release);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    now: () => clock
  });
  queues.push(queue);
  return queue;
}

describe("GamePuzzleQueue", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM games");
    getDb().exec("DELETE FROM settings");
    events = [];
    watchers = [];
    engineState = "ready";
    idleMs = Number.POSITIVE_INFINITY;
    polls = [];
    pollWaiters = [];
    opened = 0;
    closed = 0;
    generated = [];
    clock = T0;
    generateGame = async (input) => {
      await input.beforeSearch?.();
      return [foundPuzzle(input)];
    };
  });

  afterEach(async () => {
    for (const queue of queues.splice(0)) await queue.stop();
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("works through the queue one game at a time, newest first, and saves the puzzles", async () => {
    saveGame("older", T0 - 1000, '[White "Rival"]\n[Black "Me"]\n[WhiteElo "1800"]');
    saveGame("newer", T0);
    const queue = newQueue();
    const done = finished("older");

    const status = await queue.enqueueMatching(settings());

    expect(status).toMatchObject({ paused: false, total: 2 });
    await done;
    expect(generated.map((input) => [input.userSide, input.ratings])).toStrictEqual([
      ["white", { white: 1234, black: 1234 }],
      // The game's own rating, else the user's for its mode.
      ["black", { white: 1800, black: 1234 }]
    ]);
    expect(generated[0]).toMatchObject({ depths: GAME_PUZZLE_DEPTHS.quick, kinds: ["mistake"] });
    expect(generated[0].moves).toHaveLength(14);
    expect([opened, closed]).toStrictEqual([2, 2]);
    expect(results()).toStrictEqual([
      { gameId: "newer", status: "done", puzzlesFound: 1, error: null },
      { gameId: "older", status: "done", puzzlesFound: 1, error: null }
    ]);
    expect(queue.status()).toStrictEqual({
      paused: false,
      waitingForEngine: false,
      done: 2,
      total: 2,
      current: null
    });
    expect(repository.list({}).total).toBe(2);
    expect(repository.lastSettings()).toStrictEqual(settings());
  });

  it("reports progress at most every 100 ms, and every new phase", async () => {
    saveGame("g", T0);
    generateGame = (input) => {
      for (let done = 0; done < 10; done += 1)
        input.onProgress?.({ phase: "scan", done, total: 15 });
      clock += 100;
      input.onProgress?.({ phase: "scan", done: 10, total: 15 });
      input.onProgress?.({ phase: "find", done: 0, total: 14 });
      return Promise.resolve([]);
    };
    const done = finished("g");
    await newQueue().enqueueMatching(settings());
    await done;
    expect(progressSent()).toStrictEqual(["scan 0", "scan 10", "find 0"]);
  });

  it("records a game that fails with its error and moves on", async () => {
    saveGame("broken", T0);
    saveGame("fine", T0 - 1000);
    generateGame = inTurn(
      () => Promise.reject(new Error("Stockfish exited unexpectedly")),
      (input) => Promise.resolve([foundPuzzle(input)])
    );
    const done = finished("fine");
    await newQueue().enqueueMatching(settings());
    await done;
    expect(results()).toStrictEqual([
      {
        gameId: "broken",
        status: "failed",
        puzzlesFound: 0,
        error: "Stockfish exited unexpectedly"
      },
      { gameId: "fine", status: "done", puzzlesFound: 1, error: null }
    ]);
    expect(closed).toBe(2);
    expect(repository.summary(["me"]).sources.lichess.processed).toBe(2);
  });

  it("refuses to start without a UCI engine as the default (Lc0 is skipped)", async () => {
    saveGame("g", T0);
    engineState = "lc0";
    await expect(newQueue().enqueueMatching(settings())).rejects.toThrow(/Lc0 is skipped/);
    expect(repository.hasQueued()).toBe(false);
  });

  it("holds its searches while the user is using an engine, and carries on once idle", async () => {
    saveGame("g", T0);
    idleMs = 0;
    const waiting = eventWhere((event) => event.status.waitingForEngine);
    const done = finished("g");
    const queue = newQueue();
    await queue.enqueueMatching(settings());
    await waiting;
    expect(queue.status()).toMatchObject({ waitingForEngine: true, done: 0, total: 1 });

    // Still in use at the next look; then idle, but not for long enough yet.
    (await nextPoll())();
    idleMs = 4_000;
    (await nextPoll())();
    const release = await nextPoll();
    expect(generated).toHaveLength(1);
    expect(repository.list({}).total).toBe(0);

    idleMs = 60_000;
    const resumed = eventWhere((event) => !event.status.waitingForEngine);
    release();
    await resumed;
    await done;
    expect(queue.status()).toMatchObject({ waitingForEngine: false, done: 1 });
  });

  it("pauses after the current search, survives a restart paused, and resumes", async () => {
    saveGame("first", T0);
    saveGame("second", T0 - 1000);
    const gate = deferred();
    generateGame = async (input) => {
      await gate.promise;
      await input.beforeSearch?.();
      return [foundPuzzle(input)];
    };
    const running = eventWhere((event) => event.status.current?.gameId === "first");
    const queue = newQueue();
    await queue.enqueueMatching(settings());
    await running;
    expect(queue.pause()).toMatchObject({ paused: true });
    gate.resolve();
    // Quit while paused: the game it was on goes back in the queue.
    await queue.stop();
    expect(events.some((event) => event.finished)).toBe(false);

    const restarted = newQueue();
    restarted.start();
    expect(restarted.status()).toMatchObject({ paused: true, done: 0, total: 2, current: null });
    expect(generated).toHaveLength(1);

    const done = finished("second");
    restarted.resume();
    await done;
    expect(generated).toHaveLength(3);
    expect(restarted.status()).toMatchObject({ paused: false, done: 2, total: 2 });
    expect(repository.list({}).puzzles.map((puzzle) => puzzle.gameId)).toStrictEqual([
      "first",
      "second"
    ]);
  });

  it("a pause mid-game holds the next search until resumed", async () => {
    saveGame("g", T0);
    const gate = deferred();
    generateGame = async (input) => {
      await gate.promise;
      await input.beforeSearch?.();
      return [foundPuzzle(input)];
    };
    const running = eventWhere((event) => event.status.current?.gameId === "g");
    const queue = newQueue();
    await queue.enqueueMatching(settings());
    await running;
    queue.pause();
    gate.resolve();
    await gate.promise;
    expect(queue.status()).toMatchObject({ paused: true, done: 0, current: { gameId: "g" } });
    const done = finished("g");
    queue.resume();
    await done;
    expect(queue.status()).toMatchObject({ done: 1, total: 1 });
  });

  it("cancel drops the running game and empties the queue (puzzles already found stay)", async () => {
    saveGame("first", T0);
    saveGame("second", T0 - 1000);
    saveGame("third", T0 - 2000);
    const solve = async (input: GeneratePuzzlesInput) => {
      await input.beforeSearch?.();
      return [foundPuzzle(input)];
    };
    // The user starts a review during the second game.
    generateGame = inTurn(solve, (input) => {
      idleMs = 0;
      return solve(input);
    });
    const holding = eventWhere((event) => event.status.waitingForEngine);
    const queue = newQueue();
    await queue.enqueueMatching(settings());
    await holding;

    expect(queue.cancel()).toMatchObject({ done: 0, total: 0 });
    await queue.stop();
    expect(generated).toHaveLength(2);
    expect(closed).toBe(2);
    expect(repository.hasQueued()).toBe(false);
    expect(repository.list({}).puzzles.map((puzzle) => puzzle.gameId)).toStrictEqual(["first"]);
    expect(repository.summary(["me"]).sources.lichess.processed).toBe(1);
  });

  it("the review hook queues a reviewed game with the review's evaluations as its scan", async () => {
    saveGame("reviewed", T0);
    repository.setLastSettings(settings({ kinds: ["mistake", "missed-chance"], depth: "deep" }));
    const reviews = new EventEmitter();
    const queue = newQueue();
    const note = attachReviewHook(reviews, queue);
    const review = { moves: trapReviewMoves() };

    // A review of a game that isn't in the library (no id), and one that failed: nothing queued.
    note("unsaved", null);
    reviews.emit("reviewCompleted", { reviewId: "unsaved", review });
    note("failed", "reviewed");
    reviews.emit("reviewFailed", { reviewId: "failed", message: "cancelled" });
    reviews.emit("reviewCompleted", { reviewId: "failed", review });

    const done = finished("reviewed");
    note("r1", "reviewed");
    reviews.emit("reviewCompleted", { reviewId: "r1", review });
    await done;

    expect(generated).toHaveLength(1);
    const [input] = generated;
    expect(input).toMatchObject({
      kinds: ["mistake", "missed-chance"],
      depths: GAME_PUZZLE_DEPTHS.deep
    });
    expect(input.scan).toStrictEqual(scanFromReview(review, input.moves));
    expect(input.scan).toHaveLength(15);
    expect(events.find((event) => event.status.current)?.status.current?.source).toBe("review");
  });
});
