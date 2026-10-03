import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/unused" } }));
const { MIGRATIONS, runMigrations } = await import("./index");

const version = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

describe("runMigrations", () => {
  it("runs each migration once and records the version", () => {
    const db = new DatabaseSync(":memory:");
    let runs = 0;
    const migrations = [() => (runs += 1), () => (runs += 10)];
    runMigrations(db, migrations);
    runMigrations(db, migrations);
    expect(runs).toBe(11);
    expect(version(db)).toBe(2);
  });

  it("rolls a failing migration back and stops there", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    const failing = (database: DatabaseSync) => {
      database.exec("INSERT INTO t VALUES (1)");
      throw new Error("boom");
    };
    expect(() => runMigrations(db, [() => undefined, failing])).toThrow("boom");
    expect(version(db)).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 0 });
  });

  it("keeps a single default engine when an older database had several", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE engines (id TEXT PRIMARY KEY, name TEXT, executable_path TEXT, working_directory TEXT, args TEXT,
      protocol TEXT, is_default INTEGER, is_enabled INTEGER, created_at INTEGER, updated_at INTEGER)`);
    db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, source TEXT, site TEXT, updated_at INTEGER)`);
    db.exec(`CREATE TABLE external_databases (id TEXT PRIMARY KEY, source_id TEXT)`);
    db.exec(`INSERT INTO engines (id, is_default, updated_at) VALUES ('old', 1, 1), ('new', 1, 2)`);
    runMigrations(db, MIGRATIONS);
    expect(db.prepare("SELECT id FROM engines WHERE is_default = 1").all()).toEqual([{ id: "new" }]);
    expect(() => db.exec("UPDATE engines SET is_default = 1 WHERE id = 'old'")).toThrow();
  });

  it("6: moves each game's review into game_reviews and fingerprints the game", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, source TEXT, white TEXT, black TEXT, site TEXT, date TEXT,
      initial_fen TEXT, headers_json TEXT, move_tree_json TEXT, review_json TEXT, updated_at INTEGER)`);
    const root = { id: "root", parentId: null, children: ["m1"], fenAfter: "start", uci: null };
    const move = { id: "m1", parentId: "root", children: [], fenAfter: "after", uci: "e2e4" };
    const review = { engineId: "sf", engineName: "Stockfish", depth: null, moveTimeMs: 500, createdAt: 42, summary: {}, moves: [{ ply: 1 }], commentary: [{ ply: 1 }] };
    db.prepare("INSERT INTO games (id, source, white, move_tree_json, review_json) VALUES (?, 'pgn-import', 'Morphy', ?, ?)").run(
      "g1",
      JSON.stringify([root, move]),
      JSON.stringify(review)
    );
    db.prepare("INSERT INTO games (id, source, site, move_tree_json) VALUES ('g2', 'lichess', 'https://lichess.org/abcdEFGH', ?)").run(
      JSON.stringify([root])
    );
    db.exec("PRAGMA user_version = 5");
    runMigrations(db, MIGRATIONS);

    expect(db.prepare("SELECT game_id, created_at, engine_name, move_time_ms, move_count, commentary_count FROM game_reviews").all()).toEqual([
      { game_id: "g1", created_at: 42, engine_name: "Stockfish", move_time_ms: 500, move_count: 1, commentary_count: 1 }
    ]);
    const stored = db.prepare("SELECT review_json FROM game_reviews").get() as { review_json: string };
    expect(JSON.parse(stored.review_json).reviewId).toMatch(/^legacy-g1-/);
    const games = db.prepare("SELECT id, review_json, fingerprint FROM games ORDER BY id").all() as { id: string; review_json: null; fingerprint: string }[];
    expect(games[0]).toMatchObject({ review_json: null, fingerprint: expect.stringMatching(/^game:[0-9a-f]{64}$/) });
    expect(games[1]?.fingerprint).toBe("lichess:abcdEFGH");
  });

  it("7: creates the repertoire tables with cascades and one final grade per card", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE engines (id TEXT PRIMARY KEY, name TEXT, executable_path TEXT, working_directory TEXT, args TEXT,
      protocol TEXT, is_default INTEGER, is_enabled INTEGER, created_at INTEGER, updated_at INTEGER)`);
    db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, source TEXT, site TEXT, updated_at INTEGER)`);
    db.exec(`CREATE TABLE external_databases (id TEXT PRIMARY KEY, source_id TEXT)`);
    runMigrations(db, MIGRATIONS);
    expect(version(db)).toBe(MIGRATIONS.length);

    db.exec(`INSERT INTO repertoires (id, name, color, created_at, updated_at) VALUES ('r', 'R', 'white', 1, 1)`);
    db.exec(`INSERT INTO repertoire_chapters (id, repertoire_id, title, sort_order, kind, enabled, root_fen,
      headers_json, tree_json, node_metadata_json, created_at, updated_at)
      VALUES ('c', 'r', 'C', 0, 'opening', 1, 'fen', '{}', '[]', '{}', 1, 1)`);
    db.exec(`INSERT INTO repertoire_position_index (repertoire_id, chapter_id, node_id, position_key, scope_state,
      ply, revision, key_version) VALUES ('r', 'c', 'root', 'k', 'active', 0, 1, 1)`);
    db.exec(`INSERT INTO repertoire_practice_sessions (id, repertoire_id, mode, scope_json, snapshot_revision,
      queue_json, card_state_json, status, created_at, updated_at)
      VALUES ('s', 'r', 'learn-new', '{}', 1, '[]', '{}', 'active', 1, 1)`);
    const attempt = (id: string, sequence: number, final: number) =>
      db.exec(`INSERT INTO repertoire_attempts (attempt_id, session_id, queue_item_id, sequence, kind,
        is_final_grade, position_key, fingerprint, at) VALUES ('${id}', 's', 'q', ${sequence}, 'attempt', ${final}, 'k', '', 1)`);
    attempt("a1", 1, 1);
    attempt("a2", 2, 0);
    expect(() => attempt("a3", 3, 1)).toThrow();
    expect(() => attempt("a4", 2, 0)).toThrow();

    db.exec("DELETE FROM repertoires WHERE id = 'r'");
    for (const table of ["repertoire_chapters", "repertoire_position_index", "repertoire_attempts"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it("8: game links cascade with the repertoire and survive the game or chapter being deleted", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE engines (id TEXT PRIMARY KEY, name TEXT, executable_path TEXT, working_directory TEXT, args TEXT,
      protocol TEXT, is_default INTEGER, is_enabled INTEGER, created_at INTEGER, updated_at INTEGER)`);
    db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, source TEXT, site TEXT, updated_at INTEGER)`);
    db.exec(`CREATE TABLE external_databases (id TEXT PRIMARY KEY, source_id TEXT)`);
    runMigrations(db, MIGRATIONS);
    expect(version(db)).toBe(MIGRATIONS.length);

    db.exec(`INSERT INTO games (id, source) VALUES ('g', 'pgn-import')`);
    db.exec(`INSERT INTO repertoires (id, name, color, created_at, updated_at) VALUES ('r', 'R', 'white', 1, 1)`);
    db.exec(`INSERT INTO repertoire_chapters (id, repertoire_id, title, sort_order, kind, enabled, root_fen,
      headers_json, tree_json, node_metadata_json, created_at, updated_at)
      VALUES ('c', 'r', 'C', 0, 'opening', 1, 'fen', '{}', '[]', '{}', 1, 1)`);
    const link = (id: string, kind = "source", gameId = "g") =>
      db.exec(`INSERT INTO repertoire_game_links (id, repertoire_id, chapter_id, game_id, kind, created_at)
        VALUES ('${id}', 'r', 'c', '${gameId}', '${kind}', 1)`);
    link("l1");
    link("l4", "model");
    link("l5", "played");
    expect(() => link("l2", "other")).toThrow();
    expect(() => link("l3", "source", "missing")).toThrow();

    db.exec("DELETE FROM games WHERE id = 'g'");
    db.exec("DELETE FROM repertoire_chapters WHERE id = 'c'");
    expect(db.prepare("SELECT chapter_id, game_id, headers_json FROM repertoire_game_links WHERE id = 'l1'").get()).toEqual({
      chapter_id: null,
      game_id: null,
      headers_json: "{}"
    });
    db.exec("DELETE FROM repertoires WHERE id = 'r'");
    expect(db.prepare("SELECT COUNT(*) AS n FROM repertoire_game_links").get()).toEqual({ n: 0 });
  });

  it("9: adds puzzle attempts and a single-row puzzle rating", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA user_version = 8");
    runMigrations(db, MIGRATIONS);
    expect(version(db)).toBe(9);

    const insertAttempt = (id: string, outcome: string) =>
      db.exec(`INSERT INTO puzzle_attempts (id, puzzle_id, database_id, source_id, outcome, started_at, decided_at)
        VALUES ('${id}', 'p', 'd', 'lichess-puzzles', '${outcome}', 1, 2)`);
    insertAttempt("a1", "solved");
    insertAttempt("a2", "failed");
    expect(() => insertAttempt("a3", "abandoned")).toThrow();
    expect(db.prepare("SELECT rated, wrong_move_count, solution_viewed, themes_json, completed_at FROM puzzle_attempts WHERE id = 'a1'").get()).toEqual({
      rated: 0,
      wrong_move_count: 0,
      solution_viewed: 0,
      themes_json: "[]",
      completed_at: null
    });

    db.exec("INSERT INTO puzzle_rating (id, rating, rd, volatility, updated_at) VALUES (1, 1500, 500, 0.09, 1)");
    expect(() => db.exec("INSERT INTO puzzle_rating (id, rating, rd, volatility, updated_at) VALUES (2, 1500, 500, 0.09, 1)")).toThrow();
  });
});
