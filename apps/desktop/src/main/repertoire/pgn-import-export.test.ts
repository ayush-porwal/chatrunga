import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportProgressEvent } from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  parseRepertoirePgn,
  type ParsedRepertoireGame
} from "@chaturanga/shared/chess/repertoire-pgn";
import { importedDecisionCount } from "@chaturanga/shared/chess/repertoire-training";
import { generateRepertoirePgn } from "./import-bench";
import { validateTree } from "./chapter-validation";
import { rollbackIfOpen } from "../db/rows";
import { treeOf, serviceHelpers } from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);
vi.mock("./import-runner", async (importOriginal) =>
  env.withHeldParses(
    await importOriginal<typeof import("./import-runner")>(),
    (await import("./import-job")).ImportCancelledError
  )
);

const { closeDb, databasePath, getDb } = await import("../db");
const service = await import("./service");
const { decisionRepository, positionIndexRepository } = await import("./repository");
const core = await import("./core");
const { create, save } = serviceHelpers(service);
const { userData, sent, showSaveDialog, heldParses } = env;

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

const TWO_GAMES = `[Event "Italian"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "Scotch"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 (3. Bb5 a6) *
`;

/** A parsed game as the preview shows it (only games with illegal branches carry their tree). */
function previewedGame(game: ParsedRepertoireGame) {
  return {
    index: game.index,
    proposedTitle: game.proposedTitle,
    rootFen: game.rootFen,
    headers: game.headers,
    nodeCount: game.nodeCount,
    tree: !game.invalidBranches.length
      ? []
      : game.rejected
        ? game.tree
        : validateTree(game.tree, game.rootFen),
    decisions: game.rejected
      ? { white: 0, black: 0 }
      : {
          white: importedDecisionCount("white", game.tree),
          black: importedDecisionCount("black", game.tree)
        },
    warnings: game.warnings,
    invalidBranches: game.invalidBranches
  };
}

/** The nodes a selection leaves out: `nodeIds` for the game at `index`, none for the others. */
function excludedIn(gameIndex: number, index: number, nodeIds: string[]): string[] {
  return gameIndex === index ? nodeIds : [];
}

/** The tree with the root's moves in reverse order (what Promote variation saves at the root). */
function withRootMovesReversed(tree: readonly MoveNode[]): MoveNode[] {
  return tree.map((node) =>
    node.id === "root" ? { ...node, children: [...node.children].reverse() } : node
  );
}

describe("repertoire service: import and export", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    service.resetImportJobs();
    sent.length = 0;
    showSaveDialog.mockClear();
    now = 1_000_000_000_000;
  });

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("previews and commits a two-game PGN as two chapters", async () => {
    const { id, revision } = create();
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    expect(preview.games.map((game) => game.proposedTitle)).toStrictEqual(["Italian", "Scotch"]);
    const result = await service.commitImport({
      jobId: preview.jobId,
      repertoireId: id,
      expectedRevision: revision,
      selections: [
        { gameIndex: 0, title: "", kind: "opening", include: true },
        {
          gameIndex: 1,
          title: "Scotch Game",
          kind: "opening",
          include: true,
          excludeNodeIds: ["n6"]
        }
      ]
    });
    expect(result.chaptersAdded).toBe(2);
    expect(result.repertoire.chapters.map((chapter) => chapter.title)).toStrictEqual([
      "My white repertoire",
      "Italian",
      "Scotch Game"
    ]);
    const scotch = service.getChapter({
      repertoireId: id,
      chapterId: result.repertoire.chapters[2].id
    });
    expect(scotch.nodeCount).toBe(5);
    expect(scotch.nodeMeta[scotch.tree[1].id]).toStrictEqual({ edge: "included" });
    // Root (1.e4), after 1...e5 (2.Nf3), after 2...Nc6 (Bc4 from one chapter, d4 from the other).
    expect(result.repertoire.decisionCount).toBe(3);
    await expect(
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: 2,
        selections: []
      })
    ).rejects.toThrow(/Invalid jobId/);
  });

  it("cancelling leaves no rows, and a stale revision on commit writes nothing", async () => {
    const { id, revision } = create();
    const cancelled = await service.previewImport({ pgn: TWO_GAMES });
    service.cancelImport(cancelled.jobId);
    await expect(
      service.commitImport({
        jobId: cancelled.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).rejects.toThrow(/Invalid jobId/);
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    await expect(
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: revision + 1,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).rejects.toThrow("Invalid expectedRevision: repertoire changed (stored 1, expected 2)");
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
    expect({
      ...getDb().prepare("SELECT COUNT(*) AS n FROM repertoire_chapters").get()
    }).toStrictEqual({
      n: 1
    });
    await expect(
      service.commitImport({
        jobId: preview.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: false }]
      })
    ).rejects.toThrow(/choose at least one game/);
  });

  it("keeps only the newest import previews and refuses a game included twice", async () => {
    const { id, revision } = create();
    const first = await service.previewImport({ pgn: TWO_GAMES });
    for (let count = 0; count < 3; count++) await service.previewImport({ pgn: TWO_GAMES });
    const one = [{ gameIndex: 0, title: "", kind: "opening" as const, include: true }];
    await expect(
      service.commitImport({
        jobId: first.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: one
      })
    ).rejects.toThrow(/Invalid jobId/);
    const latest = await service.previewImport({ pgn: TWO_GAMES });
    await expect(
      service.commitImport({
        jobId: latest.jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [...one, ...one]
      })
    ).rejects.toThrow(/included only once/);
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
  });

  /** The import progress events broadcast so far. */
  const progressEvents = () =>
    sent
      .filter((entry) => entry.channel === "repertoires:importProgress")
      .map((entry) => entry.payload as ImportProgressEvent);

  // The only difference: trees come validated in their stored form (castling as e1g1, not e1h1).
  it("previews what the synchronous parser gives, trees as stored (regression)", async () => {
    const fixtures = [
      TWO_GAMES,
      '[Event "Custom"]\n[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd6 *',
      '[Variant "Atomic"]\n\n1. e4 *\n\n[Event "Ok"]\n\n1. d4 d5 (1... Nf6 2. c4) 2. Ke3 *',
      generateRepertoirePgn({
        games: 30,
        movesPerGame: 10,
        variationsPerGame: 2,
        commentLength: 8
      }),
      // The illegal 4. Ke3 keeps this game's tree in the preview.
      "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O (4. c3 Nf6 5. O-O) (4. Ke3) 4... Nf6 $1 { [%clk 0:05:00] } *"
    ];
    const castled = (await service.previewImport({ pgn: fixtures.at(-1)! })).games[0].tree;
    expect(castled.filter((node) => node.san === "O-O").map((node) => node.uci)).toStrictEqual([
      "e1g1",
      "e1g1"
    ]);
    for (const pgn of fixtures) {
      const preview = await service.previewImport({ pgn });
      expect(preview.games).toStrictEqual(parseRepertoirePgn(pgn).games.map(previewedGame));
    }
  });

  it("broadcasts progress for the job, ending with ready", async () => {
    const pgn = generateRepertoirePgn({ games: 150, movesPerGame: 12 });
    const preview = await service.previewImport({ pgn });
    const events = progressEvents();
    expect(events.every((event) => event.jobId === preview.jobId)).toBe(true);
    expect(events[0]).toMatchObject({ phase: "reading", bytesRead: 0, error: null });
    expect(events.map((event) => event.phase)).toContain("parsing");
    expect(events.at(-1)).toStrictEqual({
      jobId: preview.jobId,
      phase: "ready",
      bytesRead: Buffer.byteLength(pgn),
      totalBytes: Buffer.byteLength(pgn),
      gamesSeen: 150,
      nodesSeen: 150 * 12,
      error: null
    });
  });

  it("cancelling a running preview rejects it, broadcasts cancelled and writes nothing", async () => {
    const { id, revision } = create();
    const pgn = generateRepertoirePgn({ games: 900, movesPerGame: 12 });
    const pending = service.previewImport({ pgn });
    // The first event names the job; cancel once parsing is under way.
    // A 10 s ceiling, not vi.waitFor's 1 s: coverage on a CI runner slows the parse 2-4x.
    await vi.waitFor(
      () => expect(progressEvents().some((event) => event.phase === "parsing")).toBe(true),
      { timeout: 10_000 }
    );
    const jobId = progressEvents()[0].jobId;
    service.cancelImport(jobId);
    await expect(pending).rejects.toThrow("The import was cancelled.");
    const last = progressEvents().at(-1)!;
    expect(last).toMatchObject({ jobId, phase: "cancelled", error: null });
    expect(last.gamesSeen).toBeLessThan(900);
    await expect(
      service.commitImport({
        jobId,
        repertoireId: id,
        expectedRevision: revision,
        selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
      })
    ).rejects.toThrow(/Invalid jobId/);
    expect({
      ...getDb().prepare("SELECT COUNT(*) AS n FROM repertoire_chapters").get()
    }).toStrictEqual({
      n: 1
    });
  });

  it("a limit rejects the preview with its message and broadcasts failed", async () => {
    service.setImportLimits({ maxGames: 5 });
    try {
      const pgn = generateRepertoirePgn({ games: 400, movesPerGame: 6 });
      await expect(service.previewImport({ pgn })).rejects.toThrow(
        "This PGN has more than 5 games; one import can hold at most 5."
      );
      const last = progressEvents().at(-1)!;
      expect(last.phase).toBe("failed");
      expect(last.error).toMatch(/more than 5 games/);
      expect(last.bytesRead).toBeLessThan(Buffer.byteLength(pgn));
    } finally {
      service.setImportLimits();
    }
  });

  it("keeps at most three running or pending imports and never cancels a running one for room", async () => {
    // Held parses (see heldParses): the three stay running until released, whatever the machine.
    heldParses.hold = true;
    heldParses.runs.length = 0;
    try {
      const runs = [0, 1, 2].map(() => service.previewImport({ pgn: TWO_GAMES }));
      expect(heldParses.runs).toHaveLength(3);
      // A fourth, with three running, is refused; none of the running ones is cancelled for it.
      await expect(service.previewImport({ pgn: TWO_GAMES })).rejects.toThrow(
        "Another import is still parsing; wait or cancel it."
      );
      expect(heldParses.runs).toHaveLength(3);
      expect(heldParses.runs.some((run) => run.cancelled)).toBe(false);
      for (const run of heldParses.runs) run.resolve();
      await expect(Promise.all(runs)).resolves.toHaveLength(3);
    } finally {
      heldParses.hold = false;
    }
    expect(progressEvents().filter((event) => event.phase === "cancelled")).toHaveLength(0);
    expect(progressEvents().filter((event) => event.phase === "ready")).toHaveLength(3);
    // With the three previewed (none running), a new preview drops the oldest pending one.
    await expect(service.previewImport({ pgn: TWO_GAMES })).resolves.toBeTruthy();
  });

  it("refuses a commit over the move limit before writing anything", async () => {
    const { id, revision } = create();
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    service.setImportLimits({ maxNodes: 6 });
    try {
      await expect(
        service.commitImport({
          jobId: preview.jobId,
          repertoireId: id,
          expectedRevision: revision,
          selections: [
            { gameIndex: 0, title: "", kind: "opening", include: true },
            { gameIndex: 1, title: "", kind: "opening", include: true }
          ]
        })
      ).rejects.toThrow("The selected games have more than 6 moves; import them in parts.");
    } finally {
      service.setImportLimits();
    }
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
  });

  it("stores the same derived state as a full reindex (precomputed keys, writer path)", async () => {
    const { id, revision } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const pgn = generateRepertoirePgn({ games: 20, movesPerGame: 9, variationsPerGame: 3 });
    const preview = await service.previewImport({ pgn: TWO_GAMES + "\n" + pgn });
    await service.commitImport({
      jobId: preview.jobId,
      repertoireId: id,
      expectedRevision: revision + 1,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: "",
        kind: "opening" as const,
        include: true,
        excludeNodeIds: excludedIn(game.index, 1, ["n6"])
      }))
    });
    const stored = {
      decisions: decisionRepository.list(id),
      rows: positionIndexRepository.list(id)
    };
    expect(stored.rows).toHaveLength(1 + 4 + 6 + 3 + 20 * 15 + 22);
    const { transaction } = await import("./repository");
    transaction(() => core.reindex(core.requireRepertoire(id), now));
    expect(decisionRepository.list(id)).toStrictEqual(stored.decisions);
    expect(positionIndexRepository.list(id)).toStrictEqual(stored.rows);
  });

  it("queues a chapter save behind a running import commit at the write gate, then runs it", async () => {
    const { id, revision } = create();
    const first = service.getRepertoire(id).chapters[0];
    const chapter = {
      ...service.getChapter({ repertoireId: id, chapterId: first.id }),
      tree: treeOf(START_FEN, [["e2e4"], ["d2d4"]]),
      nodeMeta: {}
    };
    const preview = await service.previewImport({ pgn: TWO_GAMES });
    sent.length = 0;
    const commit = service.commitImport({
      jobId: preview.jobId,
      repertoireId: id,
      expectedRevision: revision,
      selections: [{ gameIndex: 0, title: "", kind: "opening", include: true }]
    });
    // The import isn't stored yet: a direct save at its revision is refused...
    expect(() =>
      service.saveChapter({ repertoireId: id, chapter, expectedRevision: revision + 1 })
    ).toThrow(/Invalid expectedRevision/);
    // ...one through the write gate waits for the commit, then succeeds.
    const queued = service.withRepertoireWriteGate(() =>
      service.saveChapter({ repertoireId: id, chapter, expectedRevision: revision + 1 })
    );
    const [imported, saved] = await Promise.all([commit, queued]);
    expect(imported.repertoire.revision).toBe(revision + 1);
    expect(saved.repertoire.revision).toBe(revision + 2);
    expect(saved.repertoire.chapters).toHaveLength(2);
    const changes = sent.filter((entry) => entry.channel === "repertoires:changed");
    expect(changes.map((entry) => (entry.payload as { revision: number }).revision)).toStrictEqual([
      revision + 1,
      revision + 2
    ]);
    // Nothing queued: a write runs and settles with its value.
    await expect(service.withRepertoireWriteGate(() => 42)).resolves.toBe(42);
  });

  it("runs gated writes one at a time across repertoires; a failure doesn't block the next", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = service.withRepertoireWriteGate(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first:end");
    });
    const failing = service.withRepertoireWriteGate(() => {
      order.push("failing");
      throw new Error("nope");
    });
    const busy = service.withRepertoireWriteGate(() => {
      throw Object.assign(new Error("database is locked"), { errcode: 5 });
    });
    const last = service.withRepertoireWriteGate(() => order.push("last"));
    await vi.waitFor(() => expect(order).toStrictEqual(["first:start"]));
    release();
    await first;
    await expect(failing).rejects.toThrow("nope");
    await expect(busy).rejects.toThrow("The repertoire database is busy; try again.");
    await last;
    expect(order).toStrictEqual(["first:start", "first:end", "failing", "last"]);
  });

  // Bounded by SQLite's 1 s busy_timeout (a sleep, not CPU): a 15 s ceiling, not the 5 s
  // default, so a slow CI runner can't time it out.
  it("reads never take the write lock; a write finding it held fails with the busy error", async () => {
    const { id } = create();
    const { transaction } = await import("./repository");
    const other = new DatabaseSync(databasePath());
    try {
      // Another connection (as the import writer) holds the write lock.
      other.exec("BEGIN IMMEDIATE");
      const started = performance.now();
      expect(transaction(() => service.getRepertoire(id).name, "read")).toBe("My white repertoire");
      expect(performance.now() - started).toBeLessThan(200);
      expect(() => transaction(() => service.getRepertoire(id), "write")).toThrow(
        "The repertoire database is busy; try again."
      );
      other.exec("ROLLBACK");
      expect(transaction(() => service.getRepertoire(id).name, "write")).toBe(
        "My white repertoire"
      );
    } finally {
      rollbackIfOpen(other);
      other.close();
    }
  }, 15_000);

  it("uses the caller's job id, refuses one in use, and cancels it at once", async () => {
    const preview = await service.previewImport({ pgn: TWO_GAMES, jobId: "job-1" });
    expect(preview.jobId).toBe("job-1");
    expect(progressEvents().every((event) => event.jobId === "job-1")).toBe(true);
    await expect(service.previewImport({ pgn: TWO_GAMES, jobId: "job-1" })).rejects.toThrow(
      "Invalid jobId: already in use"
    );

    sent.length = 0;
    const pending = service.previewImport({ pgn: TWO_GAMES, jobId: "job-2" });
    service.cancelImport("job-2");
    await expect(pending).rejects.toThrow("The import was cancelled.");
    const phases = progressEvents().map((event) => event.phase);
    expect(progressEvents().every((event) => event.jobId === "job-2")).toBe(true);
    expect(phases.at(-1)).toBe("cancelled");
    expect(phases).not.toContain("ready");
    expect(phases.filter((phase) => phase === "cancelled")).toHaveLength(1);
    // The id is free again, and an unknown id is ignored.
    expect(() => service.cancelImport("no-such-job")).not.toThrow();
    await expect(service.previewImport({ pgn: TWO_GAMES, jobId: "job-2" })).resolves.toMatchObject({
      jobId: "job-2"
    });
  });

  it("exports through the save dialog and writes only the picked file", async () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]]);
    const cancelled = await service.exportRepertoire({ repertoireId: id });
    expect(cancelled).toMatchObject({ chapterCount: 1, savedPath: null });
    expect(cancelled.pgn).toContain('[Event "Chapter"]');
    expect(showSaveDialog.mock.calls[0][0]).toMatchObject({
      defaultPath: "My white repertoire.pgn"
    });

    const target = join(userData, "out.pgn");
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });
    const written = await service.exportRepertoire({
      repertoireId: id,
      chapterIds: [saved.chapter.id]
    });
    expect(written.savedPath).toBe(target);
    expect(readFileSync(target, "utf8")).toBe(written.pgn);
    await expect(
      service.exportRepertoire({ repertoireId: id, chapterIds: ["nope"] })
    ).rejects.toThrow(/Invalid chapterIds/);
  });

  it("exports a promoted variation as the main line without changing the preferred move", async () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"], ["d2d4"]], {
      meta: (tree) =>
        Object.fromEntries(
          tree.filter((node) => node.parentId).map((node) => [node.id, { edge: "included" }])
        )
    });
    expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toMatchObject({
      acceptedUcis: ["e2e4", "d2d4"],
      preferredUci: "e2e4"
    });
    expect((await service.exportRepertoire({ repertoireId: id })).pgn).toContain(
      "1. e4 (1. d4) 1... e5 *"
    );

    // Promoting 1. d4 reorders the root's moves (what Study's Promote variation saves).
    const promoted = service.saveChapter({
      repertoireId: id,
      expectedRevision: saved.repertoire.revision,
      chapter: {
        ...saved.chapter,
        tree: withRootMovesReversed(saved.chapter.tree)
      }
    });
    expect(promoted.chapter.tree.find((node) => node.id === "root")!.children).toStrictEqual(
      [...saved.chapter.tree.find((node) => node.id === "root")!.children].reverse()
    );
    expect((await service.exportRepertoire({ repertoireId: id })).pgn).toContain(
      "1. d4 (1. e4 e5) *"
    );
    // The trained answer is the decision's preference, not the authored order.
    expect(service.getDecision({ repertoireId: id, positionKey: START_KEY })).toMatchObject({
      preferredUci: "e2e4"
    });
  });
});
