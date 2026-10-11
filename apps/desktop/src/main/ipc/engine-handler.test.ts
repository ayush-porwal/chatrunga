import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  app: { getPath: () => "/nonexistent" },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}));

/** Each repository write, in order; `failing` throws, `busyOnce` finds the database busy first. */
const writes = vi.hoisted(() => ({ calls: [] as unknown[][], failing: false, busyOnce: false }));
function write(...call: unknown[]) {
  writes.calls.push(call);
  if (writes.busyOnce) {
    writes.busyOnce = false;
    throw Object.assign(new Error("database is locked"), { errcode: 5 });
  }
  if (writes.failing) throw new Error("disk I/O error");
  return { id: "engine-1" };
}
vi.mock("../db/repositories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/repositories")>()),
  engineRepository: {
    create: (input: unknown) => write("create", input),
    update: (id: unknown, patch: unknown) => write("update", id, patch),
    remove: (id: unknown) => void write("remove", id)
  }
}));

const sent = vi.hoisted(() => [] as string[]);
vi.mock("./broadcast", () => ({ broadcast: (channel: string) => sent.push(channel) }));
const readiness = vi.hoisted(() => vi.fn());
vi.mock("../telemetry/engine-readiness", () => ({ noteEngineReadiness: readiness }));

const { registerEngineCrudIpc } = await import("./engine-handler");
registerEngineCrudIpc();

const call = (channel: string, ...args: unknown[]) =>
  Promise.resolve().then(() => handlers.get(channel)!(null, ...args));

const engine = { name: "Stockfish", executablePath: "/usr/local/bin/stockfish" };
const cases: Array<[channel: string, args: unknown[]]> = [
  ["engines:create", [engine]],
  ["engines:update", ["engine-1", { name: "Renamed" }]],
  ["engines:remove", ["engine-1"]]
];

describe("engine create/update/remove", () => {
  beforeEach(() => {
    writes.calls.length = 0;
    writes.failing = false;
    writes.busyOnce = false;
    sent.length = 0;
    readiness.mockClear();
    vi.useRealTimers();
  });

  it.each(cases)("%s announces engines:changed after the write", async (channel, args) => {
    await call(channel, ...args);
    expect(writes.calls).toHaveLength(1);
    expect(sent).toStrictEqual(["engines:changed"]);
  });

  it.each(cases)("%s announces nothing when the write fails", async (channel, args) => {
    writes.failing = true;
    await expect(call(channel, ...args)).rejects.toThrow(/disk I\/O error/);
    expect(sent).toStrictEqual([]);
    expect(readiness).not.toHaveBeenCalled();
  });

  it("announces once, after the retry, when the database was busy", async () => {
    vi.useFakeTimers();
    writes.busyOnce = true;
    const created = call("engines:create", engine);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(created).resolves.toStrictEqual({ id: "engine-1" });
    expect(writes.calls).toHaveLength(2);
    expect(sent).toStrictEqual(["engines:changed"]);
  });

  it("passes the checked input to the repository, with defaults filled in", async () => {
    await call("engines:create", engine);
    await call("engines:update", "engine-1", { name: "  " });
    expect(writes.calls).toStrictEqual([
      [
        "create",
        expect.objectContaining({
          name: "Stockfish",
          executablePath: engine.executablePath,
          args: []
        })
      ],
      ["update", "engine-1", { name: "UCI Engine" }]
    ]);
    // Adding or editing an engine may make one ready to analyse; removing one can't.
    expect(readiness).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["engines:create", [{ name: "No path" }], /executable path is required/],
    ["engines:create", [{ executablePath: "relative/stockfish" }], /absolute path/],
    ["engines:update", ["", { name: "x" }], /engine id/],
    ["engines:update", ["engine-1", null], /engine update/],
    ["engines:remove", [42], /engine id/]
  ])("%s rejects invalid input without writing", async (channel, args, message) => {
    await expect(call(channel, ...args)).rejects.toThrow(message);
    expect(writes.calls).toStrictEqual([]);
    expect(sent).toStrictEqual([]);
  });
});
