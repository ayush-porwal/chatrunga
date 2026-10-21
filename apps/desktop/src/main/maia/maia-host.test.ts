import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Maia3UnavailableError, type Maia3Output } from "@chaturanga/shared/engine/maia3";
import type { MaiaHostRequest } from "@chaturanga/shared/engine/maia3-host";

// Electron's window and channel, faked: each host window opened, and the port main talks on.
const fakes = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class Emitter {
    private readonly listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    once(event: string, listener: Listener) {
      return this.on(event, listener);
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }
  class FakePort extends Emitter {
    readonly sent: unknown[] = [];
    closed = false;
    start() {}
    postMessage(message: unknown) {
      this.sent.push(message);
    }
    close() {
      this.closed = true;
    }
  }
  class FakeWindow extends Emitter {
    static opened: FakeWindow[] = [];
    readonly webContents = Object.assign(new Emitter(), { postMessage: () => {} });
    port: FakePort | null = null;
    destroyed = false;
    constructor() {
      super();
      FakeWindow.opened.push(this);
    }
    loadURL() {
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  }
  const ports: FakePort[] = [];
  class FakeChannel {
    readonly port1 = new FakePort();
    readonly port2 = new FakePort();
    constructor() {
      ports.push(this.port1);
    }
  }
  const hostSession = {
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    webRequest: { onBeforeRequest: () => {} },
    protocol: { handle: () => {} }
  };
  return { FakeWindow, FakeChannel, ports, hostSession };
});

vi.mock("electron", () => ({
  BrowserWindow: fakes.FakeWindow,
  MessageChannelMain: fakes.FakeChannel,
  session: { fromPartition: () => fakes.hostSession }
}));
vi.mock("../app-windows", () => ({ markServiceWindow: () => {} }));
vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  errorMessage: (error: unknown) => String(error)
}));

const { MaiaHost } = await import("./maia-host");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const query = (eloSelf = 1500) => ({ fen: START, eloSelf, eloOppo: eloSelf });
const answer: Maia3Output = { policy: { d2d4: 0.4, e2e4: 0.6 }, value: 0.52 };

/** The host's port to main as last opened. */
const port = () => fakes.ports.at(-1)!;
const fromHost = (data: unknown) => port().emit("message", { data });
const ready = () => fromHost({ type: "status", status: "ready" });
const requests = () => port().sent as MaiaHostRequest[];
/** Answers the request sent last (or `id`) with `result`. */
const reply = (result: Maia3Output[] = [answer], id = requests().at(-1)!.id) =>
  fromHost({ type: "result", id, result });

/** Whether a promise has settled yet (after pending callbacks ran). */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true)
  );
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

function newHost(modelPath: string | null = "/engines/maia3_simplified.onnx") {
  return new MaiaHost({
    hostDir: "/out/maia-host",
    preload: "/out/preload.cjs",
    modelPath: () => modelPath
  });
}

describe("MaiaHost", () => {
  beforeEach(() => {
    fakes.FakeWindow.opened.length = 0;
    fakes.ports.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens its window on the first request, sends it once the model is ready, and answers it checked and sorted", async () => {
    const host = newHost();
    const result = host.evaluate([query(1700)]);
    expect(fakes.FakeWindow.opened).toHaveLength(1);
    expect(requests()).toStrictEqual([]);

    ready();
    expect(requests()).toStrictEqual([
      { type: "evaluate", id: 1, boards: [START], eloSelfs: [1700], eloOppos: [1700] }
    ]);
    reply();
    const [output] = await result;
    expect(Object.keys(output.policy)).toStrictEqual(["e2e4", "d2d4"]);
    expect(output.value).toBe(0.52);
  });

  it("fails at once without the model, opening nothing", async () => {
    await expect(newHost(null).evaluate([query()])).rejects.toBeInstanceOf(Maia3UnavailableError);
    expect(fakes.FakeWindow.opened).toHaveLength(0);
  });

  it("sends a game's move ahead of the reviews waiting, one request at a time", async () => {
    const host = newHost();
    const first = host.evaluate([query(1100)]);
    ready();
    const review = host.evaluate([query(1300)]);
    const game = host.evaluate([query(1900)], { priority: "game" });
    expect(requests()).toHaveLength(1);

    reply();
    await first;
    expect(requests().at(-1)?.eloSelfs).toStrictEqual([1900]);
    reply();
    await game;
    expect(requests().at(-1)?.eloSelfs).toStrictEqual([1300]);
    reply();
    await expect(review).resolves.toHaveLength(1);
  });

  it("drops an aborted request that waits, and answers an aborted running one at once (its late answer is ignored)", async () => {
    const host = newHost();
    const running = new AbortController();
    const waiting = new AbortController();
    const first = host.evaluate([query(1100)], { signal: running.signal });
    ready();
    const second = host.evaluate([query(1300)], { signal: waiting.signal });
    const third = host.evaluate([query(1500)]);

    waiting.abort(new Error("superseded"));
    await expect(second).rejects.toThrow("superseded");
    running.abort();
    await expect(first).rejects.toThrow(/aborted/);
    // The host is still busy with the first: the next goes once its (dropped) answer arrives.
    expect(requests()).toHaveLength(1);
    reply();
    expect(requests().map((request) => request.eloSelfs[0])).toStrictEqual([1100, 1500]);
    reply();
    await expect(third).resolves.toHaveLength(1);
  });

  it("closes a host that doesn't answer in time, failing what waits; the next request opens a new one", async () => {
    vi.useFakeTimers();
    const host = newHost();
    const first = host.evaluate([query()]);
    ready();
    const second = host.evaluate([query()]);
    const failures = Promise.allSettled([first, second]);
    await vi.advanceTimersByTimeAsync(30_000);
    const [a, b] = await failures;
    for (const outcome of [a, b]) {
      expect(outcome.status).toBe("rejected");
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(Maia3UnavailableError);
      expect(String((outcome as PromiseRejectedResult).reason)).toMatch(/didn't answer in time/);
    }
    expect(fakes.FakeWindow.opened[0].destroyed).toBe(true);

    const next = host.evaluate([query()]);
    expect(fakes.FakeWindow.opened).toHaveLength(2);
    ready();
    reply();
    await expect(next).resolves.toHaveLength(1);
  });

  it("closes a host whose model doesn't load in time", async () => {
    vi.useFakeTimers();
    const result = newHost().evaluate([query()]);
    const failure = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(String(await failure)).toMatch(/didn't load in time/);
    expect(fakes.FakeWindow.opened[0].destroyed).toBe(true);
  });

  it("fails what waits when the host crashes, and restarts on the next request", async () => {
    const host = newHost();
    const running = host.evaluate([query()]);
    ready();
    const queued = host.evaluate([query()]);
    fakes.FakeWindow.opened[0].webContents.emit("render-process-gone", {}, { reason: "crashed" });
    await expect(running).rejects.toThrow(/stopped \(crashed\)/);
    await expect(queued).rejects.toBeInstanceOf(Maia3UnavailableError);
    expect(port().closed).toBe(true);

    const next = host.evaluate([query()]);
    expect(fakes.FakeWindow.opened).toHaveLength(2);
    ready();
    reply();
    await expect(next).resolves.toHaveLength(1);
  });

  it("ignores messages that aren't the host's protocol or answer no running request", async () => {
    const host = newHost();
    const result = host.evaluate([query()]);
    ready();
    const { id } = requests()[0];
    fromHost("garbage");
    fromHost({ type: "result", id: "1", result: [answer] });
    fromHost({ type: "result", id, result: [{ policy: { e2e4: "1" }, value: 0.5 }] });
    fromHost({ type: "result", id: id + 1, result: [answer] });
    expect(await settled(result)).toBe(false);
    reply([answer], id);
    await expect(result).resolves.toHaveLength(1);
  });

  it("fails a request whose answer doesn't fit its positions, or that the host reports failed", async () => {
    const host = newHost();
    const illegal = host.evaluate([query()]);
    ready();
    reply([{ policy: { e2e5: 1 }, value: 0.5 }]);
    await expect(illegal).rejects.toThrow(/doesn't fit its positions/);

    const short = host.evaluate([query(), query()]);
    reply([answer]);
    await expect(short).rejects.toThrow(/doesn't fit its positions/);

    const failed = host.evaluate([query()]);
    fromHost({ type: "error", id: requests().at(-1)!.id, message: "out of memory" });
    await expect(failed).rejects.toThrow("Maia failed: out of memory");
  });

  it("closes on a load error the host reports, and on dispose", async () => {
    const host = newHost();
    const loading = host.evaluate([query()]);
    fromHost({ type: "status", status: "error", error: "no WebAssembly" });
    await expect(loading).rejects.toThrow("no WebAssembly");

    const waiting = host.evaluate([query()]);
    host.dispose();
    await expect(waiting).rejects.toThrow(/was closed/);
    expect(fakes.FakeWindow.opened.map((window) => window.destroyed)).toStrictEqual([true, true]);
  });
});
