/**
 * Migration 16 (docs/repertoire-games-and-practice.md §7): chapters keep their opening (name, ECO,
 * and whether the user typed it) and the revision the background detection last looked at without
 * finding one, and the positions answered for the first time each day are recorded for the daily
 * new limit. The practice settings are a `settings` row (no schema). Safe to run on a database
 * that already has them.
 */
import type { DatabaseSync } from "node:sqlite";

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return database
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .some((row) => row.name === column);
}

export function migrateRepertoirePractice(database: DatabaseSync): void {
  if (!hasColumn(database, "repertoire_chapters", "opening_name")) {
    database.exec("ALTER TABLE repertoire_chapters ADD COLUMN opening_name TEXT");
    database.exec("ALTER TABLE repertoire_chapters ADD COLUMN opening_eco TEXT");
    database.exec(
      "ALTER TABLE repertoire_chapters ADD COLUMN opening_edited INTEGER NOT NULL DEFAULT 0 CHECK (opening_edited IN (0, 1))"
    );
  }
  if (!hasColumn(database, "repertoire_chapters", "opening_checked_revision")) {
    database.exec("ALTER TABLE repertoire_chapters ADD COLUMN opening_checked_revision INTEGER");
  }
  // `day` is the local calendar day (YYYY-MM-DD) the position was first answered on.
  database.exec(`CREATE TABLE IF NOT EXISTS repertoire_new_introductions (
    day TEXT NOT NULL,
    repertoire_id TEXT NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    position_key TEXT NOT NULL,
    PRIMARY KEY (day, repertoire_id, position_key)
  )`);
}
