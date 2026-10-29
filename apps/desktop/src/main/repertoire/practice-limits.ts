/**
 * The global practice settings and the daily new limit (docs/repertoire-games-and-practice.md §4):
 * positions answered for the first time are recorded per local day, across all repertoires, and
 * new cards are queued only while today's count is under the limit.
 */
import {
  normalizeRepertoirePracticeSettings,
  type RepertoirePracticeSettings
} from "@chaturanga/shared/types/repertoire-practice";
import { queriesOn } from "../db/rows";
import { repertoireDb } from "./connection";

/** The `settings` row of the practice settings (AppSettings' `repertoirePractice`). */
const SETTINGS_KEY = "repertoirePractice";

const { get, run } = queriesOn(repertoireDb);

/** The practice settings as stored (defaults for anything missing or unreadable). */
export function practiceSettings(): RepertoirePracticeSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", SETTINGS_KEY);
  let stored: unknown = null;
  try {
    stored = row ? JSON.parse(row.value) : null;
  } catch {
    stored = null;
  }
  return normalizeRepertoirePracticeSettings(stored);
}

/** The local calendar day of `now`, "YYYY-MM-DD" (the daily limit's day). */
function localDay(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Positions answered for the first time on `now`'s local day, across all repertoires. */
export function newToday(now: number): number {
  return (
    get<{ value: number }>(
      "SELECT COUNT(*) AS value FROM repertoire_new_introductions WHERE day = ?",
      localDay(now)
    )?.value ?? 0
  );
}

/** How many more new positions may be queued today (Infinity without a limit). */
export function remainingNewToday(now: number, settings = practiceSettings()): number {
  if (settings.newPerDay === null) return Infinity;
  return Math.max(0, settings.newPerDay - newToday(now));
}

/** Records a position answered for the first time (once per day and repertoire). */
export function recordIntroduction(repertoireId: string, positionKey: string, now: number): void {
  run(
    `INSERT OR IGNORE INTO repertoire_new_introductions (day, repertoire_id, position_key)
      VALUES (?, ?, ?)`,
    localDay(now),
    repertoireId,
    positionKey
  );
}
