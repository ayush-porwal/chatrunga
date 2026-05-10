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
    protocol TEXT NOT NULL,
    is_default INTEGER NOT NULL,
    is_enabled INTEGER NOT NULL,
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
    move_tree_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
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
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
