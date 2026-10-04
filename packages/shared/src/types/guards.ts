/**
 * Runtime checks that narrow `unknown` data (parsed JSON, IPC input, stored rows) to its type, so
 * a value is checked where it enters rather than cast.
 */

/** A plain object's fields (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is one of `values`, a literal union's list of members. */
export function isOneOf<const T extends string | number>(
  values: readonly T[],
  value: unknown
): value is T {
  return values.some((member) => member === value);
}
