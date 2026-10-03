import type { ImportProgressEvent } from "@chaturanga/shared/types/repertoire";

/**
 * Progress of the PGN import preview the dialog is running (design §10 step 1, §11). The dialog
 * generates the preview's jobId itself and passes it to `repertoires.previewImport`, so progress
 * events and `cancelImport` are matched by that id from the first moment, including a Cancel
 * pressed before any event arrived.
 */
export type PreviewRun = {
  jobId: string;
  /** The latest event of the job. */
  latest: ImportProgressEvent | null;
};

/** What one progress event means for the running preview. */
export type PreviewRunStep =
  /** Another job's event. */
  | { kind: "ignore" }
  /** New progress to show. */
  | { kind: "update"; run: PreviewRun }
  /** The job was cancelled: back to the input. */
  | { kind: "cancelled" }
  /** The job failed: show the error inline. */
  | { kind: "failed"; error: string };

/** A preview that has just been started with `jobId`. */
export function startPreviewRun(jobId: string): PreviewRun {
  return { jobId, latest: null };
}

/** Applies one `repertoires:importProgress` event to the running preview. */
export function stepPreviewRun(run: PreviewRun, event: ImportProgressEvent): PreviewRunStep {
  if (event.jobId !== run.jobId) return { kind: "ignore" };
  if (event.phase === "cancelled") return { kind: "cancelled" };
  if (event.phase === "failed") {
    return { kind: "failed", error: event.error || "That PGN couldn't be read." };
  }
  return { kind: "update", run: { ...run, latest: event } };
}

const PHASE_LABELS: Record<ImportProgressEvent["phase"], string> = {
  reading: "Reading the PGN…",
  parsing: "Reading games…",
  validating: "Checking the games…",
  ready: "Preparing the preview…",
  cancelled: "Cancelled",
  failed: "Couldn't read the PGN"
};

/** The phase in words; before the first event, the preview is starting. */
export function progressPhaseLabel(event: ImportProgressEvent | null): string {
  return event ? PHASE_LABELS[event.phase] : "Starting…";
}

/** `"12 games · 3,400 moves"` so far. */
export function progressCounts(event: ImportProgressEvent | null): string {
  if (!event) return "";
  const count = (value: number, noun: string) =>
    `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
  return `${count(event.gamesSeen, "game")} · ${count(event.nodesSeen, "move")}`;
}

/** Percent of the input read (0–100), or null when the size isn't known (indeterminate bar). */
export function progressPercent(event: ImportProgressEvent | null): number | null {
  if (!event || !event.totalBytes || event.totalBytes <= 0) return null;
  if (event.phase === "validating" || event.phase === "ready") return 100;
  return Math.max(0, Math.min(100, (event.bytesRead / event.totalBytes) * 100));
}

/** Largest PGN one import reads, in UTF-8 bytes (the main process enforces the same limit). */
export const MAX_IMPORT_PGN_BYTES = 20 * 1024 * 1024;

/**
 * The size-limit message for PGN text over `maxBytes`, or null when it fits. Checked before the
 * text is sent, so an oversized paste or file is refused before any parsing (design §11).
 */
export function pgnSizeError(text: string, maxBytes = MAX_IMPORT_PGN_BYTES): string | null {
  // UTF-8 needs at least one byte per UTF-16 unit and at most three, so most texts skip encoding.
  const tooLarge =
    text.length > maxBytes ||
    (text.length * 3 > maxBytes && new TextEncoder().encode(text).length > maxBytes);
  if (!tooLarge) return null;
  const mib = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return `This PGN is larger than ${mib} MiB; split it and import it in parts.`;
}
