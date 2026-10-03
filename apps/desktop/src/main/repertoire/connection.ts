/**
 * The SQLite connection the repertoire repository uses. The main process registers its shared
 * connection (db/index.ts); the import writer worker registers its own, so the same repository
 * and reindex code runs in either thread without importing Electron.
 */
import type { DatabaseSync } from "node:sqlite";

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
