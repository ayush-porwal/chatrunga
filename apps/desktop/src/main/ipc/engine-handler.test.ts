import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const userData = vi.hoisted(() => ({ dir: "/nonexistent" }));
vi.mock("electron", () => ({
  app: { getPath: () => userData.dir },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}));

/**
 * Each repository write, in order; `failing` throws, `busyOnce` finds the database busy first.
 * `imagePath` is the stored engine's picture.
 */
const writes = vi.hoisted(() => ({
  calls: [] as unknown[][],
  failing: false,
  busyOnce: false,
  imagePath: null as string | null
}));
function write(...call: unknown[]) {
  writes.calls.push(call);
  if (writes.busyOnce) {
    writes.busyOnce = false;
    throw Object.assign(new Error("database is locked"), { errcode: 5 });
  }
  if (writes.failing) throw new Error("disk I/O error");
  return { id: "engine-1", imagePath: writes.imagePath };
}
type Picture = { imagePath?: string | null };
vi.mock("../db/repositories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/repositories")>()),
  engineRepository: {
    get: () => ({ id: "engine-1", imagePath: writes.imagePath }),
    create: (input: Picture, id?: string) => {
      const created = write("create", input);
      writes.imagePath = input.imagePath ?? null;
      return { ...created, id, imagePath: writes.imagePath };
    },
    update: (id: unknown, patch: Picture) => {
      const updated = write("update", id, patch);
      if (patch.imagePath !== undefined) writes.imagePath = patch.imagePath;
      return { ...updated, imagePath: writes.imagePath };
    },
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
    writes.imagePath = null;
    userData.dir = "/nonexistent";
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
    await expect(created).resolves.toMatchObject({ id: expect.any(String), imagePath: null });
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

  describe("pictures", () => {
    let pictures: string;
    const copies = () => readdirSync(join(userData.dir, "engine-images")).sort();
    const picture = (name: string, contents: string) => {
      writeFileSync(join(pictures, name), contents);
      return join(pictures, name);
    };

    beforeEach(() => {
      userData.dir = mkdtempSync(join(tmpdir(), "chaturanga-engine-handler-"));
      pictures = join(userData.dir, "Pictures");
      mkdirSync(pictures);
    });
    afterEach(() => rmSync(userData.dir, { recursive: true, force: true }));

    it("stores a copy of a new engine's picture, named for the engine", async () => {
      const engine1 = await call("engines:create", { ...engine, imagePath: picture("a.png", "a") });
      const { id, imagePath } = engine1 as { id: string; imagePath: string };
      expect(imagePath.startsWith(join(userData.dir, "engine-images", `${id}-`))).toBe(true);
      expect(copies()).toHaveLength(1);
    });

    it("deletes the copy when the new engine isn't saved, and refuses a missing picture", async () => {
      writes.failing = true;
      await expect(
        call("engines:create", { ...engine, imagePath: picture("a.png", "a") })
      ).rejects.toThrow(/disk I\/O error/);
      expect(copies()).toStrictEqual([]);
      writes.failing = false;
      await expect(
        call("engines:create", { ...engine, imagePath: join(pictures, "gone.png") })
      ).rejects.toThrow(/wasn't found/);
      expect(writes.calls).toHaveLength(1);
    });

    it("deletes the old copy when the picture is replaced or cleared, and all on remove", async () => {
      await call("engines:update", "engine-1", { imagePath: picture("a.png", "a") });
      const [first] = copies();
      // Saving the editor again sends the stored copy back: kept as it is.
      await call("engines:update", "engine-1", { imagePath: writes.imagePath, name: "Renamed" });
      expect(copies()).toStrictEqual([first]);
      await call("engines:update", "engine-1", { imagePath: picture("b.png", "b") });
      expect(copies()).toHaveLength(1);
      expect(copies()).not.toContain(first);
      await call("engines:update", "engine-1", { imagePath: null });
      expect(copies()).toStrictEqual([]);
      await call("engines:update", "engine-1", { imagePath: picture("c.png", "c") });
      await call("engines:remove", "engine-1");
      expect(copies()).toStrictEqual([]);
    });

    it("keeps the copy the last of two overlapping saves stored", async () => {
      await Promise.all([
        call("engines:update", "engine-1", { imagePath: picture("a.png", "a") }),
        call("engines:update", "engine-1", { imagePath: picture("b.png", "b") })
      ]);
      expect(copies()).toHaveLength(1);
      expect(join(userData.dir, "engine-images", copies()[0])).toBe(writes.imagePath);
    });

    it("keeps the stored copy when the update isn't saved", async () => {
      await call("engines:update", "engine-1", { imagePath: picture("a.png", "a") });
      const kept = copies();
      writes.failing = true;
      await expect(
        call("engines:update", "engine-1", { imagePath: picture("b.png", "b") })
      ).rejects.toThrow(/disk I\/O error/);
      expect(copies()).toStrictEqual(kept);
    });
  });
});
