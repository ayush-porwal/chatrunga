/** Thrown/rejected when a debounced autosave raced a delete — must not resurrect the SQLite row. */
export const SAVE_SUPPRESSED_AFTER_DELETE = "SAVE_SUPPRESSED_AFTER_DELETE";
