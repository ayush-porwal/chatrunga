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

function runMigrations(database: DatabaseSync): void {
  const gamesColumns = database.prepare("PRAGMA table_info(games)").all() as { name: string }[];
  if (!gamesColumns.some((column) => column.name === "review_json")) {
    database.exec("ALTER TABLE games ADD COLUMN review_json TEXT");
  }
  if (!gamesColumns.some((column) => column.name === "current_node_id")) {
    database.exec("ALTER TABLE games ADD COLUMN current_node_id TEXT");
  }
  const enginesColumns = database.prepare("PRAGMA table_info(engines)").all() as { name: string }[];
  if (!enginesColumns.some((column) => column.name === "weights_path")) {
    database.exec("ALTER TABLE engines ADD COLUMN weights_path TEXT");
  }
  if (!enginesColumns.some((column) => column.name === "image_path")) {
    database.exec("ALTER TABLE engines ADD COLUMN image_path TEXT");
  }
  if (!enginesColumns.some((column) => column.name === "is_human_prediction")) {
    database.exec("ALTER TABLE engines ADD COLUMN is_human_prediction INTEGER DEFAULT 0");
  }
  if (!enginesColumns.some((column) => column.name === "maia_rating")) {
    database.exec("ALTER TABLE engines ADD COLUMN maia_rating INTEGER");
  }
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS external_databases_source_idx
    ON external_databases(source_id)`);
  // Puzzle sessions were previously autosaved; they are not "games" in the library sense.
  database.exec("DELETE FROM games WHERE source = 'puzzle'");
}

export function closeDb(): void {
  db?.close();
  db = null;
}
