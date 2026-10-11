import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-library-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("./index");
const { gameRepository } = await import("./repositories");

describe("gameRepository library pages (SQLite)", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM game_reviews");
    getDb().exec("DELETE FROM games");
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

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
    insertGames(Array.from({ length: 450 }, (_, index) => ({ id: `g${index}`, updatedAt: index })));
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
    expect(Object.keys(page.items[0]).sort()).toEqual([
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
      gameRepository.listPage({ tab: "lichess", limit: 5 }).items.map((game) => game.id)
    ).toEqual(["deep-lichess"]);
    expect(
      gameRepository.listPage({ tab: "imported", limit: 5 }).items.map((game) => game.id)
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
    expect(gameRepository.listPage({ reviewed: true, limit: 5 }).items).toEqual([
      expect.objectContaining({ id: "g3", reviewCount: 1, lastReviewedAt: 5 })
    ]);
  });

  it("lists one source tab at a time, and Reviewed within it", () => {
    insertGames([
      { id: "li", source: "lichess", updatedAt: 1 },
      { id: "cc-old", source: "chesscom", updatedAt: 2 },
      { id: "cc-new", source: "chesscom", updatedAt: 9 },
      { id: "pgn", source: "pgn-import", updatedAt: 3 },
      { id: "engine", source: "engine-game", updatedAt: 4 },
      { id: "free", source: "new", updatedAt: 5 },
      { id: "study", source: "analysis", updatedAt: 6 },
      { id: "puzzle", source: "puzzle", updatedAt: 7 }
    ]);
    const ids = (query: Parameters<typeof gameRepository.listPage>[0]) =>
      gameRepository.listPage(query).items.map((game) => game.id);
    expect(ids({ tab: "chesscom" })).toEqual(["cc-new", "cc-old"]);
    expect(ids({ tab: "imported" })).toEqual(["pgn"]);
    expect(ids({ tab: "engine" })).toEqual(["engine"]);
    // Games made in the app; puzzle sessions never list.
    expect(ids({ tab: "chaturanga" })).toEqual(["study", "free"]);
    expect(ids({ tab: null })).toHaveLength(7);
    getDb()
      .prepare(
        "INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES ('r', 'cc-old', 5, '{}')"
      )
      .run();
    expect(ids({ tab: "chesscom", reviewed: true })).toEqual(["cc-old"]);
    expect(ids({ tab: "lichess", reviewed: true })).toEqual([]);
    expect(ids({ tab: "chesscom", reviewed: true, search: "nobody" })).toEqual([]);
    expect(ids({ tab: "chesscom", excludeId: "cc-new" })).toEqual(["cc-old"]);
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

  it("counts the games of each source tab, and the reviewed ones among them", () => {
    const counts = (games: number, reviewed: number) => ({ games, reviewed });
    expect(gameRepository.facets(null)).toEqual({
      hasGames: false,
      tabs: {
        lichess: counts(0, 0),
        chesscom: counts(0, 0),
        imported: counts(0, 0),
        engine: counts(0, 0),
        chaturanga: counts(0, 0)
      }
    });
    insertGames([
      { id: "board", source: "lichess", updatedAt: 1 },
      { id: "cc1", source: "chesscom", updatedAt: 2 },
      { id: "cc2", source: "chesscom", updatedAt: 3 },
      { id: "free", source: "new", updatedAt: 4 },
      { id: "study", source: "analysis", updatedAt: 5 },
      { id: "puzzle", source: "puzzle", updatedAt: 6 }
    ]);
    getDb()
      .prepare(
        `INSERT INTO game_reviews (review_id, game_id, created_at, review_json) VALUES
          ('r1', 'board', 5, '{}'), ('r2', 'cc2', 5, '{}'), ('r3', 'cc2', 6, '{}')`
      )
      .run();
    expect(gameRepository.facets(null)).toEqual({
      hasGames: true,
      tabs: {
        lichess: counts(1, 1),
        // A game with two analyses is one reviewed game.
        chesscom: counts(2, 1),
        imported: counts(0, 0),
        engine: counts(0, 0),
        // New and analysis games are the app's own; puzzle sessions aren't library games.
        chaturanga: counts(2, 0)
      }
    });
    // The game on the board still counts in its tab (the picker pins it on top of any tab).
    expect(gameRepository.facets("board").tabs.lichess).toEqual(counts(1, 1));
    getDb().exec("DELETE FROM games WHERE id != 'board'");
    expect(gameRepository.facets("board").hasGames).toBe(false);
    expect(gameRepository.facets(null).hasGames).toBe(true);
  });
});
