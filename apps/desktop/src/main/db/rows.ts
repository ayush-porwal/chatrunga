import type { SQLInputValue, StatementSync } from "node:sqlite";

/*
 * Rows typed as their query selects them. node:sqlite types every row as a record of SQL values;
 * the columns a query selects, and what they hold, are fixed by the schema the migrations create
 * (CHECK constraints included), and the repository and migration tests read each shape back. So
 * a row type is the query's contract: it is asserted here, in one place, rather than checked at
 * runtime on every read or cast at every call site.
 */

export function allRows<Row>(statement: StatementSync, ...params: SQLInputValue[]): Row[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the schema fixes each query's row shape (see above)
  return statement.all(...params) as Row[];
}

export function getRow<Row>(statement: StatementSync, ...params: SQLInputValue[]): Row | undefined {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the schema fixes each query's row shape (see above)
  return statement.get(...params) as Row | undefined;
}

/** SQLite's extended result code on a failed statement (5 in its low byte is BUSY). */
export function sqliteErrcode(error: unknown): number | undefined {
  return error instanceof Error && "errcode" in error && typeof error.errcode === "number"
    ? error.errcode
    : undefined;
}
