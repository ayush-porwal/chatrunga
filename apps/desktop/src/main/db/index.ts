import { app } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";
import type { GameReview } from "@chaturanga/shared/types/engine";
import { gameFingerprint } from "./game-fingerprint";
import { reviewListingFields, reviewRowId } from "./review-rows";
import { setRepertoireConnection } from "../repertoire/connection";

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

/** The database file (the import writer worker opens its own connection to it). */
export function databasePath(): string {
  return join(app.getPath("userData"), "chaturanga.sqlite");
}

export function getDb(): DatabaseSync {
  if (db) return db;

  const dbPath = databasePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  // The import writer worker's connection holds the write lock while it stores an import.
  // Repertoire writes wait for it at the service's write gate, asynchronously, so they never sleep
  // here. node:sqlite's busy handler sleeps synchronously (the main process stalls), so the timeout
  // is bounded: a rare other write (a game autosave) stalls up to 1 s rather than failing.
  db.exec("PRAGMA busy_timeout = 1000");
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
  },
  // 6: every analysis of a game is kept (re-analysing adds one; each has its own AI commentary),
  // in its own table, and games get a fingerprint so importing one the library has opens it.
  (database) => {
    database.exec(`CREATE TABLE IF NOT EXISTS game_reviews (
      review_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      engine_name TEXT,
      move_time_ms INTEGER,
      depth INTEGER,
      maia_levels_json TEXT NOT NULL DEFAULT '[]',
      move_count INTEGER NOT NULL DEFAULT 0,
      commentary_count INTEGER NOT NULL DEFAULT 0,
      review_json TEXT NOT NULL
    )`);
    database.exec("CREATE INDEX IF NOT EXISTS game_reviews_game_idx ON game_reviews(game_id, created_at DESC)");
    addColumn(database, "games", "fingerprint", "TEXT");
    database.exec("CREATE INDEX IF NOT EXISTS games_fingerprint_idx ON games(fingerprint)");

    // A database old enough may lack some of these columns: they read as null.
    const columns = columnsOf(database, "games");
    const pick = (name: string) => (columns.has(name) ? name : `NULL AS ${name}`);
    const wanted = ["site", "white", "black", "date", "initial_fen", "headers_json", "move_tree_json", "review_json"];
    const rows = database
      .prepare(`SELECT id, ${wanted.map(pick).join(", ")} FROM games`)
      .all() as {
      id: string;
      site: string | null;
      white: string | null;
      black: string | null;
      date: string | null;
      initial_fen: string | null;
      headers_json: string | null;
      move_tree_json: string | null;
      review_json: string | null;
    }[];
    const insertReview = database.prepare(`INSERT OR IGNORE INTO game_reviews (
      review_id, game_id, created_at, engine_name, move_time_ms, depth, maia_levels_json, move_count, commentary_count, review_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const setFingerprint = database.prepare("UPDATE games SET fingerprint = ?, review_json = NULL WHERE id = ?");
    for (const row of rows) {
      if (row.review_json) {
        try {
          const review = JSON.parse(row.review_json) as GameReview;
          if (review && Array.isArray(review.moves)) {
            const reviewId = reviewRowId(review, row.id);
            const fields = reviewListingFields(review);
            insertReview.run(
              reviewId,
              row.id,
              fields.created_at,
              fields.engine_name,
              fields.move_time_ms,
              fields.depth,
              fields.maia_levels_json,
              fields.move_count,
              fields.commentary_count,
              JSON.stringify({ ...review, reviewId })
            );
          }
        } catch {
          // An unreadable review was already being dropped when the game opened.
        }
      }
      setFingerprint.run(storedFingerprint(row), row.id);
    }
  },
  // 7: repertoires (main/repertoire). Chapters hold the authored trees;
  // decisions, progress and the position index are keyed by the versioned position key. Attempts
  // cascade only from their session (never from a decision), so edits keep practice history.
  (database) => {
    database.exec(`CREATE TABLE IF NOT EXISTS repertoires (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_chapters (
      id TEXT PRIMARY KEY,
      repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      root_fen TEXT NOT NULL,
      headers_json TEXT NOT NULL,
      tree_json TEXT NOT NULL,
      node_metadata_json TEXT NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    database.exec(
      "CREATE INDEX IF NOT EXISTS repertoire_chapters_order_idx ON repertoire_chapters(repertoire_id, sort_order)"
    );
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_decisions (
      repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      position_key TEXT NOT NULL,
      accepted_ucis_json TEXT NOT NULL,
      preferred_uci TEXT,
      prompt TEXT,
      hint TEXT,
      wrong_move_feedback_json TEXT NOT NULL DEFAULT '{}',
      paused INTEGER NOT NULL DEFAULT 0,
      acceptance_fingerprint TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (repertoire_id, position_key)
    )`);
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_position_index (
      repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES repertoire_chapters(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      position_key TEXT NOT NULL,
      scope_state TEXT NOT NULL,
      is_decision INTEGER NOT NULL DEFAULT 0,
      ply INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      key_version INTEGER NOT NULL,
      PRIMARY KEY (chapter_id, node_id)
    )`);
    database.exec(
      "CREATE INDEX IF NOT EXISTS repertoire_position_index_key_idx ON repertoire_position_index(repertoire_id, position_key)"
    );
    database.exec(
      "CREATE INDEX IF NOT EXISTS repertoire_position_index_chapter_idx ON repertoire_position_index(chapter_id)"
    );
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_progress (
      repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      position_key TEXT NOT NULL,
      stage INTEGER NOT NULL,
      due_at INTEGER,
      last_attempt_at INTEGER,
      lapses INTEGER NOT NULL DEFAULT 0,
      unaided_successes INTEGER NOT NULL DEFAULT 0,
      acceptance_fingerprint TEXT NOT NULL,
      scheduler_version INTEGER NOT NULL,
      suspended INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (repertoire_id, position_key)
    )`);
    database.exec(
      "CREATE INDEX IF NOT EXISTS repertoire_progress_due_idx ON repertoire_progress(repertoire_id, suspended, due_at)"
    );
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_practice_sessions (
      id TEXT PRIMARY KEY,
      repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      snapshot_revision INTEGER NOT NULL,
      queue_json TEXT NOT NULL,
      card_state_json TEXT NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_attempts (
      attempt_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES repertoire_practice_sessions(id) ON DELETE CASCADE,
      queue_item_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('attempt', 'hint', 'reveal', 'skip')),
      uci TEXT,
      legal INTEGER NOT NULL DEFAULT 1,
      correct INTEGER NOT NULL DEFAULT 0,
      is_final_grade INTEGER NOT NULL DEFAULT 0,
      outcome TEXT,
      position_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result_json TEXT,
      at INTEGER NOT NULL,
      UNIQUE (session_id, queue_item_id, sequence)
    )`);
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS repertoire_attempts_final_idx ON repertoire_attempts(session_id, queue_item_id) WHERE is_final_grade = 1"
    );
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_workspace_state (
      repertoire_id TEXT PRIMARY KEY REFERENCES repertoires(id) ON DELETE CASCADE,
      last_chapter_id TEXT,
      last_node_id TEXT,
      orientation TEXT NOT NULL,
      practice_draft_json TEXT,
      updated_at INTEGER NOT NULL
    )`);
  },
  // 8: repertoire provenance: which game (or part of one) a chapter's material came from. Deleting
  // the library game or the chapter keeps the link (and its copied headers) with a null reference;
  // `unsaved` marks a link to a board game that was never in the library.
  // 'played' was added to the CHECK before release; a database from the earlier unreleased build
  // lacks it, and linkGame says to reset it.
  (database) => {
    database.exec(`CREATE TABLE IF NOT EXISTS repertoire_game_links (
      id TEXT PRIMARY KEY,
      repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES repertoire_chapters(id) ON DELETE SET NULL,
      game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
      unsaved INTEGER NOT NULL DEFAULT 0,
      game_node_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('source', 'model', 'played')),
      headers_json TEXT NOT NULL DEFAULT '{}',
      captured_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
    database.exec(
      "CREATE INDEX IF NOT EXISTS repertoire_game_links_repertoire_idx ON repertoire_game_links(repertoire_id)"
    );
    database.exec(
      "CREATE INDEX IF NOT EXISTS repertoire_game_links_game_idx ON repertoire_game_links(game_id)"
    );
  }
];

/** A stored game's fingerprint (null when its tree can't be read; the next save sets it). */
function storedFingerprint(row: {
  site: string | null;
  white: string | null;
  black: string | null;
  date: string | null;
  initial_fen: string | null;
  headers_json: string | null;
  move_tree_json: string | null;
}): string | null {
  try {
    if (!row.move_tree_json) return null;
    const moveTree = JSON.parse(row.move_tree_json) as MoveNode[];
    if (!Array.isArray(moveTree) || !moveTree.length) return null;
    const stored = row.headers_json ? (JSON.parse(row.headers_json) as Partial<GameHeaders> | null) : null;
    const headers = { site: row.site, white: row.white, black: row.black, date: row.date, ...(stored ?? {}) };
    const rootFen = row.initial_fen ?? moveTree.find((node) => node.parentId === null)?.fenAfter ?? "";
    return gameFingerprint({ headers, rootFen, moveTree });
  } catch {
    return null;
  }
}

export function runMigrations(database: DatabaseSync, migrations = MIGRATIONS): void {
  const { user_version: version } = database.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let index = version; index < migrations.length; index += 1) {
    database.exec("BEGIN IMMEDIATE");
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

// Repertoire queries run on this connection in the main process.
setRepertoireConnection(getDb);

export function closeDb(): void {
  db?.close();
  db = null;
}
