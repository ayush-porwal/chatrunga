/**
 * The SQLite connection the repertoire repository uses. The main process registers its shared
 * connection (db/index.ts); the import writer and backup restore workers open their own
 * (withOwnConnection), so the same repository and reindex code runs in any thread without
 * importing Electron.
 */
import { DatabaseSync } from "node:sqlite";

let resolveConnection: (() => DatabaseSync) | null = null;

/** Sets where repertoire queries run (once per thread). */
export function setRepertoireConnection(resolve: () => DatabaseSync): void {
  resolveConnection = resolve;
}

/** The connection repertoire queries run on; throws when none was registered. */
export function repertoireDb(): DatabaseSync {
  if (!resolveConnection) throw new Error("The repertoire database isn't open.");
  return resolveConnection();
}

/**
 * Runs `work` on a connection of this thread's own to the database at `dbPath` (a worker's), then
 * closes it. WAL like the main connection, with foreign keys on; a worker may wait up to 5 s for
 * the write lock (it blocks only itself), and a larger page cache shortens its write transaction,
 * so the lock other connections wait on is held for less time.
 */
export function withOwnConnection<T>(dbPath: string, work: () => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA cache_size = -65536");
    setRepertoireConnection(() => db);
    return work();
  } finally {
    db.close();
  }
}
