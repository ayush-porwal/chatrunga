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
});
