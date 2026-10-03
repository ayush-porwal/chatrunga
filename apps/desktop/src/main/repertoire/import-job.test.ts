import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseRepertoirePgn } from "@chaturanga/shared/chess/repertoire-pgn";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  DEFAULT_IMPORT_LIMITS,
  ImportCancelledError,
  importPreviewFromText,
  RESULT_SLICE_NODES,
  resultMessages,
  runImport,
  type ImportLimits,
  type ImportProgress
} from "./import-job";
import { benchmarkImport, generateRepertoirePgn } from "./import-bench";

const dir = mkdtempSync(join(tmpdir(), "chaturanga-import-job-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const limits = (overrides: Partial<ImportLimits>): ImportLimits => ({
  ...DEFAULT_IMPORT_LIMITS,
  ...overrides
});

/** The synchronous parse with the position keys the import adds to every node. */
function expectedImport(pgn: string) {
  return {
    games: parseRepertoirePgn(pgn).games.map((game) => ({
      ...game,
      positionKeys: Object.fromEntries(
        game.rejected ? [] : game.tree.map((node) => [node.id, positionKey(node.fenAfter)])
      )
    }))
  };
}

const MANY = generateRepertoirePgn({ games: 400, movesPerGame: 12, variationsPerGame: 3 });

describe("runImport", () => {
  it("gives what parseRepertoirePgn gives plus position keys, from text and from a file", async () => {
    const expected = expectedImport(MANY);
    expect(expected.games).toHaveLength(400);
    expect(expected.games[0].nodeCount).toBe(18);
    expect(await importPreviewFromText(MANY)).toEqual(expected);
    const path = join(dir, "many.pgn");
    writeFileSync(path, MANY);
    expect(
      await runImport({ kind: "file", path }, DEFAULT_IMPORT_LIMITS, { chunkChars: 1000 })
    ).toEqual(expected);
  });

  it("reports progress at most once per interval per phase, every phase once at least", async () => {
    let clock = 0;
    const events: ImportProgress[] = [];
    await runImport({ kind: "text", text: MANY }, DEFAULT_IMPORT_LIMITS, {
      onProgress: (event) => events.push(event),
      chunkChars: 1000,
      // Each reading of the clock advances it 30 ms: one report in four passes the 100 ms gap.
      now: () => (clock += 30)
    });
    const chunks = Math.ceil(MANY.length / 1000);
    const phases = events.map((event) => event.phase);
    expect(phases[0]).toBe("reading");
    expect(phases.at(-1)).toBe("validating");
    const parsing = events.filter((event) => event.phase === "parsing");
    expect(parsing.length).toBeGreaterThan(5);
    expect(parsing.length).toBeLessThan(chunks / 2);
    // Monotonic counts, and the final event has the totals.
    for (let index = 1; index < events.length; index++) {
      expect(events[index].bytesRead).toBeGreaterThanOrEqual(events[index - 1].bytesRead);
      expect(events[index].gamesSeen).toBeGreaterThanOrEqual(events[index - 1].gamesSeen);
    }
    expect(events.at(-1)).toEqual({
      phase: "validating",
      bytesRead: Buffer.byteLength(MANY),
      totalBytes: Buffer.byteLength(MANY),
      gamesSeen: 400,
      nodesSeen: 400 * 18
    });
  });

  it("stops at the next piece once cancelled", async () => {
    let cancelled = false;
    let gamesAtCancel = 0;
    const run = runImport({ kind: "text", text: MANY }, DEFAULT_IMPORT_LIMITS, {
      chunkChars: 1000,
      progressIntervalMs: 0,
      isCancelled: () => cancelled,
      onProgress: (event) => {
        if (event.phase === "parsing" && event.gamesSeen >= 20 && !cancelled) {
          cancelled = true;
          gamesAtCancel = event.gamesSeen;
        }
      }
    });
    await expect(run).rejects.toBeInstanceOf(ImportCancelledError);
    expect(gamesAtCancel).toBeGreaterThanOrEqual(20);
    expect(gamesAtCancel).toBeLessThan(400);
  });

  describe("limits fail fast with actionable messages", () => {
    /** The error, and how far the parse got (the last progress) when it failed. */
    async function failure(text: string, overrides: Partial<ImportLimits>) {
      let last: ImportProgress | null = null;
      const error = await runImport({ kind: "text", text }, limits(overrides), {
        chunkChars: 1000,
        progressIntervalMs: 0,
        onProgress: (event) => (last = event)
      }).then(
        () => null,
        (thrown: unknown) => thrown as Error
      );
      return { message: error?.message, last: last as ImportProgress | null };
    }

    it("bytes, before parsing (text and file)", async () => {
      const { message, last } = await failure(MANY, { maxBytes: 1024 });
      expect(message).toBe("This PGN is larger than 1024 bytes; split it and import it in parts.");
      expect(last).toBeNull();
      const path = join(dir, "big.pgn");
      writeFileSync(path, MANY);
      await expect(
        runImport({ kind: "file", path }, limits({ maxBytes: 2 * 1024 * 1024 }))
      ).resolves.toBeTruthy();
      await expect(runImport({ kind: "file", path }, limits({ maxBytes: 1024 }))).rejects.toThrow(
        "This PGN is larger than 1024 bytes"
      );
      expect(DEFAULT_IMPORT_LIMITS.maxBytes).toBe(20 * 1024 * 1024);
    });

    it("games, at the first game past the limit", async () => {
      const { message, last } = await failure(MANY, { maxGames: 10 });
      expect(message).toBe(
        "This PGN has more than 10 games; one import can hold at most 10. Split the file and import it in parts."
      );
      expect(last!.bytesRead).toBeLessThan(Buffer.byteLength(MANY) / 10);
    });

    it("moves across games", async () => {
      const { message, last } = await failure(MANY, { maxNodes: 100 });
      expect(message).toBe("This PGN has more than 100 moves; split it and import it in parts.");
      expect(last!.bytesRead).toBeLessThan(Buffer.byteLength(MANY) / 10);
    });

    it("nesting depth", async () => {
      const deep = generateRepertoirePgn({ games: 3, movesPerGame: 40 });
      expect((await failure(deep, { maxDepth: 30 })).message).toBe(
        "A line is longer than 30 moves (at 1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. Nf3 Nf6 6. Ng1 Ng8 7. Nf3 Nf6 8. Ng1 Ng8 9. Nf3 Nf6 10. Ng1 Ng8 11. Nf3 Nf6 12. Ng1 Ng8 13. Nf3 Nf6 14. Ng1 Ng8 15. Nf3 Nf6). " +
          "Repertoire chapters hold opening lines; trim the game before importing it."
      );
    });

    it("comment size rejects only the games with a longer comment", async () => {
      const commented = generateRepertoirePgn({ games: 3, movesPerGame: 4, commentLength: 50 });
      const pgn = `${commented}\n\n[Event "Plain"]\n\n1. e4 e5 *\n`;
      expect((await failure(pgn, { maxCommentLength: 40 })).message).toBeUndefined();
      const { games } = await runImport(
        { kind: "text", text: pgn },
        limits({ maxCommentLength: 40 })
      );
      expect(games.map((game) => game.rejected)).toEqual([
        "a comment is longer than 40 characters (at 1. Nf3)",
        "a comment is longer than 40 characters (at 1. Nf3)",
        "a comment is longer than 40 characters (at 1. Nf3)",
        null
      ]);
      expect(games[3].nodeCount).toBe(2);
      expect(Object.keys(games[3].positionKeys)).toHaveLength(3);
    });

    it("no game at all", async () => {
      expect((await failure("  \n\n", {})).message).toBe("No PGN game found.");
    });
  });
});

describe("resultMessages", () => {
  it("sends each game, then its tree and keys in bounded slices, then done", async () => {
    const result = await importPreviewFromText(
      generateRepertoirePgn({ games: 2, movesPerGame: 120, variationsPerGame: 0 }),
      limits({ maxDepth: 200 })
    );
    const messages = [...resultMessages(result)];
    expect(messages.map((message) => message.type)).toEqual([
      "game",
      "nodes",
      "game",
      "nodes",
      "done"
    ]);
    // Reassembled, the messages give the result back.
    const games: typeof result.games = [];
    for (const message of messages) {
      if (message.type === "game") games.push({ ...message.game, tree: [], positionKeys: {} });
      if (message.type === "nodes") {
        expect(message.nodes.length).toBeLessThanOrEqual(RESULT_SLICE_NODES);
        games.at(-1)!.tree.push(...message.nodes);
        for (const [id, key] of message.keys) games.at(-1)!.positionKeys[id] = key;
      }
    }
    expect({ games }).toEqual(result);
  });
});

describe("benchmarkImport", () => {
  it("times a parse and reports its size", async () => {
    const result = await benchmarkImport(MANY);
    expect(result).toMatchObject({ games: 400, nodes: 400 * 18, bytes: Buffer.byteLength(MANY) });
    expect(result.totalMs).toBeGreaterThan(0);
    expect(result.progressEvents).toBeGreaterThanOrEqual(2);
  });
});
