import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repo-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("./index");
const { gameRepository } = await import("./repositories");
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
function storeReview(gameId: string, review: object) {
  getDb().prepare("DELETE FROM game_reviews WHERE game_id = ?").run(gameId);
  getDb()
    .prepare("INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES (?, ?, ?, ?)")
    .run(`test-${gameId}`, gameId, 1, JSON.stringify(review));
}

function saveImported() {
  const { game } = importPgnText(PGN);
  return gameRepository.save({ ...game, headers: game.headers });
}

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

  it("stores the id the renderer chose for a new game", () => {
    const { game } = importPgnText(PGN);
    const saved = gameRepository.save({ ...game, id: "chosen-id" });
    expect(saved.id).toBe("chosen-id");
    expect(gameRepository.list().map((item) => item.id)).toEqual(["chosen-id"]);
  });

  it("rebuilds a damaged move tree from the stored PGN", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run("{not json", saved.id);
    const reopened = gameRepository.get(saved.id);
    expect(reopened?.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual(["e4", "e5", "Nf3"]);
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
      moves: mainline.map((node, index) => ({ nodeId: node.id, ply: index + 1, san: node.san, fenAfter: node.fenAfter }))
    };
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run("{not json", saved.id);
    storeReview(saved.id, review);
    const reopened = gameRepository.get(saved.id)!;
    const rebuiltIds = new Set(reopened.moveTree.map((node) => node.id));
    expect(reopened.review?.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(reopened.review?.moves.every((move) => rebuiltIds.has(move.nodeId))).toBe(true);

    // A damaged move entry drops the review; the game still opens.
    const damaged = { ...review, moves: [null, ...review.moves] };
    storeReview(saved.id, damaged);
    expect(gameRepository.get(saved.id)?.review).toBeNull();
    expect(gameRepository.get(saved.id)?.moveTree.length).toBeGreaterThan(1);

    // A review of other moves than the PGN's: dropped, not attached to the wrong ones.
    const wrong = { ...review, moves: review.moves.map((move) => ({ ...move, fenAfter: "8/8/8/8/8/8/8/8 w - - 0 1" })) };
    storeReview(saved.id, wrong);
    expect(gameRepository.get(saved.id)?.review).toBeNull();
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
      moves: mainline.map((node) => ({ nodeId: node.id, ply: node.ply, san: node.san, fenAfter: node.fenAfter }))
    };
    const cursor = mainline[1];
    getDb()
      .prepare("UPDATE games SET move_tree_json = ?, current_node_id = ?, current_fen = ? WHERE id = ?")
      .run("{not json", cursor.id, cursor.fenAfter, saved.id);
    storeReview(saved.id, review);
    const reopened = gameRepository.get(saved.id)!;
    expect(reopened.review?.moves.map((move) => move.san)).toEqual(["Bb5", "a6", "Ba4"]);
    const node = reopened.moveTree.find((item) => item.id === reopened.currentNodeId);
    expect(node?.fenAfter).toBe(cursor.fenAfter);
  });

  it("rebuilds a tree whose links point at missing moves", () => {
    const saved = saveImported();
    const broken = saved.moveTree.slice(0, -1);
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run(JSON.stringify(broken), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toHaveLength(saved.moveTree.length);
  });

  it("rebuilds a tree with a duplicate child, a cycle, a stray move, a missing field, a bad FEN or annotation", () => {
    const saved = saveImported();
    const [root, e4, e5, nf3] = saved.moveTree;
    const damaged = [
      // e4 listed twice under the root.
      [{ ...root, children: [e4.id, e4.id] }, e4, e5, nf3],
      // e5 and Nf3 point at each other, apart from the root's line.
      [{ ...root, children: [e4.id] }, { ...e4, children: [] }, { ...e5, parentId: nf3.id }, { ...nf3, children: [e5.id] }],
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
      getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run(JSON.stringify(tree), saved.id);
      const reopened = gameRepository.get(saved.id)!;
      expect(reopened.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual(["e4", "e5", "Nf3"]);
      expect(reopened.moveTree.map((node) => node.id)).not.toEqual(saved.moveTree.map((node) => node.id));
    }
  });

  it("opens a stored tree as it is when it's well formed", () => {
    const saved = saveImported();
    expect(gameRepository.get(saved.id)?.moveTree).toEqual(saved.moveTree);
    // Annotations are part of a well-formed tree.
    const annotated = saved.moveTree.map((node, index) =>
      index === 1 ? { ...node, arrows: [{ orig: "e2", dest: "e4", color: "green" }], highlights: [{ square: "e4", color: "red" }] } : node
    );
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run(JSON.stringify(annotated), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toEqual(annotated);
  });

  it("drops stored headers with a value that isn't text, for the PGN's", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET headers_json = ? WHERE id = ?").run(JSON.stringify({ white: 1 }), saved.id);
    expect(gameRepository.get(saved.id)?.headers).toBeNull();
    getDb()
      .prepare("UPDATE games SET headers_json = ? WHERE id = ?")
      .run(JSON.stringify({ white: "Carlsen", eco: null, orientationHint: "black" }), saved.id);
    expect(gameRepository.get(saved.id)?.headers).toEqual({ white: "Carlsen", eco: null, orientationHint: "black" });
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
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM games WHERE source != 'puzzle' ORDER BY updated_at DESC, id")
      .all() as { detail: string }[];
    expect(plan.map((row) => row.detail).join(" ")).toContain("games_recent_idx");
    expect(gameRepository.count()).toBe(1);
    expect(gameRepository.idsBySource("pgn-import")).toHaveLength(1);
  });

  describe("analyses", () => {
    const reviewOf = (game: ReturnType<typeof saveImported>, reviewId: string, createdAt: number, extra: object = {}) => ({
      reviewId,
      engineId: "sf",
      engineName: "Stockfish 17",
      depth: null,
      moveTimeMs: 1000,
      createdAt,
      summary: {},
      moves: game.moveTree.filter((node) => node.san).map((node) => ({ nodeId: node.id, ply: node.ply, san: node.san, fenAfter: node.fenAfter })),
      ...extra
    });
    const saveWith = (game: ReturnType<typeof saveImported>, review: object | null | undefined) => {
      const { game: session } = importPgnText(PGN);
      return gameRepository.save({ ...session, id: game.id, review: review as never });
    };

    it("re-analysing adds an analysis; each keeps its own commentary; the newest opens with the game", () => {
      const game = saveImported();
      saveWith(game, reviewOf(game, "first", 10, { maiaEngines: [{ rating: 1500, engineId: "m", name: "Maia" }] }));
      saveWith(game, reviewOf(game, "second", 20, { engineName: "Lc0" }));
      // Commentary arriving for the older one (shown again) updates that one only.
      saveWith(game, reviewOf(game, "first", 10, { commentary: [{ ply: 1, prose: "Good start.", generatedAt: 11 }] }));

      const opened = gameRepository.get(game.id)!;
      expect(opened.review?.reviewId).toBe("second");
      expect(opened.reviews.map((info) => [info.reviewId, info.engineName, info.commentaryCount])).toEqual([
        ["second", "Lc0", 0],
        ["first", "Stockfish 17", 1]
      ]);
      expect(opened.reviews[1]?.maiaLevels).toEqual([]);
      expect(gameRepository.getReview(game.id, "first")?.commentary?.[0]?.prose).toBe("Good start.");
      expect(gameRepository.getReview(game.id, "missing")).toBeNull();
      expect(gameRepository.list()[0]).toMatchObject({ reviewCount: 2, lastReviewedAt: 20 });
    });

    it("saving without a review (or with none) never removes the saved ones", () => {
      const game = saveImported();
      saveWith(game, reviewOf(game, "kept", 10));
      saveWith(game, null);
      saveWith(game, undefined);
      expect(gameRepository.get(game.id)?.reviews.map((info) => info.reviewId)).toEqual(["kept"]);
    });

    it("deleting a game deletes its analyses", () => {
      const game = saveImported();
      saveWith(game, reviewOf(game, "gone", 10));
      gameRepository.remove(game.id);
      expect(getDb().prepare("SELECT COUNT(*) AS n FROM game_reviews").get()).toEqual({ n: 0 });
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
