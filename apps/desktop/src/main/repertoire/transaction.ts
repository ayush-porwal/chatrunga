/**
 * Transactions on the repertoire connection (design §11): a write takes the write lock up front,
 * a read never takes it, and a busy database becomes an actionable error.
 */
import { rollbackIfOpen, sqliteErrcode } from "../db/rows";
import { repertoireDb } from "./connection";

/** How a transaction locks: reads never take the write lock; writes take it up front. */
type TransactionMode = "read" | "write";

/** The message a busy database gives the user (the write lock stayed held past the timeout). */
const REPERTOIRE_BUSY_MESSAGE = "The repertoire database is busy; try again.";

/** True for SQLite's BUSY error (any extended code), as node:sqlite reports it. */
function isBusyError(error: unknown): boolean {
  const code = sqliteErrcode(error);
  return code !== undefined && (code & 0xff) === 5;
}

/** The actionable busy error for a BUSY failure; any other error unchanged. */
export function actionableBusyError(error: unknown): unknown {
  return isBusyError(error) ? new Error(REPERTOIRE_BUSY_MESSAGE, { cause: error }) : error;
}

/**
 * Runs `work` in one transaction (joins an open one), rolling back on any error. A write takes the
 * write lock up front (IMMEDIATE), so it never fails mid-way on a lock held by the import writer;
 * on the main thread every write already waits its turn at the service's write gate, so the short
 * busy timeout is only a safety net. A read uses a plain deferred BEGIN: in WAL mode it sees one
 * consistent snapshot without ever taking the write lock, so it never waits for a writer. A BUSY
 * failure becomes the actionable busy error.
 */
export function transaction<T>(work: () => T, mode: TransactionMode = "write"): T {
  const db = repertoireDb();
  if (db.isTransaction) return work();
  try {
    db.exec(mode === "write" ? "BEGIN IMMEDIATE" : "BEGIN");
  } catch (error) {
    throw actionableBusyError(error);
  }
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackIfOpen(db);
    throw actionableBusyError(error);
  }
}
