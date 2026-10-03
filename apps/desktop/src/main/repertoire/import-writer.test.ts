import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { ImportCommitJob } from "./core";
import { runImportCommit } from "./import-writer";
import { WRITER_SLICE_NODES } from "./import-writer-protocol";

const dir = mkdtempSync(join(tmpdir(), "chaturanga-import-writer-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A stand-in writer speaking the writer protocol; the repertoire id picks its behaviour. "ok"
 * replies with what it received; "crash" opens a transaction on the real file, inserts a row and
 * dies before committing.
 */
const FAKE_WRITER = join(dir, "fake-writer.mjs");
writeFileSync(
  FAKE_WRITER,
  `import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const { dbPath, job } = workerData;
const received = { chapters: [], nodeMessages: 0, nodes: 0, keys: 0 };
parentPort.on("message", (message) => {
  if (message.type === "chapter") received.chapters.push(message.chapter.proposedTitle);
  if (message.type === "nodes") {
    received.nodeMessages += 1;
    received.nodes += message.nodes.length;
    received.keys += message.keys.length;
  }
  if (message.type !== "commit") return;
  if (job.repertoireId === "ok") parentPort.postMessage({ ok: true, result: { received, job } });
  if (job.repertoireId === "fail") parentPort.postMessage({ ok: false, error: "Invalid expectedRevision: repertoire changed" });
  if (job.repertoireId === "crash") {
    const db = new DatabaseSync(dbPath);
    db.exec("BEGIN IMMEDIATE");
    db.exec("INSERT INTO rows (name) VALUES ('half-written')");
    process.exit(7);
  }
});
`
);

function tree(size: number): MoveNode[] {
  return Array.from({ length: size }, (_, index) => ({
    id: index ? `n${index}` : "root",
    parentId: index ? (index === 1 ? "root" : `n${index - 1}`) : null,
    san: null,
    uci: null,
    fenBefore: "f",
    fenAfter: "f",
    ply: index,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  }));
}

function job(repertoireId: string, sizes: number[]): ImportCommitJob {
  return {
    repertoireId,
    expectedRevision: 3,
    now: 1,
    maxNodes: 100_000,
    chapters: sizes.map((size, index) => {
      const nodes = tree(size);
      return {
        title: "",
        proposedTitle: `Game ${index + 1}`,
        kind: "opening",
        rootFen: "f",
        headers: {},
        tree: nodes,
        excludeNodeIds: [],
        positionKeys: Object.fromEntries(nodes.map((node) => [node.id, `k-${node.id}`]))
      };
    })
  };
}

describe("runImportCommit (writer worker)", () => {
  it("sends every chapter in bounded slices, then resolves with the worker's result", async () => {
    const dbPath = join(dir, "ok.sqlite");
    const result = (await runImportCommit(
      job("ok", [5, 4500, 1]),
      () => dbPath,
      FAKE_WRITER
    )) as unknown as {
      received: { chapters: string[]; nodeMessages: number; nodes: number; keys: number };
      job: Record<string, unknown>;
    };
    expect(result.received).toEqual({
      chapters: ["Game 1", "Game 2", "Game 3"],
      nodeMessages: 1 + Math.ceil(4500 / WRITER_SLICE_NODES) + 1,
      nodes: 4506,
      keys: 4506
    });
    expect(result.job).toEqual({
      repertoireId: "ok",
      expectedRevision: 3,
      now: 1,
      maxNodes: 100_000
    });
  });

  it("rejects with the worker's error", async () => {
    await expect(runImportCommit(job("fail", [3]), () => "", FAKE_WRITER)).rejects.toThrow(
      "Invalid expectedRevision: repertoire changed"
    );
  });

  it("a crash before commit leaves nothing written and rejects with an actionable error", async () => {
    const dbPath = join(dir, "crash.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE rows (name TEXT)");
    await expect(runImportCommit(job("crash", [3]), () => dbPath, FAKE_WRITER)).rejects.toThrow(
      "The import couldn't be saved: the writer stopped unexpectedly (exit 7); nothing was imported. Try again."
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM rows").get()).toEqual({ n: 0 });
    // The dead connection's lock is gone: this connection can write.
    db.exec("INSERT INTO rows (name) VALUES ('after')");
    db.close();
  });
});
