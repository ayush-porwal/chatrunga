import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 18 (docs/repertoire-games-and-practice.md §7): Study's explorer and the repertoire
 * health check.
 * - `game_position_games`: one row per library game the position index has read (whether it has
 *   a user side, and what the Insights filters read: account, time control, rated, played at), with the
 *   game's `updated_at` it was read at, so a changed game is read again;
 * - `game_position_moves`: the index itself, position key → move, for the first 80 plies of each
 *   game with a user side, with the user's colour and result (`win`, `draw`, `loss`, or null);
 * - `repertoire_health_flags`: the latest flags per repertoire and position, with the revision
 *   they were found against;
 * - `repertoire_health_queue`: the health check's queue (queued or running) and each
 *   repertoire's last check (done or failed).
 * Everything goes with its game or repertoire.
 */
export function migrateRepertoireExplorer(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS game_position_games (
    game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    game_updated_at INTEGER NOT NULL,
    user_color TEXT CHECK (user_color IN ('white', 'black')),
    account TEXT NOT NULL,
    time_control TEXT NOT NULL,
    rated INTEGER NOT NULL CHECK (rated IN (0, 1)),
    user_rating INTEGER,
    played_at INTEGER
  )`);
  database.exec(`CREATE TABLE IF NOT EXISTS game_position_moves (
    position_key TEXT NOT NULL,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply INTEGER NOT NULL,
    move_uci TEXT NOT NULL,
    user_color TEXT NOT NULL CHECK (user_color IN ('white', 'black')),
    result TEXT CHECK (result IN ('win', 'draw', 'loss')),
    played_at INTEGER,
    PRIMARY KEY (game_id, ply)
  )`);
  database.exec(
    "CREATE INDEX IF NOT EXISTS game_position_moves_key_idx ON game_position_moves(position_key)"
  );
  database.exec(`CREATE TABLE IF NOT EXISTS repertoire_health_flags (
    repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    position_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('engine-disagrees', 'no-answer', 'common-mistake')),
    uci TEXT NOT NULL,
    data_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    checked_at INTEGER NOT NULL,
    PRIMARY KEY (repertoire_id, position_key, kind, uci)
  )`);
  database.exec(`CREATE TABLE IF NOT EXISTS repertoire_health_queue (
    repertoire_id TEXT PRIMARY KEY REFERENCES repertoires(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    queue_order INTEGER NOT NULL DEFAULT 0,
    enqueued_at INTEGER,
    checked_revision INTEGER,
    checked_at INTEGER,
    error TEXT
  )`);
}
