import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMPORT_LIMITS, ImportCancelledError, type ImportProgress } from "./import-job";
import { startImportParse } from "./import-runner";
import { generateRepertoirePgn } from "./import-bench";

const dir = mkdtempSync(join(tmpdir(), "chaturanga-import-runner-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A stand-in worker speaking the import worker's protocol; the text picks its behaviour. "stuck"
 * ignores cancel messages, so only the runner's terminate can stop it; it marks each progress
 * message it posts in STUCK_TICKS, so a test can tell it kept posting.
 */
const FAKE_WORKER = join(dir, "fake-import-worker.mjs");
const STUCK_TICKS = join(dir, "stuck-ticks");
const stuckTicks = () => (existsSync(STUCK_TICKS) ? readFileSync(STUCK_TICKS, "utf8").length : 0);
writeFileSync(
  FAKE_WORKER,
  `import { appendFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
const mode = workerData.source.text;
const progress = { phase: "parsing", bytesRead: 1, totalBytes: 2, gamesSeen: 1, nodesSeen: 3 };
parentPort.postMessage({ type: "progress", progress });
if (mode === "ok") {
  parentPort.postMessage({ type: "game", game: { index: 0, proposedTitle: "A" } });
  parentPort.postMessage({ type: "nodes", nodes: [{ id: "root" }, { id: "n1" }], keys: [["root", "k0"]] });
  parentPort.postMessage({ type: "nodes", nodes: [{ id: "n2" }], keys: [["n1", "k1"], ["n2", "k2"]] });
  parentPort.postMessage({ type: "game", game: { index: 1, proposedTitle: "B" } });
  parentPort.postMessage({ type: "done" });
}
if (mode === "fail") parentPort.postMessage({ type: "failed", message: "This PGN has more than 1 games" });
if (mode === "crash") process.exit(3);
if (mode === "polite") parentPort.on("message", (m) => m.type === "cancel" && parentPort.postMessage({ type: "cancelled" }));
if (mode === "stuck") {
  setInterval(() => {
    appendFileSync(${JSON.stringify(STUCK_TICKS)}, "x");
    parentPort.postMessage({ type: "progress", progress });
  }, 5);
}
`
);

const job = (text: string) => ({
  jobId: "job",
  source: { kind: "text" as const, text },
  limits: DEFAULT_IMPORT_LIMITS
});

describe("startImportParse (worker thread)", () => {
  it("relays progress and resolves with the worker's result", async () => {
    const events: ImportProgress[] = [];
    const run = startImportParse(job("ok"), (event) => events.push(event), {
      workerPath: FAKE_WORKER
    });
    await expect(run.result).resolves.toEqual({
      games: [
        {
          index: 0,
          proposedTitle: "A",
          tree: [{ id: "root" }, { id: "n1" }, { id: "n2" }],
          positionKeys: { root: "k0", n1: "k1", n2: "k2" }
        },
        { index: 1, proposedTitle: "B", tree: [], positionKeys: {} }
      ]
    });
    expect(events).toEqual([
      { phase: "parsing", bytesRead: 1, totalBytes: 2, gamesSeen: 1, nodesSeen: 3 }
    ]);
  });

  it("rejects with the worker's message, or when it stops unexpectedly", async () => {
    await expect(
      startImportParse(job("fail"), () => {}, { workerPath: FAKE_WORKER }).result
    ).rejects.toThrow("This PGN has more than 1 games");
    await expect(
      startImportParse(job("crash"), () => {}, { workerPath: FAKE_WORKER }).result
    ).rejects.toThrow(/stopped unexpectedly \(exit 3\)/);
  });

  it("cancels at once, and no progress follows", async () => {
    for (const mode of ["polite", "stuck"]) {
      let events = 0;
      const run = startImportParse(job(mode), () => (events += 1), { workerPath: FAKE_WORKER });
      // Both modes post progress as they start.
      await vi.waitFor(() => expect(events).toBeGreaterThan(0));
      const before = events;
      const ticks = stuckTicks();
      run.cancel();
      await expect(run.result).rejects.toBeInstanceOf(ImportCancelledError);
      // The stuck worker goes on posting until it is terminated; none of it is reported.
      const ticksAfterCancel = mode === "stuck" ? ticks + 5 : ticks;
      await vi.waitFor(() => expect(stuckTicks()).toBeGreaterThanOrEqual(ticksAfterCancel));
      expect(events).toBe(before);
      // ...and it is terminated: its ticks stop (two reads 50 ms apart, ten ticks' worth, agree).
      let seen = -1;
      await vi.waitFor(
        () => {
          const now = stuckTicks();
          const stopped = now === seen;
          seen = now;
          expect(stopped).toBe(true);
        },
        { interval: 50, timeout: 3_000 }
      );
    }
  });
});

describe("startImportParse (in this thread, without the bundled worker)", () => {
  const missing = join(dir, "missing.js");

  it("parses the text with the import limits", async () => {
    const text = generateRepertoirePgn({ games: 5, movesPerGame: 6 });
    const events: ImportProgress[] = [];
    const run = startImportParse(job(text), (event) => events.push(event), { workerPath: missing });
    const { games } = await run.result;
    expect(games).toHaveLength(5);
    expect(Object.keys(games[0].positionKeys)).toHaveLength(7);
    expect(events.map((event) => event.phase)).toEqual(["reading", "parsing", "validating"]);
  });

  it("cancels at once", async () => {
    const text = generateRepertoirePgn({ games: 2000, movesPerGame: 8 });
    const run = startImportParse(job(text), () => {}, { workerPath: missing });
    run.cancel();
    await expect(run.result).rejects.toBeInstanceOf(ImportCancelledError);
  });

  it("refuses to parse in this thread when the worker is required (packaged app)", async () => {
    const events: ImportProgress[] = [];
    const run = startImportParse(job("1. e4 *"), (event) => events.push(event), {
      requireWorker: true,
      workerPath: missing
    });
    await expect(run.result).rejects.toThrow(
      `The PGN import can't run: a file of this installation is missing (${missing}). ` +
        "Reinstall Chaturanga and try again."
    );
    expect(events).toEqual([]);
  });
});
