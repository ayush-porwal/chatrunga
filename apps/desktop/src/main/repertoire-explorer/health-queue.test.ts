import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { PuzzleEngineSearch } from "@chaturanga/shared/chess/puzzle-solution";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { GamePuzzleEngineState } from "@chaturanga/shared/types/game-puzzles";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireHealthEvent } from "@chaturanga/shared/types/repertoire-health";
import { nodeAt, serviceHelpers } from "../repertoire/__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("../repertoire/__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const service = await import("../repertoire/service");
const { chapterRepository, decisionRepository, repertoireRepository } =
  await import("../repertoire/repository");
const { stripFingerprint } = await import("../repertoire/core");
const { healthRepository } = await import("./health-repository");
const { EDIT_DEBOUNCE_MS, RepertoireHealthQueue } = await import("./health-queue");
type QueueDeps = ConstructorParameters<typeof RepertoireHealthQueue>[0];
const { create, save } = serviceHelpers(service);

const CONFIG = { id: "sf", name: "Stockfish" } as EngineConfig;

/** 1.e4 (the engine prefers 1.d4 by two pawns); after 1…c5 only a study-only answer. */
function whiteRepertoire(): string {
  const { id } = create();
  save(
    id,
    [
      ["e2e4", "e7e5", "g1f3"],
      ["e2e4", "c7c5", "g1f3"]
    ],
    {
      meta: (tree: MoveNode[]) => ({
        [nodeAt(tree, ["e2e4", "c7c5", "g1f3"]).id]: { edge: "reference" }
      })
    }
  );
  return id;
}

function checked(id: string) {
  const record = repertoireRepository.get(id);
  if (!record) return null;
  return {
    id,
    name: record.name,
    color: record.color,
    revision: record.revision,
    chapters: chapterRepository.list(id),
    decisions: decisionRepository.list(id).map(stripFingerprint)
  };
}

/** The engine's answer: 1.d4 at +1, 1.e4 at −1 from the start; nothing elsewhere. */
function analyse(fen: string, _search: PuzzleEngineSearch) {
  if (fen !== START_FEN) return Promise.resolve([]);
  return Promise.resolve([
    { multipv: 1, score: { type: "cp" as const, value: 100 }, pv: ["d2d4"] },
    { multipv: 2, score: { type: "cp" as const, value: -100 }, pv: ["e2e4"] }
  ]);
}

function setup(patch: Partial<QueueDeps> = {}) {
  const events: RepertoireHealthEvent[] = [];
  const closed: number[] = [];
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const deps: QueueDeps = {
    repertoire: checked,
    engine: (): { state: GamePuzzleEngineState; config: EngineConfig | null } => ({
      state: "ready",
      config: CONFIG
    }),
    openEngine: () => Promise.resolve({ analyse, close: () => closed.push(1) }),
    maia: () => null,
    rating: () => 1500,
    engineIdleMs: () => 60_000,
    puzzlesBusy: () => false,
    emit: (event) => events.push(event),
    wait: (_ms, signal) =>
      signal.aborted ? Promise.reject(new Error("aborted")) : Promise.resolve(),
    setTimer: (run, ms) => {
      const timer = { ms, run, cancelled: false };
      timers.push(timer);
      return { cancel: () => (timer.cancelled = true) };
    },
    ...patch
  };
  return { queue: new RepertoireHealthQueue(deps), events, closed, timers };
}

const kinds = (id: string) => healthRepository.flags(id).map((flag) => flag.kind);
const stateOf = (id: string) =>
  healthRepository.summaries().find((summary) => summary.repertoireId === id)?.state ?? null;

describe("repertoire health queue", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    getDb().exec("DELETE FROM settings WHERE key LIKE 'main.repertoireHealth.%'");
  });

  afterAll(() => {
    closeDb();
    rmSync(env.userData, { recursive: true, force: true });
  });

  it("writes the no-answer flags at once and reports a missing engine or Lc0 as its problem", async () => {
    const id = whiteRepertoire();
    const { queue } = setup({ engine: () => ({ state: "lc0", config: null }) });
    await queue.check([id]);
    await queue.idle();
    expect(queue.status()).toMatchObject({
      problem:
        "The health check needs Stockfish or another UCI engine as the default engine (Lc0 is skipped).",
      queued: [id],
      current: null
    });
    const [flag] = healthRepository.flags(id);
    expect(flag).toMatchObject({
      kind: "no-answer",
      san: "c5",
      line: "1. e4",
      revision: service.getRepertoire(id).revision
    });

    // Cancel: a repertoire never checked leaves the queue (its flags stay).
    expect(queue.cancel()).toMatchObject({ problem: null, queued: [] });
    expect(stateOf(id)).toBeNull();
    expect(kinds(id)).toStrictEqual(["no-answer"]);
  });

  it("waits while the user's engine is busy, then while the puzzle queue runs a game", async () => {
    const id = whiteRepertoire();
    const { queue, events, closed } = setup({
      // Busy for two looks, then idle for good.
      engineIdleMs: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(60_000),
      puzzlesBusy: vi
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false)
    });
    await queue.check([id]);
    await queue.idle();
    const waits = events.map(({ status }) => [status.waitingForEngine, status.waitingForPuzzles]);
    expect(waits).toContainEqual([true, false]);
    expect(waits).toContainEqual([false, true]);
    expect(waits.findIndex(([engine]) => engine) < waits.findIndex(([, puzzles]) => puzzles)).toBe(
      true
    );
    expect(kinds(id)).toStrictEqual(["engine-disagrees", "no-answer"]);
    expect(healthRepository.flags(id)[0]).toMatchObject({ san: "e4", bestSan: "d4" });
    expect(healthRepository.summaries()[0]).toMatchObject({
      state: "done",
      checkedRevision: service.getRepertoire(id).revision,
      counts: { "engine-disagrees": 1, "no-answer": 1, "common-mistake": 0 }
    });
    expect(closed).toHaveLength(1);
    expect(queue.status()).toMatchObject({ waitingForEngine: false, current: null, queued: [] });
  });

  it("closes its engine while a search waits long for others, and starts it again after", async () => {
    const id = whiteRepertoire();
    const log: string[] = [];
    const idleMs = vi.fn<() => number>().mockReturnValue(60_000);
    const search = vi.fn(analyse).mockImplementationOnce((fen, options) => {
      // After the first search the user's engine is busy for 15 looks (15 s).
      for (let look = 0; look < 15; look += 1) idleMs.mockReturnValueOnce(0);
      return analyse(fen, options);
    });
    const { queue } = setup({
      openEngine: () => {
        log.push("open");
        return Promise.resolve({ analyse: search, close: () => log.push("close") });
      },
      engineIdleMs: idleMs
    });
    await queue.check([id]);
    await queue.idle();
    expect(search.mock.calls.length).toBeGreaterThan(1);
    expect(log).toStrictEqual(["open", "close", "open", "close"]);
    expect(stateOf(id)).toBe("done");
  });

  it("pausing stops the running check, which goes back first in line and finishes on resume", async () => {
    const id = whiteRepertoire();
    let started!: () => void;
    const searching = new Promise<void>((resolve) => (started = resolve));
    // The first engine's search runs until the pause aborts it; the next one answers.
    const holding: QueueDeps["openEngine"] = (_config, signal) =>
      Promise.resolve({
        analyse: () => {
          started();
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted")))
          );
        },
        close: () => closed.push(1)
      });
    const answering: QueueDeps["openEngine"] = () =>
      Promise.resolve({ analyse, close: () => closed.push(1) });
    const closed: number[] = [];
    const { queue } = setup({
      openEngine: vi.fn(holding).mockImplementationOnce(holding).mockImplementation(answering)
    });
    await queue.check([id]);
    await searching;
    expect(queue.pause()).toMatchObject({ paused: true });
    await queue.idle();
    expect(closed).toHaveLength(1);
    expect(queue.status()).toMatchObject({ queued: [id], current: null });
    expect(stateOf(id)).toBe("queued");

    queue.resume();
    await queue.idle();
    expect(stateOf(id)).toBe("done");
    expect(closed).toHaveLength(2);
    expect(kinds(id)).toContain("engine-disagrees");
  });

  it("checks a checked repertoire again 30 s after its last edit", async () => {
    const id = whiteRepertoire();
    const { queue, timers } = setup();
    // Never checked: an edit doesn't start one.
    queue.edited(id);
    expect(timers).toHaveLength(0);

    await queue.check([id]);
    await queue.idle();
    queue.edited(id);
    queue.edited(id);
    expect(timers.map(({ ms, cancelled }) => [ms, cancelled])).toStrictEqual([
      [EDIT_DEBOUNCE_MS, true],
      [EDIT_DEBOUNCE_MS, false]
    ]);
    const revision = service.getRepertoire(id).revision;
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    timers[1].run();
    await queue.idle();
    // Checked again against the edit: 1…c5 is gone, and its flag with it.
    expect(healthRepository.summaries()[0]).toMatchObject({
      state: "done",
      checkedRevision: revision + 1
    });
    expect(kinds(id)).toStrictEqual(["engine-disagrees"]);
  });
});
