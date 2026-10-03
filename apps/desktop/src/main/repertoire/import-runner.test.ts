import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_IMPORT_LIMITS, ImportCancelledError, type ImportProgress } from "./import-job";
import { startImportParse } from "./import-runner";
import { generateRepertoirePgn } from "./import-bench";

const dir = mkdtempSync(join(tmpdir(), "chaturanga-import-runner-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A stand-in worker speaking the import worker's protocol; the text picks its behaviour. "stuck"
 * ignores cancel messages, so only the runner's terminate can stop it.
 */
const FAKE_WORKER = join(dir, "fake-import-worker.mjs");
writeFileSync(
  FAKE_WORKER,
  `import { parentPort, workerData } from "node:worker_threads";
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
if (mode === "stuck") setInterval(() => parentPort.postMessage({ type: "progress", progress }), 5);
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
    const run = startImportParse(job("ok"), (event) => events.push(event), FAKE_WORKER);
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
    await expect(startImportParse(job("fail"), () => {}, FAKE_WORKER).result).rejects.toThrow(
      "This PGN has more than 1 games"
    );
    await expect(startImportParse(job("crash"), () => {}, FAKE_WORKER).result).rejects.toThrow(
      /stopped unexpectedly \(exit 3\)/
    );
  });

  it("cancels at once, and no progress follows", async () => {
    for (const mode of ["polite", "stuck"]) {
      let events = 0;
      const run = startImportParse(job(mode), () => (events += 1), FAKE_WORKER);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const before = events;
      run.cancel();
      await expect(run.result).rejects.toBeInstanceOf(ImportCancelledError);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(events).toBe(before);
    }
  });
});

describe("startImportParse (in this thread, without the bundled worker)", () => {
  const missing = join(dir, "missing.js");

  it("parses the text with the import limits", async () => {
    const text = generateRepertoirePgn({ games: 5, movesPerGame: 6 });
    const events: ImportProgress[] = [];
    const run = startImportParse(job(text), (event) => events.push(event), missing);
    const { games } = await run.result;
    expect(games).toHaveLength(5);
    expect(Object.keys(games[0].positionKeys)).toHaveLength(7);
    expect(events.map((event) => event.phase)).toEqual(["reading", "parsing", "validating"]);
  });

  it("cancels at once", async () => {
    const text = generateRepertoirePgn({ games: 2000, movesPerGame: 8 });
    const run = startImportParse(job(text), () => {}, missing);
    run.cancel();
    await expect(run.result).rejects.toBeInstanceOf(ImportCancelledError);
  });
});
