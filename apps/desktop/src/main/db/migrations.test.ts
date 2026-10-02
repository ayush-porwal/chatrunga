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
});
