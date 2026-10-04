import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { MOVE_ASSESSMENT_POLICY } from "@chaturanga/shared/chess/move-assessment";
import { trapReviewMoves } from "@chaturanga/shared/chess/__fixtures__/trap-game";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repo-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, databasePath, getDb } = await import("./index");
const { gameRepository, retryOnceIfBusy, saveGameRetrying } = await import("./repositories");
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
    .prepare(
      "INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES (?, ?, ?, ?)"
    )
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
    expect(gameRepository.listPage().items.map((item) => item.id)).toEqual(["chosen-id"]);
  });

  it("rebuilds a damaged move tree from the stored PGN", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run("{not json", saved.id);
    const reopened = gameRepository.get(saved.id);
    expect(reopened?.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual([
      "e4",
      "e5",
      "Nf3"
    ]);
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
    expect(reopened.review?.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
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
        nodeId: mainline[index]!.id,
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
    expect(opened.moves.map((move) => move.assessment?.annotation ?? null)).toEqual([
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
    expect(opened.opening).toEqual({
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
      moves: stored.moves.map((move, index) => (index === 8 ? { ...move, motifs: null } : move))
    };
    storeReview(saved.id, damaged);
    const partly = gameRepository.get(saved.id)!.review!;
    expect(partly.assessmentsRecomputed).toBe(true);
    expect(partly.moves[8]?.assessment).toBeUndefined();
    expect(
      partly.moves
        .map((move) => move.assessment?.annotation ?? null)
        .filter((annotation) => annotation && annotation !== "book")
    ).toEqual(["blunder", "good", "mistake"]);
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
    expect(reopened.review?.moves.map((move) => move.san)).toEqual(["Bb5", "a6", "Ba4"]);
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
      expect(reopened.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual([
        "e4",
        "e5",
        "Nf3"
      ]);
      expect(reopened.moveTree.map((node) => node.id)).not.toEqual(
        saved.moveTree.map((node) => node.id)
      );
    }
  });

  it("opens a stored tree as it is when it's well formed", () => {
    const saved = saveImported();
    expect(gameRepository.get(saved.id)?.moveTree).toEqual(saved.moveTree);
    // Annotations are part of a well-formed tree.
    const annotated = saved.moveTree.map((node, index) =>
      index === 1
        ? {
            ...node,
            arrows: [{ orig: "e2", dest: "e4", color: "green" }],
            highlights: [{ square: "e4", color: "red" }]
          }
        : node
    );
    getDb()
      .prepare("UPDATE games SET move_tree_json = ? WHERE id = ?")
      .run(JSON.stringify(annotated), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toEqual(annotated);
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
    expect(gameRepository.get(saved.id)?.headers).toEqual({
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

  describe("library pages", () => {
    type Row = {
      id: string;
      source?: string;
      white?: string | null;
      black?: string | null;
      event?: string | null;
      updatedAt: number;
    };

    /** Test-only: library rows straight into the table (thousands, without parsing PGN). */
    function insertGames(rows: Row[]) {
      const insert = getDb().prepare(
        `INSERT INTO games (id, source, white, black, event, pgn, current_fen, move_tree_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', 'startpos', '[]', ?, ?)`
      );
      getDb().exec("BEGIN");
      for (const row of rows) {
        insert.run(
          row.id,
          row.source ?? "pgn-import",
          row.white ?? "A",
          row.black ?? "B",
          row.event ?? null,
          row.updatedAt,
          row.updatedAt
        );
      }
      getDb().exec("COMMIT");
    }

    /** Every page from the first on; fails on a page past the limit or a cursor that loops. */
    function readAll(query: Parameters<typeof gameRepository.listPage>[0] = {}, limit = 50) {
      const ids: string[] = [];
      let cursor = null as ReturnType<typeof gameRepository.listPage>["nextCursor"];
      let pages = 0;
      do {
        const page = gameRepository.listPage({ ...query, limit, cursor });
        expect(page.items.length).toBeLessThanOrEqual(limit);
        ids.push(...page.items.map((game) => game.id));
        cursor = page.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(10_000);
      } while (cursor);
      return { ids, pages };
    }

    /** The order every page follows: newest first, then by id. */
    function ordered(rows: Row[]): string[] {
      return [...rows]
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((row) => row.id);
    }

    it("pages through games saved in the same millisecond without repeats or gaps", () => {
      // 125 games share one timestamp, across page boundaries, between newer and older ones.
      const rows: Row[] = [
        { id: "newest", updatedAt: 3_000 },
        ...Array.from({ length: 125 }, (_, index) => ({
          id: `tie-${String(index).padStart(3, "0")}`,
          updatedAt: 2_000
        })),
        { id: "oldest", updatedAt: 1_000 }
      ];
      insertGames(rows);
      for (const limit of [1, 7, 50]) {
        const { ids } = readAll({}, limit);
        expect(ids).toEqual(ordered(rows));
        expect(new Set(ids).size).toBe(rows.length);
      }
    });

    it("pages a large library completely, in order, and stops with no next page", () => {
      const rows: Row[] = Array.from({ length: 2_000 }, (_, index) => ({
        id: `g${index}`,
        // Runs of 10 games share a timestamp; ids sort as text (g10 before g2).
        updatedAt: 1_000_000 - Math.floor(index / 10)
      }));
      insertGames(rows);
      const { ids, pages } = readAll({}, 200);
      expect(ids).toEqual(ordered(rows));
      expect(pages).toBe(10);
      const last = gameRepository.listPage({
        limit: 200,
        cursor: { updatedAt: 1_000_000 - 199, id: "g1999" }
      });
      expect(last).toEqual({ items: [], nextCursor: null });
    });

    it("keeps a page within the limit, clamped to 1..200", () => {
      insertGames(
        Array.from({ length: 450 }, (_, index) => ({ id: `g${index}`, updatedAt: index }))
      );
      expect(gameRepository.listPage().items).toHaveLength(50);
      expect(gameRepository.listPage({ limit: 10 }).items).toHaveLength(10);
      expect(gameRepository.listPage({ limit: 10_000 }).items).toHaveLength(200);
      expect(gameRepository.listPage({ limit: 0 }).items).toHaveLength(1);
      expect(gameRepository.listPage({ limit: -5 }).items).toHaveLength(1);
      expect(gameRepository.listPage({ limit: 2.9 }).items).toHaveLength(2);
      const page = gameRepository.listPage({ limit: 3 });
      expect(page.items.map((game) => game.id)).toEqual(["g449", "g448", "g447"]);
      expect(page.nextCursor).toEqual({ updatedAt: 447, id: "g447" });
      // A summary only: no PGN, move tree or review.
      expect(Object.keys(page.items[0]!).sort()).toEqual([
        "black",
        "currentFen",
        "date",
        "event",
        "id",
        "lastReviewedAt",
        "result",
        "reviewCount",
        "source",
        "updatedAt",
        "white"
      ]);
    });

    it("filters and searches before the limit: a rare match deep in the library is on page 1", () => {
      insertGames([
        ...Array.from({ length: 1_000 }, (_, index) => ({
          id: `g${index}`,
          updatedAt: 10_000 + index,
          white: "Anon",
          black: "Anon"
        })),
        {
          id: "deep-lichess",
          source: "lichess",
          white: "Ånand",
          black: "Topalov",
          event: "Sofia",
          updatedAt: 1
        },
        { id: "deep-puzzle", source: "puzzle", white: "Ånand", updatedAt: 2 }
      ]);
      // Case folded as JavaScript does (SQLite's lower() would miss "Å").
      expect(gameRepository.listPage({ search: "  ÅNAND ", limit: 5 })).toEqual({
        items: [expect.objectContaining({ id: "deep-lichess" })],
        nextCursor: null
      });
      expect(
        gameRepository.listPage({ search: "sofia", limit: 5 }).items.map((game) => game.id)
      ).toEqual(["deep-lichess"]);
      expect(
        gameRepository.listPage({ filter: "lichess", limit: 5 }).items.map((game) => game.id)
      ).toEqual(["deep-lichess"]);
      expect(
        gameRepository.listPage({ filter: "other", limit: 5 }).items.map((game) => game.id)
      ).not.toContain("deep-lichess");
      // A search with wildcards is plain text.
      expect(gameRepository.listPage({ search: "%", limit: 5 }).items).toEqual([]);
      // The game on the board is left out; puzzle sessions never list.
      expect(gameRepository.listPage({ search: "ånand", excludeId: "deep-lichess" }).items).toEqual(
        []
      );
      expect(readAll({}, 200).ids).not.toContain("deep-puzzle");

      getDb()
        .prepare(
          "INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES ('r', 'g3', 5, '{}')"
        )
        .run();
      expect(gameRepository.listPage({ filter: "reviewed", limit: 5 }).items).toEqual([
        expect.objectContaining({ id: "g3", reviewCount: 1, lastReviewedAt: 5 })
      ]);
    });

    it("searches a filtered list across pages with the cursor", () => {
      insertGames(
        Array.from({ length: 300 }, (_, index) => ({
          id: `g${String(index).padStart(3, "0")}`,
          updatedAt: Math.floor(index / 4),
          white: index % 3 === 0 ? "Match" : "Other"
        }))
      );
      const expected = ordered(
        Array.from({ length: 300 }, (_, index) => ({
          id: `g${String(index).padStart(3, "0")}`,
          updatedAt: Math.floor(index / 4)
        }))
      ).filter((id) => Number(id.slice(1)) % 3 === 0);
      expect(readAll({ search: "match" }, 7).ids).toEqual(expected);
    });

    it("says which filters the library has games for", () => {
      expect(gameRepository.facets(null)).toEqual({
        hasGames: false,
        hasLichess: false,
        hasReviewed: false
      });
      insertGames([
        { id: "board", source: "lichess", updatedAt: 1 },
        { id: "puzzle", source: "puzzle", updatedAt: 2 }
      ]);
      getDb()
        .prepare(
          "INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES ('r', 'board', 5, '{}')"
        )
        .run();
      expect(gameRepository.facets(null)).toEqual({
        hasGames: true,
        hasLichess: true,
        hasReviewed: true
      });
      // Leaving out the game on the board: Lichess still counts it (as the picker always did).
      expect(gameRepository.facets("board")).toEqual({
        hasGames: false,
        hasLichess: true,
        hasReviewed: false
      });
    });
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
      ).toEqual([
        ["second", "Lc0", 0],
        ["first", "Stockfish 17", 1]
      ]);
      expect(opened.reviews[1]?.maiaLevels).toEqual([]);
      expect(gameRepository.getReview(game.id, "first")?.commentary?.[0]?.prose).toBe(
        "Good start."
      );
      expect(gameRepository.getReview(game.id, "missing")).toBeNull();
      expect(gameRepository.listPage().items[0]).toMatchObject({
        reviewCount: 2,
        lastReviewedAt: 20
      });
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
      if (other.isTransaction) other.exec("ROLLBACK");
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
        if (other.isTransaction) other.exec("ROLLBACK");
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
        if (other.isTransaction) other.exec("ROLLBACK");
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
      if (other.isTransaction) other.exec("ROLLBACK");
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
        const suppressed = () => (deleted ? new Error("suppressed") : null);
        await expect(
          saveGameRetrying({ ...game, id: "g-deleted" }, suppressed, 300)
        ).rejects.toThrow("suppressed");
      });
      expect(gameRepository.get("g-deleted")).toBeNull();
    },
    BUSY_WAIT_MS
  );
});
