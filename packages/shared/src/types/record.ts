/**
 * An empty record with no prototype, so keys read from stored or imported data ("__proto__",
 * "constructor") are plain keys rather than Object.prototype's.
 */
export function nullPrototypeRecord<T>(): Record<string, T> {
  const record: Record<string, T> = {};
  Object.setPrototypeOf(record, null);
  return record;
}
