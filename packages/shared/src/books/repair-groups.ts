/**
 * Repairing a chapter's illegal lines by root error (main/books/import-job.ts). Every line is
 * written in full from move 1, so one misread move on a main line ("Bb5" for "Nb5") is copied
 * into every sub-variation below it: those lines fail at the same position on the same move.
 * They are grouped (`groupBookFailures`), one representative is repaired by the model, and the
 * correction it made (`bookRepairEdits`: the moves replaced from the failing one on) is applied to
 * every other failing line that reaches the same moves (`applyBookRepairEdits`).
 */
import type { BookLineFailure } from "./merge";
import { tokenizeMovetext, type MoveToken } from "./movetext";

/** Failing lines with one root error: the same position before the failing move, the same move. */
export type BookRepairGroup = {
  /** The position and the failing move ("<fen> <san>"). */
  key: string;
  /** The failing move's index in the lines' moves. */
  ply: number;
  /** The line the model is asked to repair: a main line, else the shortest. */
  representative: BookLineFailure;
  /** Every failing line of the group, the representative included, in the order given. */
  members: BookLineFailure[];
};

const bareSan = (san: string) => san.replace(/[+#]/g, "");

/** A line's identity in its chapter (its page and place on it). */
export const bookLineId = (failure: Pick<BookLineFailure, "pageIndex" | "lineIndex">) =>
  `${failure.pageIndex}:${failure.lineIndex}`;

function groupKey(failure: BookLineFailure): string {
  const failing = tokenizeMovetext(failure.moves)[failure.ply] as MoveToken | undefined;
  return `${failure.fenBefore} ${bareSan(failing?.san ?? failure.token)}`;
}

/** Main lines first, then the shortest (fewest moves), then as given. */
function representativeOf(members: readonly BookLineFailure[]): BookLineFailure {
  const ranked = members.map((failure, order) => ({
    failure,
    rank: [failure.kind === "main" ? 0 : 1, tokenizeMovetext(failure.moves).length, order]
  }));
  ranked.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
  return ranked[0].failure;
}

/** A chapter's failures by root error, the shallowest failing move first. */
export function groupBookFailures(failures: readonly BookLineFailure[]): BookRepairGroup[] {
  const groups = new Map<string, BookLineFailure[]>();
  for (const failure of failures) {
    const key = groupKey(failure);
    const members = groups.get(key);
    if (members) members.push(failure);
    else groups.set(key, [failure]);
  }
  // Map order is first appearance, which the sort keeps among groups at the same ply.
  return [...groups]
    .map(([key, members]) => ({
      key,
      ply: members[0].ply,
      representative: representativeOf(members),
      members
    }))
    .sort((a, b) => a.ply - b.ply);
}

/**
 * One correction of a repaired line: at `at` (a move index, the same in the repaired line and in
 * a line it applies to, whose first `at` moves are `prefix`), the moves `remove` became `insert`.
 */
export type BookRepairEdit = {
  at: number;
  prefix: string[];
  remove: string[];
  insert: MoveToken[];
};

/** Longest run of moves a correction may replace, or put in their place. */
const MAX_SPAN = 6;
/** Moves that must agree after a correction for the lines to count as aligned again. */
const ALIGNED = 3;

const sameMove = (a: MoveToken, b: MoveToken) => bareSan(a.san) === bareSan(b.san);

/** Whether `original` from `i` and `repaired` from `j` agree again (or both end there). */
function realigned(
  original: readonly MoveToken[],
  repaired: readonly MoveToken[],
  i: number,
  j: number
): boolean {
  const width = Math.min(ALIGNED, original.length - i, repaired.length - j);
  if (width <= 0) return i === original.length && j === repaired.length;
  for (let k = 0; k < width; k += 1) {
    if (!sameMove(original[i + k], repaired[j + k])) return false;
  }
  return true;
}

/** The fewest moves replaced (and put in their place) after which the lines agree again. */
function smallestSpan(
  original: readonly MoveToken[],
  repaired: readonly MoveToken[],
  a: number,
  b: number
): { removed: number; inserted: number } | null {
  for (let span = 1; span <= 2 * MAX_SPAN; span += 1) {
    for (let removed = Math.min(span, MAX_SPAN); removed >= 0; removed -= 1) {
      const inserted = span - removed;
      if (inserted > MAX_SPAN || a + removed > original.length || b + inserted > repaired.length) {
        continue;
      }
      if (realigned(original, repaired, a + removed, b + inserted)) return { removed, inserted };
    }
  }
  return null;
}

/**
 * The corrections a repair made to a line that failed at move `ply`, in order; null when the
 * repair changed a move before `ply` (or none at all, or nothing reads cleanly as a substitution):
 * then nothing is applied to other lines. Corrections stop where the lines no longer realign.
 */
export function bookRepairEdits(
  originalMoves: string,
  repairedMoves: string,
  ply: number
): BookRepairEdit[] | null {
  const original = tokenizeMovetext(originalMoves);
  const repaired = tokenizeMovetext(repairedMoves);
  if (original.length < ply || repaired.length < ply) return null;
  for (let index = 0; index < ply; index += 1) {
    if (!sameMove(original[index], repaired[index])) return null;
  }
  const edits: BookRepairEdit[] = [];
  let a = ply;
  let b = ply;
  while (a < original.length && b < repaired.length) {
    if (sameMove(original[a], repaired[b])) {
      a += 1;
      b += 1;
      continue;
    }
    const span = smallestSpan(original, repaired, a, b);
    if (!span) break;
    edits.push({
      at: b,
      prefix: repaired.slice(0, b).map((token) => bareSan(token.san)),
      remove: original.slice(a, a + span.removed).map((token) => bareSan(token.san)),
      insert: repaired.slice(b, b + span.inserted)
    });
    a += span.removed;
    b += span.inserted;
  }
  // The first correction must be the failing move's.
  return edits.length && edits[0].at === ply ? edits : null;
}

/** "1. e4 e5 2. Nf3": moves from the initial position, each with its annotation symbols. */
function formatMoves(tokens: readonly MoveToken[]): string {
  return tokens
    .map((token, index) => {
      const move = `${token.san}${token.symbols ?? ""}`;
      return index % 2 === 0 ? `${index / 2 + 1}. ${move}` : move;
    })
    .join(" ");
}

/** Whether `sans` has `run` from `at` on. */
function hasAt(sans: readonly string[], at: number, run: readonly string[]): boolean {
  return run.every((san, index) => sans[at + index] === san);
}

/**
 * `moves` with the corrections that apply to it: each one whose `prefix` its moves start with and
 * whose removed moves follow (an insertion: that doesn't have the inserted moves there yet). A
 * line that already has an earlier correction (it never had the misread) still gets later ones.
 * Null when none applies.
 */
export function applyBookRepairEdits(
  moves: string,
  edits: readonly BookRepairEdit[]
): string | null {
  let tokens = tokenizeMovetext(moves);
  let applied = false;
  for (const edit of edits) {
    const sans = tokens.map((token) => bareSan(token.san));
    if (sans.length < edit.at || !hasAt(sans, 0, edit.prefix)) continue;
    const inserted = edit.insert.map((token) => bareSan(token.san));
    const needed = edit.remove.length
      ? hasAt(sans, edit.at, edit.remove)
      : !hasAt(sans, edit.at, inserted);
    if (!needed) continue;
    tokens = [
      ...tokens.slice(0, edit.at),
      ...edit.insert,
      ...tokens.slice(edit.at + edit.remove.length)
    ];
    applied = true;
  }
  return applied ? formatMoves(tokens) : null;
}
