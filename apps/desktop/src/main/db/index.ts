import { app } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;

const ddl = [
  `CREATE TABLE IF NOT EXISTS engines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    executable_path TEXT NOT NULL,
    working_directory TEXT,
    args TEXT,
    image_path TEXT,
    protocol TEXT NOT NULL,
    is_default INTEGER NOT NULL,
    is_enabled INTEGER NOT NULL,
    is_human_prediction INTEGER,
    maia_rating INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    white TEXT,
    black TEXT,
    event TEXT,
    site TEXT,
    round TEXT,
    result TEXT,
    date TEXT,
    initial_fen TEXT,
    pgn TEXT NOT NULL,
    current_fen TEXT NOT NULL,
    current_node_id TEXT,
    move_tree_json TEXT NOT NULL,
    review_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS external_databases (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    format TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    record_count INTEGER,
    source_url TEXT NOT NULL,
    page_url TEXT NOT NULL,
    license TEXT NOT NULL,
    downloaded_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`
];

export function getDb(): DatabaseSync {
  if (db) return db;

  const dbPath = join(app.getPath("userData"), "chaturanga.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  for (const statement of ddl) db.exec(statement);
  runMigrations(db);
  return db;
}

function columnsOf(database: DatabaseSync, table: string): Set<string> {
  return new Set((database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
}

function addColumn(database: DatabaseSync, table: string, column: string, type: string): void {
  if (!columnsOf(database, table).has(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Schema changes, in order; each runs once, inside a transaction, and the database's
 * `user_version` records how many have run. Append new ones — never edit or reorder old ones.
 * (Databases from before the ledger are at version 0 and run them all; the first is written to
 * be safe on any of those.)
 */
export const MIGRATIONS: readonly ((database: DatabaseSync) => void)[] = [
  // 1: everything added before migrations were versioned.
  (database) => {
    addColumn(database, "games", "review_json", "TEXT");
    addColumn(database, "games", "current_node_id", "TEXT");
    addColumn(database, "engines", "weights_path", "TEXT");
    addColumn(database, "engines", "image_path", "TEXT");
    addColumn(database, "engines", "is_human_prediction", "INTEGER DEFAULT 0");
    addColumn(database, "engines", "maia_rating", "INTEGER");
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS external_databases_source_idx ON external_databases(source_id)");
    // Lichess imports are deduplicated by their game URL (Site header).
    database.exec("CREATE INDEX IF NOT EXISTS games_site_idx ON games(site)");
    // Puzzle sessions were once autosaved; they are not library games.
    database.exec("DELETE FROM games WHERE source = 'puzzle'");
  },
  // 2: every header of a saved game (Elo, time control, opening, termination…).
  (database) => addColumn(database, "games", "headers_json", "TEXT"),
  // 3: one default engine at most (keep the most recently updated one if there were several).
  (database) => {
    database.exec(`UPDATE engines SET is_default = 0 WHERE is_default = 1 AND id NOT IN (
      SELECT id FROM engines WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1)`);
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS engines_one_default ON engines(is_default) WHERE is_default = 1");
  },
  // 4: the library lists games newest first (F15): an index for that order, without puzzles.
  (database) =>
    database.exec("CREATE INDEX IF NOT EXISTS games_recent_idx ON games(updated_at DESC, id) WHERE source != 'puzzle'"),
  // 5: usage analytics (telemetry/): events waiting to be sent, and the installation's own state
  // (random id, milestones reached, last active day). Nothing in them is game content.
  (database) => {
    database.exec(`CREATE TABLE IF NOT EXISTS telemetry_outbox (
      uuid TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec("CREATE INDEX IF NOT EXISTS telemetry_outbox_due_idx ON telemetry_outbox(next_attempt_at, occurred_at)");
    database.exec(`CREATE TABLE IF NOT EXISTS telemetry_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  }
];

export function runMigrations(database: DatabaseSync, migrations = MIGRATIONS): void {
  const { user_version: version } = database.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let index = version; index < migrations.length; index += 1) {
    database.exec("BEGIN");
    try {
      migrations[index](database);
      database.exec(`PRAGMA user_version = ${index + 1}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function closeDb(): void {
  db?.close();
  db = null;
}
