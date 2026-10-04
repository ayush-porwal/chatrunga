/**
 * Reads JSON this app wrote itself (database columns, its own files in userData) as the type it
 * was written with. This is not validation: where an older build or a damaged file could hold
 * something else, the caller checks the fields it relies on, and catches the SyntaxError of
 * unreadable text. Data from outside the app (IPC, network, imported files) is validated instead.
 */
export function parseStoredJson<T>(text: string): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by this app as T (see above)
  return JSON.parse(text) as T;
}
