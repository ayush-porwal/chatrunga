/**
 * A move's book page, kept in its comment as a PGN command: `[%page N]`, N the 1-based page of
 * the imported PDF. Like `[%cal]` it survives PGN export and import (chess/annotations.ts keeps
 * unknown commands in the comment text), so the UI strips it before showing the comment as prose
 * and links the move to the page instead.
 */

const PAGE_COMMAND = /\[%page\s+(\d{1,5})\]\s*/i;

/** The page a comment links to, or null. */
export function bookPageOf(comment: string | null | undefined): number | null {
  const match = comment ? PAGE_COMMAND.exec(comment) : null;
  return match ? Number(match[1]) : null;
}

/** The comment without its page command (null when nothing else is left). */
export function stripBookPage(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const text = comment.replace(PAGE_COMMAND, "").trim();
  return text || null;
}

/** `text` (the comment as shown) with the page command of `page` in front (none for null). */
export function withBookPage(text: string | null, page: number | null): string | null {
  const prose = stripBookPage(text);
  if (page === null) return prose;
  return prose ? `[%page ${page}] ${prose}` : `[%page ${page}]`;
}
