import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddFromGameInput } from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { nodeAt, treeOf, serviceHelpers } from "./__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("./__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const service = await import("./service");
const { decisionRepository } = await import("./repository");
const { create, save } = serviceHelpers(service);
const { userData, sent } = env;

let now = 1_000_000_000_000;
service.setRepertoireClock(() => now);
const START_KEY = positionKey(START_FEN);

beforeEach(() => {
  getDb().exec("DELETE FROM repertoires");
  service.resetImportJobs();
  sent.length = 0;
  now = 1_000_000_000_000;
});

afterAll(() => {
  service.setRepertoireClock();
  closeDb();
  rmSync(userData, { recursive: true, force: true });
});

describe("repertoire service: add from a game", () => {
  const GAME_LINES = [["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]];

  function sourceOf(lines: string[][], gameId: string | null = null, rootFen = START_FEN) {
    return {
      gameId,
      headers: { White: "Alice", Black: "Bob", Event: "Club game" },
      rootFen,
      tree: treeOf(rootFen, lines),
      nodeId: null
    };
  }

  function input(
    repertoireId: string,
    source: ReturnType<typeof sourceOf>,
    overrides: Partial<AddFromGameInput> = {}
  ): AddFromGameInput {
    return {
      repertoireId,
      expectedRevision: service.getRepertoire(repertoireId).revision,
      destination: { kind: "new-chapter", title: "", chapterKind: "opening" },
      source,
      scope: { kind: "whole-game" },
      policy: { includedNodeIds: [], coveredNodeIds: [] },
      ...overrides
    };
  }

  /** Previews once for the default policy, then returns the input carrying it. */
  function withDefaults(base: AddFromGameInput): AddFromGameInput {
    return { ...base, policy: service.previewAddFromGame(base).defaultPolicy };
  }

  function insertLibraryGame(id: string) {
    getDb()
      .prepare(
        `INSERT INTO games (id, source, pgn, current_fen, move_tree_json, created_at, updated_at)
          VALUES (?, 'pgn-import', '', ?, '[]', 1, 1)`
      )
      .run(id, START_FEN);
  }

  it("adds a line as a new chapter with decisions and a source link", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const end = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3", "b8c6"]);
    const base = input(id, source, { scope: { kind: "path", toNodeId: end.id } });
    const preview = service.previewAddFromGame(base);
    expect(preview).toMatchObject({
      chapterTitle: "Alice – Bob",
      nodeCount: 4,
      decisionsAdded: 0,
      conflicts: [],
      alreadyPresent: 0
    });
    expect(preview.warnings).toEqual([
      "No moves are accepted: nothing from this material will be trained"
    ]);
    expect(preview.ownMoves.map((move) => move.path)).toEqual(["1. e4", "1. e4 e5 2. Nf3"]);
    expect(preview.defaultPolicy.includedNodeIds).toEqual([
      nodeAt(source.tree, ["e2e4"]).id,
      nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id
    ]);
    // The preview wrote nothing.
    expect(service.getRepertoire(id).chapters).toHaveLength(1);

    const confirmed = withDefaults(base);
    expect(service.previewAddFromGame(confirmed)).toMatchObject({
      decisionsAdded: 2,
      warnings: []
    });
    sent.length = 0;
    const result = service.addFromGame(confirmed);
    expect(result.repertoire.revision).toBe(base.expectedRevision + 1);
    expect(result.repertoire.chapters).toHaveLength(2);
    expect(result.repertoire.decisionCount).toBe(2);
    expect(result.chapter).toMatchObject({ title: "Alice – Bob", kind: "opening", nodeCount: 4 });
    expect(result.chapter.headers).toMatchObject({ White: "Alice", Black: "Bob" });
    expect(result.link).toMatchObject({
      repertoireId: id,
      chapterId: result.chapter.id,
      gameId: null,
      unsaved: true,
      gameNodeId: end.id,
      kind: "source",
      capturedPath: "1. e4 e5 2. Nf3 Nc6"
    });
    expect(service.listGameLinks({ repertoireId: id })).toEqual([result.link]);
    expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toEqual(["e2e4"]);
    expect(sent).toEqual([
      {
        channel: "repertoires:changed",
        payload: { repertoireId: id, revision: result.repertoire.revision, kind: "updated" }
      }
    ]);
  });

  it("reports a conflict and adds the move as an alternative without changing the preference", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const afterE5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "e2e4")!, "e7e5")!);
    const source = sourceOf([["e2e4", "e7e5", "f1c4"]]);
    const confirmed = withDefaults(
      input(id, source, {
        scope: { kind: "path", toNodeId: nodeAt(source.tree, ["e2e4", "e7e5", "f1c4"]).id }
      })
    );
    const preview = service.previewAddFromGame(confirmed);
    expect(preview.conflicts).toEqual([
      {
        positionKey: afterE5,
        fen: expect.any(String),
        existingUcis: ["g1f3"],
        preferredUci: "g1f3",
        newUci: "f1c4",
        newSan: "Bc4",
        path: "1. e4 e5"
      }
    ]);
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.transpositions).toBe(2);
    expect(preview.warnings).toEqual([
      "1 position already has another repertoire move: the new move is added as an alternative and your preferred move stays"
    ]);

    service.addFromGame(confirmed);
    expect(decisionRepository.get(id, afterE5)).toMatchObject({
      acceptedUcis: ["g1f3", "f1c4"],
      preferredUci: "g1f3"
    });
  });

  it("merges into an existing chapter, keeping its comments and counting present moves", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]]);
    const chapter = {
      ...saved.chapter,
      tree: saved.chapter.tree.map((node) =>
        node.uci === "e2e4" ? { ...node, comment: "mine" } : node
      )
    };
    const resaved = service.saveChapter({
      repertoireId: id,
      chapter,
      expectedRevision: saved.repertoire.revision
    });
    const source = sourceOf(GAME_LINES);
    source.tree = source.tree.map((node) =>
      node.uci === "e2e4" ? { ...node, comment: "theirs" } : node
    );
    const confirmed = withDefaults(
      input(id, source, {
        destination: { kind: "existing-chapter", chapterId: resaved.chapter.id },
        scope: { kind: "path", toNodeId: nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id }
      })
    );
    const preview = service.previewAddFromGame(confirmed);
    expect(preview).toMatchObject({ chapterTitle: "Chapter", nodeCount: 3, alreadyPresent: 2 });
    const result = service.addFromGame(confirmed);
    expect(result.repertoire.chapters).toHaveLength(1);
    expect(result.chapter.id).toBe(resaved.chapter.id);
    expect(result.chapter.nodeCount).toBe(3);
    expect(result.chapter.tree.find((node) => node.uci === "e2e4")?.comment).toBe("mine");

    // Merging the same line again adds nothing.
    const again = { ...confirmed, expectedRevision: result.repertoire.revision };
    expect(service.previewAddFromGame(again)).toMatchObject({ alreadyPresent: 3 });
    expect(service.addFromGame(again).chapter.nodeCount).toBe(3);

    const other = sourceOf([["e7e5"]], null, fenAfterUci(START_FEN, "d2d4")!);
    expect(() =>
      service.previewAddFromGame(
        input(id, other, {
          destination: { kind: "existing-chapter", chapterId: resaved.chapter.id }
        })
      )
    ).toThrow(/starts at a different position than the chapter/);
  });

  it("a null policy previews the defaults; adding requires an explicit policy", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const base = input(id, source, {
      scope: { kind: "subtree", fromNodeId: from.id, root: "original" },
      policy: null
    });
    const preview = service.previewAddFromGame(base);
    expect(preview).toEqual(service.previewAddFromGame({ ...base, policy: preview.defaultPolicy }));
    expect(preview.decisionsAdded).toBe(1);
    // Context moves (1. e4 e5 2. Nf3) are left out of both lists.
    expect(preview.opponentMoves.map((move) => move.path)).toEqual([
      "1. e4 e5 2. Nf3 Nc6",
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"
    ]);
    expect(preview.ownMoves.map((move) => move.path)).toEqual(["1. e4 e5 2. Nf3 Nc6 3. Bb5"]);
    expect(() => service.addFromGame(base)).toThrow(
      "Invalid policy: choose which moves to accept before adding"
    );
    expect(service.getRepertoire(id).chapters).toHaveLength(1);
  });

  it("a stale revision writes nothing", () => {
    const { id } = create();
    const confirmed = withDefaults(
      input(id, sourceOf(GAME_LINES), {
        scope: { kind: "subtree", fromNodeId: "root", root: "original" }
      })
    );
    service.addFromGame(confirmed);
    sent.length = 0;
    expect(() => service.addFromGame(confirmed)).toThrow(/Invalid expectedRevision/);
    expect(service.getRepertoire(id).chapters).toHaveLength(2);
    expect(service.listGameLinks({ repertoireId: id })).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("the whole game as a reference chapter adds no decisions", () => {
    const { id } = create();
    const base = input(id, sourceOf(GAME_LINES), {
      destination: { kind: "new-chapter", title: "Model game", chapterKind: "reference" }
    });
    const preview = service.previewAddFromGame(base);
    expect(preview.defaultPolicy).toEqual({ includedNodeIds: [], coveredNodeIds: [] });
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.warnings).toEqual([
      "Whole game added as reference: nothing will be trained until you accept moves"
    ]);
    const result = service.addFromGame(base);
    expect(result.chapter).toMatchObject({ title: "Model game", kind: "reference", nodeCount: 6 });
    expect(result.repertoire.decisionCount).toBe(0);
    expect(result.link.capturedPath).toBe("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6");
  });

  it("a standalone Black-to-move subtree becomes a chapter rooted at that position", () => {
    const { id } = create("black");
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const confirmed = withDefaults(
      input(id, source, { scope: { kind: "subtree", fromNodeId: from.id, root: "standalone" } })
    );
    const result = service.addFromGame(confirmed);
    expect(result.chapter.rootFen).toBe(from.fenAfter);
    expect(result.chapter.tree.map((node) => node.ply)).toEqual([3, 4, 5, 6]);
    expect(result.repertoire.decisionCount).toBe(2);
  });

  it("refuses a policy naming context, unknown or wrong-side moves, and an unknown game", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const e4 = nodeAt(source.tree, ["e2e4"]).id;
    const e5 = nodeAt(source.tree, ["e2e4", "e7e5"]).id;
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id;
    const scope = { kind: "subtree" as const, fromNodeId: from, root: "original" as const };
    expect(() =>
      service.previewAddFromGame(
        input(id, source, { scope, policy: { includedNodeIds: [e4], coveredNodeIds: [] } })
      )
    ).toThrow(`Invalid policy: node "${e4}" is not part of the selected material`);
    expect(() =>
      service.previewAddFromGame(
        input(id, source, { policy: { includedNodeIds: [e5], coveredNodeIds: [] } })
      )
    ).toThrow(`Invalid policy: node "${e5}" is not a white move, so it can't be accepted`);
    expect(() =>
      service.previewAddFromGame(
        input(id, source, { policy: { includedNodeIds: [], coveredNodeIds: [e4] } })
      )
    ).toThrow(`Invalid policy: node "${e4}" is not an opponent move, so it can't be covered`);
    expect(() =>
      service.previewAddFromGame(input(id, source, { scope: { kind: "path", toNodeId: "zz" } }))
    ).toThrow('Invalid scope: node "zz" is not in the game');
    expect(() => service.previewAddFromGame(input(id, sourceOf(GAME_LINES, "missing")))).toThrow(
      "Invalid source gameId: the game is not in the library"
    );
    const broken = sourceOf(GAME_LINES);
    broken.tree[1] = { ...broken.tree[1], uci: "e2e5" };
    expect(() => service.previewAddFromGame(input(id, broken))).toThrow(
      /^Invalid source tree: node "n1" plays an illegal move/
    );
  });

  it("a new line merged into a chapter with a training start trains, and says what won't", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5", "g1f3"]], {
      meta: (tree) => ({
        [nodeAt(tree, ["e2e4", "e7e5", "g1f3"]).id]: { edge: "included", trainingStart: true }
      })
    });
    const source = sourceOf([["d2d4", "d7d5", "c2c4"]]);
    const confirmed = withDefaults(
      input(id, source, {
        destination: { kind: "existing-chapter", chapterId: saved.chapter.id },
        scope: { kind: "path", toNodeId: nodeAt(source.tree, ["d2d4", "d7d5", "c2c4"]).id }
      })
    );
    const preview = service.previewAddFromGame(confirmed);
    expect(preview.decisionsAdded).toBe(1);
    // 1. d4 starts the new line, so its own position isn't asked; 2. c4 is.
    expect(preview.warnings).toEqual([
      "1 chosen move won't be trained: the chapter's training starts after them"
    ]);
    const result = service.addFromGame(confirmed);
    const d4 = result.chapter.tree.find((node) => node.uci === "d2d4")!;
    expect(result.chapter.nodeMeta[d4.id]).toEqual({ edge: "included", trainingStart: true });
    const afterD5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "d2d4")!, "d7d5")!);
    expect(decisionRepository.get(id, afterD5)?.acceptedUcis).toEqual(["c2c4"]);
  });

  it("an opponent context move covers a matched reference edge so the branch trains", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]], {
      meta: (tree) => ({ [nodeAt(tree, ["e2e4", "e7e5"]).id]: { edge: "reference" } })
    });
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const confirmed = withDefaults(
      input(id, source, {
        destination: { kind: "existing-chapter", chapterId: saved.chapter.id },
        scope: { kind: "subtree", fromNodeId: from.id, root: "original" }
      })
    );
    expect(service.previewAddFromGame(confirmed).warnings).toEqual([]);
    const result = service.addFromGame(confirmed);
    const e5 = result.chapter.tree.find((node) => node.uci === "e7e5")!;
    expect(result.chapter.nodeMeta[e5.id]).toEqual({ edge: "covered" });
    const bb5 = result.chapter.tree.find((node) => node.uci === "f1b5")!;
    expect(decisionRepository.get(id, positionKey(bb5.fenBefore))?.acceptedUcis).toEqual(["f1b5"]);
  });

  it("warns about chosen moves below an own reference move it can't accept", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5"]], {
      meta: (tree) => ({ [nodeAt(tree, ["e2e4"]).id]: { edge: "reference" } })
    });
    const source = sourceOf(GAME_LINES);
    const from = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]);
    const preview = service.previewAddFromGame(
      withDefaults(
        input(id, source, {
          destination: { kind: "existing-chapter", chapterId: saved.chapter.id },
          scope: { kind: "subtree", fromNodeId: from.id, root: "original" }
        })
      )
    );
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.warnings).toEqual([
      "None of the chosen moves will be trained: nothing from this material is asked",
      "1 chosen move won't be trained: Bb5 at 1. e4 e5 2. Nf3 Nc6 3. Bb5 is below an unaccepted move"
    ]);
  });

  it("warns when a whole game's chosen move is below an unticked one", () => {
    const { id } = create();
    const source = sourceOf(GAME_LINES);
    const nf3 = nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id;
    const preview = service.previewAddFromGame(
      input(id, source, {
        destination: { kind: "new-chapter", title: "", chapterKind: "opening" },
        policy: { includedNodeIds: [nf3], coveredNodeIds: [] }
      })
    );
    expect(preview.decisionsAdded).toBe(0);
    expect(preview.warnings).toEqual([
      "None of the chosen moves will be trained: nothing from this material is asked",
      "1 chosen move won't be trained: Nf3 at 1. e4 e5 2. Nf3 is below an unaccepted move"
    ]);
  });

  it("a re-supported stored move is no conflict and a suspended decision isn't counted as new", () => {
    const { id } = create();
    const saved = save(id, [["e2e4", "e7e5", "g1f3"]]);
    // 1. e4 and the 2. Nf3 decision lose their support; the stored choices stay.
    save(id, [["d2d4"]], { chapterId: saved.chapter.id });
    const afterE5 = positionKey(fenAfterUci(fenAfterUci(START_FEN, "e2e4")!, "e7e5")!);
    expect(decisionRepository.get(id, START_KEY)?.acceptedUcis).toEqual(["e2e4", "d2d4"]);
    expect(decisionRepository.get(id, afterE5)).toBeTruthy();
    const source = sourceOf([["e2e4", "e7e5", "g1f3"]]);
    const preview = service.previewAddFromGame(
      withDefaults(
        input(id, source, {
          scope: { kind: "path", toNodeId: nodeAt(source.tree, ["e2e4", "e7e5", "g1f3"]).id }
        })
      )
    );
    expect(preview.conflicts).toEqual([]);
    expect(preview.decisionsAdded).toBe(0);
  });

  it("keeps the link when the library game is deleted, and removes links on request", () => {
    const { id } = create();
    insertLibraryGame("game-1");
    const result = service.addFromGame(input(id, sourceOf(GAME_LINES, "game-1")));
    expect(result.link).toMatchObject({ gameId: "game-1", unsaved: false });
    getDb().exec("DELETE FROM games WHERE id = 'game-1'");
    const [link] = service.listGameLinks({ repertoireId: id, chapterId: result.chapter.id });
    expect(link).toMatchObject({
      id: result.link.id,
      gameId: null,
      unsaved: false,
      headers: { White: "Alice" }
    });
    expect(service.getChapter({ repertoireId: id, chapterId: result.chapter.id }).nodeCount).toBe(
      6
    );

    expect(() => service.listGameLinks({ repertoireId: id, chapterId: "nope" })).toThrow(
      "Invalid chapterId: not found"
    );
    expect(() => service.removeGameLink({ repertoireId: id, linkId: "nope" })).toThrow(
      "Invalid linkId: not found"
    );
    const revision = service.getRepertoire(id).revision;
    service.removeGameLink({ repertoireId: id, linkId: link.id });
    expect(service.listGameLinks({ repertoireId: id })).toEqual([]);
    expect(service.getRepertoire(id).revision).toBe(revision);
  });

  it("links a library game as model or played, once per kind, without a revision bump", () => {
    const { id, chapters, revision } = create();
    getDb()
      .prepare(
        `INSERT INTO games (id, source, white, black, pgn, current_fen, move_tree_json, headers_json,
          created_at, updated_at) VALUES ('game-2', 'pgn-import', 'Tal', 'Botvinnik', '', ?, '[]', ?, 1, 1)`
      )
      .run(
        START_FEN,
        JSON.stringify({ white: "Tal", black: "Botvinnik", eco: "B10", event: null })
      );
    const base = {
      repertoireId: id,
      chapterId: chapters[0].id,
      gameId: "game-2",
      gameNodeId: "n3",
      kind: "played" as const,
      capturedPath: "1. e4 c6"
    };
    sent.length = 0;
    const link = service.linkGame(base);
    expect(link).toMatchObject({
      ...base,
      headers: { White: "Tal", Black: "Botvinnik", ECO: "B10" }
    });
    expect(sent).toEqual([
      { channel: "repertoires:changed", payload: { repertoireId: id, revision, kind: "updated" } }
    ]);

    expect(service.linkGame(base)).toEqual(link);
    const moved = service.linkGame({
      ...base,
      chapterId: null,
      gameNodeId: null,
      capturedPath: ""
    });
    expect(moved).toEqual({ ...link, chapterId: null, gameNodeId: null, capturedPath: "" });
    const model = service.linkGame({ ...base, kind: "model" });
    expect(model.id).not.toBe(link.id);
    expect(
      service
        .listGameLinks({ repertoireId: id })
        .map((item) => item.id)
        .sort()
    ).toEqual([link.id, model.id].sort());
    expect(service.listGameLinks({ repertoireId: id })).toContainEqual(moved);
    expect(service.getRepertoire(id).revision).toBe(revision);

    expect(() => service.linkGame({ ...base, gameId: "missing" })).toThrow(
      "Invalid gameId: the game is not in the library"
    );
    expect(() => service.linkGame({ ...base, chapterId: "nope" })).toThrow(
      "Invalid chapterId: not found"
    );
    expect(() => service.linkGame({ ...base, repertoireId: "nope" })).toThrow(
      "Invalid repertoireId: not found"
    );
  });

  it("copies a played game's headers again when it is linked after it finished", () => {
    const { id, chapters } = create();
    const insertGame = getDb().prepare(
      `INSERT INTO games (id, source, white, black, pgn, current_fen, move_tree_json, headers_json,
        created_at, updated_at) VALUES ('game-3', 'engine-game', 'You', 'Stockfish', '', ?, '[]', ?, 1, 1)`
    );
    insertGame.run(START_FEN, JSON.stringify({ white: "You", black: "Stockfish", result: "*" }));
    const base = {
      repertoireId: id,
      chapterId: chapters[0].id,
      gameId: "game-3",
      gameNodeId: "n2",
      kind: "played" as const,
      capturedPath: "1. e4 c6"
    };
    const link = service.linkGame(base);
    expect(link.headers).toEqual({ White: "You", Black: "Stockfish", Result: "*" });

    getDb()
      .prepare("UPDATE games SET headers_json = ? WHERE id = 'game-3'")
      .run(JSON.stringify({ white: "You", black: "Stockfish", result: "1-0" }));
    const finished = service.linkGame(base);
    expect(finished).toEqual({
      ...link,
      headers: { White: "You", Black: "Stockfish", Result: "1-0" }
    });
    expect(service.listGameLinks({ repertoireId: id })).toEqual([finished]);
  });

  it("says a database from before played links needs a reset", () => {
    const { id, chapters } = create();
    getDb().exec(`DROP TABLE repertoire_game_links;
      CREATE TABLE repertoire_game_links (
        id TEXT PRIMARY KEY, repertoire_id TEXT NOT NULL, chapter_id TEXT, game_id TEXT,
        unsaved INTEGER NOT NULL DEFAULT 0, game_node_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('source', 'model')),
        headers_json TEXT NOT NULL DEFAULT '{}', captured_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL)`);
    getDb()
      .prepare(
        `INSERT INTO games (id, source, white, black, pgn, current_fen, move_tree_json, headers_json,
          created_at, updated_at) VALUES ('game-4', 'engine-game', 'You', 'Stockfish', '', ?, '[]', '{}', 1, 1)`
      )
      .run(START_FEN);
    const input = {
      repertoireId: id,
      chapterId: chapters[0].id,
      gameId: "game-4",
      gameNodeId: null,
      capturedPath: ""
    };
    expect(() => service.linkGame({ ...input, kind: "played" })).toThrow(
      "Invalid kind: this database predates played links; reset the development database"
    );
    expect(service.linkGame({ ...input, kind: "model" }).kind).toBe("model");
  });
});
