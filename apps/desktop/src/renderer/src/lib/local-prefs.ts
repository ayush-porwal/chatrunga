/**
 * Choices remembered on this machine (localStorage), for screen layout and reading choices that
 * stay out of the app settings. Reads and writes never throw: a missing, blocked or full storage
 * reads as nothing stored, and a choice that can't be written still applies for this session.
 */

function storage(): Storage | null {
  // Storage access throws where it is blocked (a sandboxed or opaque origin); outside a browser
  // (Node) there is none.
  try {
    return "localStorage" in globalThis ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/** The value stored under `key`; null when there is none or storage can't be read. */
export function readLocalPref(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores `value` under `key`; null removes it. */
export function writeLocalPref(key: string, value: string | null): void {
  try {
    const store = storage();
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Full or blocked storage: the choice still applies for this session.
  }
}
