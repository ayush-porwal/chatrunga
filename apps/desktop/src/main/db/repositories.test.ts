import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { MOVE_ASSESSMENT_POLICY } from "@chaturanga/shared/chess/move-assessment";
import { trapReviewMoves } from "@chaturanga/shared/chess/__fixtures__/trap-game";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { rollbackIfOpen } from "./rows";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repo-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, databasePath, getDb } = await import("./index");
const { engineRepository, gameRepository, retryOnceIfBusy, saveGameRetrying } =
  await import("./repositories");
const { gameFingerprint } = await import("./game-fingerprint");

const PGN = `[Event "Rapid"]
[White "Carlsen"]
[Black "Nepo"]
[WhiteElo "2830"]
[TimeControl "600+5"]
[ECO "C65"]
[Termination "Normal"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0`;

/** Test-only: puts a review straight into game_reviews (replacing the game's ones), bypassing the save path. */
/** The tree with `change` applied to every move node (the root has no move). */
function onMoves<T extends object = MoveNode>(
  tree: readonly MoveNode[],
  change: (node: MoveNode) => T
): (MoveNode | T)[] {
  return tree.map((node) => (node.san ? change(node) : node));
}

/** The items with `change` applied to the one at `index`. */
function withAt<T, U>(items: readonly T[], index: number, change: (item: T) => U): (T | U)[] {
  return items.map((item, at) => (at === index ? change(item) : item));
}

/** Each move's annotation (null for a move left unassessed). */
function annotations(moves: readonly Pick<MoveReview, "assessment">[]): (string | null)[] {
  return moves.map((move) => move.assessment?.annotation ?? null);
}

const isMarkBeyondBook = (annotation: string | null) =>
  annotation !== null && annotation !== "book";

/** A suppression check: the error once `condition` holds, else none. */
function errorOnceTrue(condition: () => boolean, message: string): () => Error | null {
  return () => (condition() ? new Error(message) : null);
}

function storeReview(gameId: string, review: object) {
  getDb().prepare("DELETE FROM game_reviews WHERE game_id = ?").run(gameId);
  getDb()
    .prepare(
      "INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES (?, ?, ?, ?)"
    )
    .run(`test-${gameId}`, gameId, 1, JSON.stringify(review));
}

function saveImported() {
  const { game } = importPgnText(PGN);
  return gameRepository.save({ ...game, headers: game.headers });
}

describe("engineRepository pictures (SQLite)", () => {
  it("creates an engine under a chosen id, and moves its picture without reordering the list", () => {
    const engine = engineRepository.create(
      { name: "Lc0", executablePath: "/opt/lc0", imagePath: "/old.png", isDefault: false },
      "chosen-id"
    );
    expect(engine).toMatchObject({ id: "chosen-id", imagePath: "/old.png" });
    // Only while the picture is still the one being moved.
    expect(engineRepository.replaceImagePath("chosen-id", "/other.png", "/new.png")).toBe(false);
    expect(engineRepository.replaceImagePath("chosen-id", "/old.png", "/new.png")).toBe(true);
    expect(engineRepository.get("chosen-id")).toMatchObject({
      imagePath: "/new.png",
      updatedAt: engine.updatedAt
    });
    expect(engineRepository.replaceImagePath("missing", "/old.png", null)).toBe(false);
    engineRepository.remove("chosen-id");
  });

  it("stores how an engine runs: a UCI process unless created as the Maia 3 row", () => {
    const uci = engineRepository.create({ name: "Stockfish", executablePath: "/opt/sf" });
    const maia = engineRepository.create({
      name: "Maia (managed)",
      executablePath: "/engines/maia3_simplified.onnx",
      isHumanPrediction: true,
      runtime: "maia3"
    });
    expect(engineRepository.get(uci.id)?.runtime).toBe("custom-uci");
    // An update (a picture, a rename) keeps it.
    engineRepository.update(maia.id, { imagePath: "/maia.png" });
    expect(engineRepository.get(maia.id)).toMatchObject({
      runtime: "maia3",
      isHumanPrediction: true
    });
    // Maia is never made the default engine (it evaluates nothing); the default stays.
    expect(engineRepository.get(uci.id)?.isDefault).toBe(true);
    expect(() => engineRepository.update(maia.id, { isDefault: true })).toThrow(
      /Maia can't be the default engine/
    );
    expect(engineRepository.get(uci.id)?.isDefault).toBe(true);
    expect(engineRepository.get(maia.id)?.isDefault).toBe(false);
    // The registry sync repairs a row's runtime.
    expect(engineRepository.update(uci.id, { runtime: "maia3" }).runtime).toBe("maia3");
    engineRepository.remove(uci.id);
    engineRepository.remove(maia.id);
  });
});

describe("gameRepository (SQLite)", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM game_reviews");
    getDb().exec("DELETE FROM games");
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("keeps every header through save and get", () => {
    const saved = saveImported();
    expect(gameRepository.get(saved.id)?.headers).toMatchObject({
      white: "Carlsen",
      whiteElo: "2830",
      timeControl: "600+5",
      eco: "C65",
      termination: "Normal",
      result: "1-0"
    });
  });

  it("keeps whether a game was left on the Analyze board, apart from its source", () => {
    const { game } = importPgnText(PGN);
    const saved = gameRepository.save({ ...game, id: "imported", analysisBoard: true });
    expect(gameRepository.get(saved.id)).toMatchObject({
      source: "pgn-import",
      analysisBoard: true
    });
    // A save that doesn't say (an older caller) keeps it; one that does changes it.
    gameRepository.save({ ...game, id: "imported" });
    expect(gameRepository.get("imported")?.analysisBoard).toBe(true);
    gameRepository.save({ ...game, id: "imported", analysisBoard: false });
    expect(gameRepository.get("imported")?.analysisBoard).toBe(false);
    // Saved before it was kept: not said at all (the renderer falls back to the source).
    getDb().exec("UPDATE games SET analysis_board = NULL");
    expect(gameRepository.get("imported")).not.toHaveProperty("analysisBoard");
  });

  it("stores the id the renderer chose for a new game", () => {
    const { game } = importPgnText(PGN);
    const saved = gameRepository.save({ ...game, id: "chosen-id" });
    expect(saved.id).toBe("chosen-id");
    expect(gameRepository.listPage().items.map((item) => item.id)).toStrictEqual(["chosen-id"]);
  });

  it("rebuilds a damaged move tree from the stored PGN", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run("{not json", saved.id);
    const reopened = gameRepository.get(saved.id);
    expect(reopened?.moveTree.filter((node) => node.san).map((node) => node.san)).toStrictEqual([
      "e4",
      "e5",
      "Nf3"
    ]);
  });

  it("finds the newest engine game still in progress, skipping ones that can't be rejoined", () => {
    const engineGame = (id: string, pgn: string, headers: Record<string, string> = {}) => {
      const { game } = importPgnText(pgn);
      gameRepository.save({
        ...game,
        id,
        source: "engine-game",
        headers: { ...game.headers, white: "You", black: "Stockfish", ...headers }
      });
    };
    expect(gameRepository.latestUnfinishedEngineGame()).toBeNull();
    engineGame("older", "1. e4 e5 *");
    engineGame("finished", "1. e4 e5 1-0", { result: "1-0" });
    engineGame("continuation", "1. d4 *", { event: "Puzzle continuation" });
    engineGame("no-moves", "*");
    engineGame("no-you", "1. e4 *", { white: "Stockfish", black: "Maia 1500" });
    engineGame("both-you", "1. e4 *", { black: "you" });
    gameRepository.save({ ...importPgnText("1. c4 *").game, id: "imported" });
    // Newest first: every game but "older" is newer and none of them counts.
    const order = [
      "older",
      "finished",
      "continuation",
      "no-moves",
      "no-you",
      "both-you",
      "imported"
    ];
    order.forEach((id, index) =>
      getDb()
        .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
        .run(index + 1, id)
    );
    expect(gameRepository.latestUnfinishedEngineGame()?.id).toBe("older");
  });

  it("keeps a timed move's play time, and rebuilds a tree whose play time is damaged", () => {
    const { game } = importPgnText("1. e4 *");
    const moveTree = onMoves(game.moveTree, (node) => ({
      ...node,
      clockAfter: "0:01:59",
      playedAt: 1_700_000_000_000
    }));
    const saved = gameRepository.save({ ...game, id: "timed", moveTree });
    expect(gameRepository.get(saved.id)?.moveTree.find((node) => node.san)).toMatchObject({
      clockAfter: "0:01:59",
      playedAt: 1_700_000_000_000
    });
    const damaged = onMoves<object>(moveTree, (node) => ({ ...node, playedAt: "soon" }));
    getDb()
      .prepare("UPDATE games SET move_tree_json = ? WHERE id = ?")
      .run(JSON.stringify(damaged), saved.id);
    expect(
      gameRepository.get(saved.id)?.moveTree.find((node) => node.san)?.playedAt
    ).toBeUndefined();
  });

  it("moves a saved review onto the rebuilt tree, or drops one that doesn't fit", () => {
    const saved = saveImported();
    const mainline = saved.moveTree.filter((node) => node.san);
    const review = {
      engineId: "sf",
      depth: null,
      moveTimeMs: 100,
      createdAt: 1,
      summary: {},
      moves: mainline.map((node, index) => ({
        nodeId: node.id,
        ply: index + 1,
        san: node.san,
        fenAfter: node.fenAfter
      }))
    };
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run("{not json", saved.id);
    storeReview(saved.id, review);
    const reopened = gameRepository.get(saved.id)!;
    const rebuiltIds = new Set(reopened.moveTree.map((node) => node.id));
    expect(reopened.review?.moves.map((move) => move.san)).toStrictEqual(["e4", "e5", "Nf3"]);
    expect(reopened.review?.moves.every((move) => rebuiltIds.has(move.nodeId))).toBe(true);

    // A damaged move entry drops the review; the game still opens.
    const damaged = { ...review, moves: [null, ...review.moves] };
    storeReview(saved.id, damaged);
    expect(gameRepository.get(saved.id)?.review).toBeNull();
    expect(gameRepository.get(saved.id)?.moveTree.length).toBeGreaterThan(1);

    // A review of other moves than the PGN's: dropped, not attached to the wrong ones.
    const wrong = {
      ...review,
      moves: review.moves.map((move) => ({ ...move, fenAfter: "8/8/8/8/8/8/8/8 w - - 0 1" }))
    };
    storeReview(saved.id, wrong);
    expect(gameRepository.get(saved.id)?.review).toBeNull();
  });

  it("opens an analysis saved before move assessments re-assessed from its evaluations, book moves and opening included, leaving the row as it was", () => {
    const { game } = importPgnText(
      `[Event "Trap"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`
    );
    const saved = gameRepository.save({ ...game, id: "trap" });
    const mainline = saved.moveTree.filter((node) => node.san);
    const stored = {
      schemaVersion: 2,
      engineId: "sf",
      depth: null,
      moveTimeMs: 100,
      createdAt: 1,
      summary: {
        totalMoves: 14,
        best: 14,
        excellent: 0,
        good: 0,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
        missedTactics: 0,
        averageCentipawnLoss: 0
      },
      moves: trapReviewMoves().map((move, index) => ({
        ...move,
        nodeId: mainline[index].id,
        classification: "best"
      }))
    };
    storeReview(saved.id, stored);

    const opened = gameRepository.get(saved.id)!.review!;
    expect(opened).toMatchObject({
      assessmentPolicy: MOVE_ASSESSMENT_POLICY,
      assessmentsRecomputed: true
    });
    // The first six moves are opening theory (3… Nd4 included), from the bundled opening book.
    expect(annotations(opened.moves)).toStrictEqual([
      "book",
      "book",
      "book",
      "book",
      "book",
      "book",
      "blunder",
      "good",
      "blunder",
      "good",
      null,
      null,
      "mistake",
      null
    ]);
    expect(opened.summary).toMatchObject({ book: 6, inaccuracies: 0, mistakes: 1, blunders: 2 });
    expect(opened.opening).toStrictEqual({
      eco: "C50",
      name: "Italian Game: Blackburne-Kostić Gambit",
      ply: 6,
      bookEndPly: 6,
      firstNonBookMove: { ply: 7, san: "Nxe5" }
    });
    expect(gameRepository.getReview(saved.id, `test-${saved.id}`)?.assessmentsRecomputed).toBe(
      true
    );
    // Nothing is written back: the saved analysis is exactly what was stored.
    const row = getDb()
      .prepare("SELECT review_json FROM game_reviews WHERE game_id = ?")
      .get(saved.id) as { review_json: string };
    expect(row.review_json).toBe(JSON.stringify(stored));

    // One damaged move stays unmarked; the rest keep their marks.
    const damaged = {
      ...stored,
      moves: withAt(stored.moves, 8, (move) => ({ ...move, motifs: null }))
    };
    storeReview(saved.id, damaged);
    const partly = gameRepository.get(saved.id)!.review!;
    expect(partly.assessmentsRecomputed).toBe(true);
    expect(partly.moves[8]?.assessment).toBeUndefined();
    expect(annotations(partly.moves).filter(isMarkBeyondBook)).toStrictEqual([
      "blunder",
      "good",
      "mistake"
    ]);
  });

  it("moves the review of a game from a set-up position too, and puts the cursor on the rebuilt tree", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const { game } = importPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n3. Bb5 a6 4. Ba4 *`);
    const saved = gameRepository.save({ ...game, id: "from-fen" });
    const mainline = saved.moveTree.filter((node) => node.san);
    expect(mainline[0].ply).toBeGreaterThan(1); // absolute plies
    const review = {
      engineId: "sf",
      depth: null,
      moveTimeMs: 100,
      createdAt: 1,
      summary: {},
      moves: mainline.map((node) => ({
        nodeId: node.id,
        ply: node.ply,
        san: node.san,
        fenAfter: node.fenAfter
      }))
    };
    const cursor = mainline[1];
    getDb()
      .prepare(
        "UPDATE games SET move_tree_json = ?, current_node_id = ?, current_fen = ? WHERE id = ?"
      )
      .run("{not json", cursor.id, cursor.fenAfter, saved.id);
    storeReview(saved.id, review);
    const reopened = gameRepository.get(saved.id)!;
    expect(reopened.review?.moves.map((move) => move.san)).toStrictEqual(["Bb5", "a6", "Ba4"]);
    const node = reopened.moveTree.find((item) => item.id === reopened.currentNodeId);
    expect(node?.fenAfter).toBe(cursor.fenAfter);
  });

  it("rebuilds a tree whose links point at missing moves", () => {
    const saved = saveImported();
    const broken = saved.moveTree.slice(0, -1);
    getDb()
      .prepare("UPDATE games SET move_tree_json = ? WHERE id = ?")
      .run(JSON.stringify(broken), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toHaveLength(saved.moveTree.length);
  });

  it("rebuilds a tree with a duplicate child, a cycle, a stray move, a missing field, a bad FEN or annotation", () => {
    const saved = saveImported();
    const [root, e4, e5, nf3] = saved.moveTree;
    const damaged = [
      // e4 listed twice under the root.
      [{ ...root, children: [e4.id, e4.id] }, e4, e5, nf3],
      // e5 and Nf3 point at each other, apart from the root's line.
      [
        { ...root, children: [e4.id] },
        { ...e4, children: [] },
        { ...e5, parentId: nf3.id },
        { ...nf3, children: [e5.id] }
      ],
      // Nf3 isn't anyone's child.
      [root, e4, { ...e5, children: [] }, nf3],
      // e5 has no SAN.
      [root, e4, { ...e5, san: undefined }, nf3],
      // The root isn't the canonical one.
      [{ ...root, id: "start" }, { ...e4, parentId: "start" }, e5, nf3],
      // A position the board can't show.
      [root, { ...e4, fenAfter: "not a fen" }, e5, nf3],
      // Malformed annotations.
      [root, { ...e4, arrows: [null] }, e5, nf3],
      [root, e4, { ...e5, highlights: [{ square: "z9", color: "green" }] }, nf3]
    ];
    for (const tree of damaged) {
      getDb()
        .prepare("UPDATE games SET move_tree_json = ? WHERE id = ?")
        .run(JSON.stringify(tree), saved.id);
      const reopened = gameRepository.get(saved.id)!;
      expect(reopened.moveTree.filter((node) => node.san).map((node) => node.san)).toStrictEqual([
        "e4",
        "e5",
        "Nf3"
      ]);
      expect(reopened.moveTree.map((node) => node.id)).not.toStrictEqual(
        saved.moveTree.map((node) => node.id)
      );
    }
  });

  it("opens a stored tree as it is when it's well formed", () => {
    const saved = saveImported();
    expect(gameRepository.get(saved.id)?.moveTree).toStrictEqual(saved.moveTree);
    // Annotations are part of a well-formed tree.
    const annotated = withAt(saved.moveTree, 1, (node) => ({
      ...node,
      arrows: [{ orig: "e2", dest: "e4", color: "green" }],
      highlights: [{ square: "e4", color: "red" }]
    }));
    getDb()
      .prepare("UPDATE games SET move_tree_json = ? WHERE id = ?")
      .run(JSON.stringify(annotated), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toStrictEqual(annotated);
  });

  it("drops stored headers with a value that isn't text, for the PGN's", () => {
    const saved = saveImported();
    getDb()
      .prepare("UPDATE games SET headers_json = ? WHERE id = ?")
      .run(JSON.stringify({ white: 1 }), saved.id);
    expect(gameRepository.get(saved.id)?.headers).toBeNull();
    getDb()
      .prepare("UPDATE games SET headers_json = ? WHERE id = ?")
      .run(JSON.stringify({ white: "Carlsen", eco: null, orientationHint: "black" }), saved.id);
    expect(gameRepository.get(saved.id)?.headers).toStrictEqual({
      white: "Carlsen",
      eco: null,
      orientationHint: "black"
    });
  });

  it("refuses to open a game whose PGN would rebuild only part of the tree", () => {
    const saved = saveImported();
    getDb()
      .prepare("UPDATE games SET move_tree_json = '[]', pgn = ? WHERE id = ?")
      .run("1. e4 e5 2. Ke3 Nc6 *", saved.id);
    expect(() => gameRepository.get(saved.id)).toThrow(/damaged/);
  });

  it("refuses to open a game whose tree and PGN are both damaged", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = '[]', pgn = '' WHERE id = ?").run(saved.id);
    expect(() => gameRepository.get(saved.id)).toThrow(/damaged/);
  });

  it("lists summaries through the recent-games index and counts without reading rows", () => {
    saveImported();
    const plan = getDb()
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM games WHERE source != 'puzzle' ORDER BY updated_at DESC, id"
      )
      .all() as { detail: string }[];
    expect(plan.map((row) => row.detail).join(" ")).toContain("games_recent_idx");
    expect(gameRepository.count()).toBe(1);
    expect(gameRepository.idsBySource("pgn-import")).toHaveLength(1);
  });

  describe("analyses", () => {
    const reviewOf = (
      game: ReturnType<typeof saveImported>,
      reviewId: string,
      createdAt: number,
      extra: object = {}
    ) => ({
      reviewId,
      engineId: "sf",
      engineName: "Stockfish 17",
      depth: null,
      moveTimeMs: 1000,
      createdAt,
      summary: {},
      moves: game.moveTree
        .filter((node) => node.san)
        .map((node) => ({
          nodeId: node.id,
          ply: node.ply,
          san: node.san,
          fenAfter: node.fenAfter
        })),
      ...extra
    });
    const saveWith = (game: ReturnType<typeof saveImported>, review: object | null | undefined) => {
      const { game: session } = importPgnText(PGN);
      return gameRepository.save({ ...session, id: game.id, review: review as never });
    };

    it("re-analysing adds an analysis; each keeps its own commentary; the newest opens with the game", () => {
      const game = saveImported();
      saveWith(
        game,
        reviewOf(game, "first", 10, {
          maiaEngines: [{ rating: 1500, engineId: "m", name: "Maia" }]
        })
      );
      saveWith(game, reviewOf(game, "second", 20, { engineName: "Lc0" }));
      // Commentary arriving for the older one (shown again) updates that one only.
      saveWith(
        game,
        reviewOf(game, "first", 10, {
          commentary: [{ ply: 1, prose: "Good start.", generatedAt: 11 }]
        })
      );

      const opened = gameRepository.get(game.id)!;
      expect(opened.review?.reviewId).toBe("second");
      expect(
        opened.reviews.map((info) => [info.reviewId, info.engineName, info.commentaryCount])
      ).toStrictEqual([
        ["second", "Lc0", 0],
        ["first", "Stockfish 17", 1]
      ]);
      expect(opened.reviews[1]?.maiaLevels).toStrictEqual([]);
      expect(gameRepository.getReview(game.id, "first")?.commentary?.[0]?.prose).toBe(
        "Good start."
      );
      expect(gameRepository.getReview(game.id, "missing")).toBeNull();
      expect(gameRepository.listPage().items[0]).toMatchObject({
        reviewCount: 2,
        lastReviewedAt: 20
      });
    });

    it("lists which Maia an analysis read; a Maia 3 rating curve saved into a move outlives later saves without it", () => {
      const game = saveImported();
      const maia = {
        model: "maia3",
        modelVersion: "maia3_simplified@0013cc8",
        white: { rating: 2800, source: "game" },
        black: { rating: 1500, source: "settings" }
      };
      saveWith(
        game,
        reviewOf(game, "maia1", 10, {
          maiaEngines: [{ rating: 1900, engineId: "m", name: "Maia 1900" }]
        })
      );
      saveWith(game, reviewOf(game, "maia3", 20, { maia }));
      expect(
        gameRepository
          .get(game.id)!
          .reviews.map((info) => [info.reviewId, info.maiaModel, info.maiaLevels])
      ).toStrictEqual([
        // Maia 3: White's and Black's ratings, in that order.
        ["maia3", "maia3", [2800, 1500]],
        ["maia1", "maia1", [1900]]
      ]);
      expect(gameRepository.get(game.id)!.reviews.map((info) => info.engineId)).toStrictEqual([
        "sf",
        "sf"
      ]);
      // Stored so that builds knowing only Maia 1 (they keep the integers) list no Maia levels.
      const listing = (reviewId: string) =>
        getDb()
          .prepare("SELECT maia_levels_json FROM game_reviews WHERE review_id = ?")
          .get(reviewId)?.maia_levels_json;
      expect(JSON.parse(String(listing("maia3")))).toStrictEqual([
        "maia3",
        { white: 2800, black: 1500 }
      ]);
      // A listing the first Maia 3 builds wrote (the ratings as integers) still reads.
      getDb()
        .prepare("UPDATE game_reviews SET maia_levels_json = ? WHERE review_id = 'maia3'")
        .run(JSON.stringify(["maia3", 2800, 1500]));
      expect(gameRepository.get(game.id)!.reviews[0]).toMatchObject({
        maiaModel: "maia3",
        maiaLevels: [2800, 1500]
      });

      const move = gameRepository.getReview(game.id, "maia3")!.moves[1];
      const curve = [{ rating: 600, topMoves: [{ uci: "b8c6", prob: 0.4 }], whiteWinProb: 0.6 }];
      const target = { index: 1, ply: move.ply, fenAfter: move.fenAfter, curve };
      expect(gameRepository.saveMaiaCurve(game.id, "maia3", target)).toBe(true);
      // Not that move any more, or no such analysis: nothing is saved.
      const moved = { ...target, fenAfter: "8/8/8/8/8/8/8/8 w - - 0 1" };
      expect(gameRepository.saveMaiaCurve(game.id, "maia3", moved)).toBe(false);
      expect(gameRepository.saveMaiaCurve(game.id, "missing", target)).toBe(false);
      expect(gameRepository.getReview(game.id, "maia3")!.moves[1].humanPredictions).toStrictEqual(
        curve
      );

      // The renderer saves the analysis it loaded before the curve (a comment arrived): kept.
      saveWith(
        game,
        reviewOf(game, "maia3", 20, {
          maia,
          commentary: [{ ply: 1, prose: "Good start.", generatedAt: 21 }]
        })
      );
      const saved = gameRepository.getReview(game.id, "maia3")!;
      expect(saved.commentary).toHaveLength(1);
      expect(saved.moves.map((item) => item.humanPredictions)).toStrictEqual([
        undefined,
        curve,
        undefined
      ]);
    });

    it("saving without a review (or with none) never removes the saved ones", () => {
      const game = saveImported();
      saveWith(game, reviewOf(game, "kept", 10));
      saveWith(game, null);
      saveWith(game, undefined);
      expect(gameRepository.get(game.id)?.reviews.map((info) => info.reviewId)).toStrictEqual([
        "kept"
      ]);
    });

    const reviewIdsOf = (gameId: string) =>
      getDb()
        .prepare("SELECT review_id FROM game_reviews WHERE game_id = ? ORDER BY review_id")
        .all(gameId)
        .map((row) => row.review_id);
    /**
     * Two games with analyses: `game` (`${p}a`, `${p}b`, `${p}c`) and `other` (`${p}other`). Each
     * test takes its own prefix: a deleted id stays deleted for the whole run (main remembers it).
     */
    const twoReviewedGames = (p: string) => {
      const game = saveImported();
      saveWith(game, reviewOf(game, `${p}a`, 10));
      saveWith(game, reviewOf(game, `${p}b`, 20));
      saveWith(game, reviewOf(game, `${p}c`, 30));
      const { game: session } = importPgnText(PGN.replace("2. Nf3", "2. Nc3"));
      const other = gameRepository.save(session);
      saveWith(other, reviewOf(other, `${p}other`, 40));
      return { game, other };
    };

    it("deleting one analysis deletes only that one: the game and every other analysis stay", () => {
      const { game, other } = twoReviewedGames("one-");
      const before = gameRepository.get(game.id)!;

      expect(gameRepository.removeReview(game.id, "one-c")).toBe(true);

      expect(reviewIdsOf(game.id)).toStrictEqual(["one-a", "one-b"]);
      expect(reviewIdsOf(other.id)).toStrictEqual(["one-other"]);
      const after = gameRepository.get(game.id)!;
      expect(after).toMatchObject({ pgn: before.pgn, moveTree: before.moveTree, reviewCount: 2 });
      // The newest left now opens with the game.
      expect(after.review?.reviewId).toBe("one-b");
      // An analysis of another game isn't deleted through this one's id.
      expect(gameRepository.removeReview(game.id, "one-other")).toBe(false);
      expect(reviewIdsOf(other.id)).toStrictEqual(["one-other"]);
    });

    it("deleting all of a game's analyses keeps the game and other games' analyses", () => {
      const { game, other } = twoReviewedGames("all-");

      expect(gameRepository.removeReviews(game.id)).toBe(3);

      expect(reviewIdsOf(game.id)).toStrictEqual([]);
      expect(reviewIdsOf(other.id)).toStrictEqual(["all-other"]);
      expect(gameRepository.get(game.id)).toMatchObject({
        id: game.id,
        review: null,
        reviews: [],
        reviewCount: 0
      });
      expect(gameRepository.removeReviews(game.id)).toBe(0);
    });

    it("a late save of the game carrying a deleted analysis doesn't bring it back", () => {
      const { game } = twoReviewedGames("late-");
      gameRepository.removeReview(game.id, "late-b");
      gameRepository.removeReviews(game.id);
      // The debounced autosave writes the game with the analysis that was shown.
      saveWith(game, reviewOf(game, "late-b", 20));
      saveWith(game, reviewOf(game, "late-a", 10));
      expect(reviewIdsOf(game.id)).toStrictEqual([]);
      // A new analysis still saves.
      saveWith(game, reviewOf(game, "late-new", 50));
      expect(reviewIdsOf(game.id)).toStrictEqual(["late-new"]);
    });

    it("deleting a game deletes its analyses", () => {
      const game = saveImported();
      saveWith(game, reviewOf(game, "gone", 10));
      gameRepository.remove(game.id);
      expect({ ...getDb().prepare("SELECT COUNT(*) AS n FROM game_reviews").get() }).toStrictEqual({
        n: 0
      });
    });

    it("finds the same game by fingerprint", () => {
      const game = saveImported();
      const { game: again } = importPgnText(PGN);
      expect(gameRepository.findIdByFingerprint(gameFingerprint(again)!)).toBe(game.id);
      const { game: other } = importPgnText(PGN.replace("2. Nf3", "2. Nc3"));
      expect(gameRepository.findIdByFingerprint(gameFingerprint(other)!)).toBeNull();
    });
  });
});

// The busy tests below wait out SQLite's 1 s busy_timeout (once or twice): bounded by a sleep, not
// CPU, so each gets a 15 s ceiling instead of the 5 s default to stay clear of slow CI runners.
const BUSY_WAIT_MS = 15_000;

describe("retryOnceIfBusy (a game save while another connection holds the write lock)", () => {
  it("a save finding the write lock held fails with the BUSY error itself, not a failed ROLLBACK", () => {
    getDb();
    const other = new DatabaseSync(databasePath());
    try {
      other.exec("BEGIN IMMEDIATE");
      getDb().exec("PRAGMA busy_timeout = 0");
      let caught: unknown;
      try {
        saveImported();
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ errcode: 5 });
      expect(getDb().isTransaction).toBe(false);
    } finally {
      getDb().exec("PRAGMA busy_timeout = 1000");
      rollbackIfOpen(other);
      other.close();
    }
  });

  it(
    "retries once after the delay and saves when the lock was released meanwhile",
    async () => {
      getDb();
      const other = new DatabaseSync(databasePath());
      try {
        other.exec("BEGIN IMMEDIATE");
        // Runs once the first attempt has failed (its busy wait blocks this thread).
        setTimeout(() => other.exec("ROLLBACK"), 10);
        const saved = await retryOnceIfBusy(() => saveImported(), 300);
        expect(gameRepository.get(saved.id)).not.toBeNull();
      } finally {
        rollbackIfOpen(other);
        other.close();
      }
    },
    BUSY_WAIT_MS
  );

  it(
    "rejects with the busy error when the lock is still held, and passes other errors at once",
    async () => {
      getDb();
      const other = new DatabaseSync(databasePath());
      try {
        other.exec("BEGIN IMMEDIATE");
        await expect(retryOnceIfBusy(() => saveImported(), 10)).rejects.toMatchObject({
          errcode: 5
        });
      } finally {
        rollbackIfOpen(other);
        other.close();
      }
      let calls = 0;
      await expect(
        retryOnceIfBusy(() => {
          calls += 1;
          throw new Error("Game not found");
        }, 10)
      ).rejects.toThrow("Game not found");
      expect(calls).toBe(1);
    },
    BUSY_WAIT_MS
  );
});

describe("saveGameRetrying (games:save)", () => {
  const busyWhile = async (work: (release: () => void) => Promise<void>) => {
    getDb();
    const other = new DatabaseSync(databasePath());
    try {
      other.exec("BEGIN IMMEDIATE");
      await work(() => other.exec("ROLLBACK"));
    } finally {
      rollbackIfOpen(other);
      other.close();
    }
  };

  it(
    "keeps a new game's id across the retry, so it is saved once",
    async () => {
      const { game } = importPgnText(PGN);
      const count = () =>
        (getDb().prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n;
      const before = count();
      await busyWhile(async (release) => {
        setTimeout(release, 10);
        const saved = await saveGameRetrying({ ...game, id: null }, () => null, 300);
        expect(gameRepository.get(saved.id)).not.toBeNull();
      });
      expect(count()).toBe(before + 1);
    },
    BUSY_WAIT_MS
  );

  it(
    "checks the delete guard again before the retry",
    async () => {
      const { game } = importPgnText(PGN);
      let deleted = false;
      await busyWhile(async (release) => {
        // The game is deleted while the retry waits.
        setTimeout(() => {
          deleted = true;
          release();
        }, 10);
        const suppressed = errorOnceTrue(() => deleted, "suppressed");
        await expect(
          saveGameRetrying({ ...game, id: "g-deleted" }, suppressed, 300)
        ).rejects.toThrow("suppressed");
      });
      expect(gameRepository.get("g-deleted")).toBeNull();
    },
    BUSY_WAIT_MS
  );
});
