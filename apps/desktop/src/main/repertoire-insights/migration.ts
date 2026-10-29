import type { DatabaseSync } from "node:sqlite";
import { allRows } from "../db/rows";

/**
 * Migration 17 (docs/repertoire-games-and-practice.md §7): Insights.
 *
 * - `repertoire_game_outcomes`: one row per compared (game, repertoire) — the repertoire is null
 *   for a game without a user side or without a repertoire of its colour — stamped with what it was
 *   computed from (the game's content hash, the repertoire's revision, the algorithm version). The
 *   game's outcome is the row it followed longest. `moves_json` keeps the game's moves up to where
 *   it left the repertoire (UCI, SAN and the position key before each), so the report needs no
 *   replay; `after_book_loss` the win-% lost after leaving it, from the game's latest review.
 * - `repertoire_game_misses`: the slips in real games already applied to the schedule (§5.4).
 * - decisions gain `accepted_at`: when their current accepted set was first stored. Existing ones
 *   take their own last update time (no later than that); triggers keep it on every write
 *   afterwards, on any connection (the import writer's and backup restore's too).
 *
 * Insights filters are a `main.` row in `settings` and need no schema. Safe to run again.
 */
export function migrateRepertoireInsights(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS repertoire_game_outcomes (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    repertoire_id TEXT REFERENCES repertoires(id) ON DELETE CASCADE,
    color TEXT CHECK (color IN ('white', 'black')),
    outcome TEXT NOT NULL CHECK (outcome IN ('forgot', 'new-reply', 'ended-in-book', 'in-book',
      'not-covered', 'no-repertoire', 'no-user-side')),
    ply INTEGER,
    position_key TEXT,
    played_uci TEXT,
    expected_ucis_json TEXT NOT NULL DEFAULT '[]',
    chapter_id TEXT,
    matched_plies INTEGER NOT NULL DEFAULT 0,
    moves_json TEXT NOT NULL DEFAULT '[]',
    root_fen TEXT,
    played_at INTEGER,
    after_book_loss REAL,
    game_hash TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    algo_version INTEGER NOT NULL,
    compared_at INTEGER NOT NULL
  )`);
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS repertoire_game_outcomes_pair_idx
    ON repertoire_game_outcomes(game_id, COALESCE(repertoire_id, ''))`);
  database.exec(`CREATE INDEX IF NOT EXISTS repertoire_game_outcomes_repertoire_idx
    ON repertoire_game_outcomes(repertoire_id, position_key)`);
  database.exec(`CREATE TABLE IF NOT EXISTS repertoire_game_misses (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    position_key TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    UNIQUE (game_id, repertoire_id, position_key)
  )`);

  const columns = allRows<{ name: string }>(
    database.prepare("PRAGMA table_info(repertoire_decisions)")
  );
  if (!columns.some((column) => column.name === "accepted_at")) {
    database.exec("ALTER TABLE repertoire_decisions ADD COLUMN accepted_at INTEGER");
    database.exec("UPDATE repertoire_decisions SET accepted_at = updated_at");
  }
  // The accepted set is the effective one the fingerprint records: a new non-empty fingerprint is
  // a new accepted set. One that empties (nothing supports the choices) keeps the time.
  database.exec(`CREATE TRIGGER IF NOT EXISTS repertoire_decisions_accepted_insert
    AFTER INSERT ON repertoire_decisions
    WHEN NEW.accepted_at IS NULL AND NEW.acceptance_fingerprint != ''
    BEGIN
      UPDATE repertoire_decisions SET accepted_at = NEW.updated_at
        WHERE repertoire_id = NEW.repertoire_id AND position_key = NEW.position_key;
    END`);
  database.exec(`CREATE TRIGGER IF NOT EXISTS repertoire_decisions_accepted_update
    AFTER UPDATE OF acceptance_fingerprint ON repertoire_decisions
    WHEN NEW.acceptance_fingerprint != '' AND NEW.acceptance_fingerprint != OLD.acceptance_fingerprint
    BEGIN
      UPDATE repertoire_decisions SET accepted_at = NEW.updated_at
        WHERE repertoire_id = NEW.repertoire_id AND position_key = NEW.position_key;
    END`);
}
