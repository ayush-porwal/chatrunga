/**
 * Derived practice standing (docs/repertoire-games-and-practice.md §4): Learning and Mastered are
 * read from the stored schedule, never stored; a line is perfect when every practised decision on
 * it is learned. Also a chapter's opening, found along its mainline in the bundled book. Pure.
 */
import type { MoveNode } from "../types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireProgress
} from "../types/repertoire";
import type { BookOpening } from "../types/repertoire-practice";
import { openingAt, type OpeningBook } from "./opening-book";
import { fenAfterUci } from "./position";
import { enumerateLines, rehearsalContext } from "./repertoire-rehearsal";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** A decision whose next review is this far after its last attempt is mastered. */
export const MASTERED_INTERVAL_MS = 21 * DAY_MS;

export type Mastery = "new" | "learning" | "mastered";

/** The schedule fields mastery reads. */
type Schedule = Pick<RepertoireProgress, "stage" | "dueAt" | "lastAttemptAt">;

/**
 * New: never attempted. Mastered: the next review is 21 or more days after the last attempt.
 * Learning: anything else attempted (including a miss due again within minutes).
 */
export function masteryOf(progress: Schedule | null | undefined): Mastery {
  if (!progress || progress.lastAttemptAt === null) return "new";
  if (progress.dueAt !== null && progress.dueAt - progress.lastAttemptAt >= MASTERED_INTERVAL_MS) {
    return "mastered";
  }
  return "learning";
}

/** Learned: answered right unaided at least once since the last miss (stage ≥ 1). */
export function isLearned(progress: Pick<RepertoireProgress, "stage"> | null | undefined): boolean {
  return (progress?.stage ?? 0) >= 1;
}

/** Deepest rehearsal depth the lines follow (the practice limit, in plies). */
const LINE_DEPTH_PLIES = 512;

/**
 * A repertoire's lines for Perfect lines: from a chapter's training start to an authored stop or
 * leaf in its enabled opening chapters (the rehearsal's lines), each as the sorted position keys
 * of the decisions it practises, deduplicated by those positions. Paused decisions aren't asked.
 */
export function practiceLines(
  chapters: readonly Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">[],
  color: RepertoireColor,
  paused: ReadonlySet<string> = new Set()
): string[][] {
  const lines = new Map<string, string[]>();
  for (const chapter of chapters) {
    if (chapter.kind !== "opening" || !chapter.enabled) continue;
    const context = rehearsalContext(chapter, color, { maxDepthPlies: LINE_DEPTH_PLIES, paused });
    for (const line of enumerateLines(context, REPERTOIRE_ROOT_NODE_ID)) {
      const keys = [
        ...new Set(line.decisionNodeIds.map((id) => context.lookup.positionKeys.get(id) ?? id))
      ].sort();
      const id = keys.join("\n");
      if (!lines.has(id)) lines.set(id, keys);
    }
  }
  return [...lines.values()];
}

/** Lines whose every practised decision is learned (a miss sends one back to stage 0). */
export function perfectLineCount(
  lines: readonly (readonly string[])[],
  learned: (positionKey: string) => boolean
): number {
  return lines.filter((keys) => keys.every(learned)).length;
}

/**
 * The opening of a line: its deepest position the book names (the start included), or null.
 * `fens` are the positions along it, the start first.
 */
export function deepestOpening(book: OpeningBook, fens: readonly string[]): BookOpening | null {
  for (let index = fens.length - 1; index >= 0; index -= 1) {
    const named = openingAt(book, fens[index]);
    if (named) return { name: named.name, eco: named.eco };
  }
  return null;
}

/** The positions along a chapter's mainline (each node's first child), the root first. */
export function mainlineFens(tree: readonly MoveNode[], rootFen: string): string[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const fens = [rootFen];
  let node = byId.get(REPERTOIRE_ROOT_NODE_ID);
  const visited = new Set<string>();
  while (node?.children.length && !visited.has(node.id)) {
    visited.add(node.id);
    node = byId.get(node.children[0]);
    if (node) fens.push(node.fenAfter);
  }
  return fens;
}

/** The positions after each of `moves` (UCI) from `rootFen`, the start first; stops at an illegal one. */
export function lineFens(rootFen: string, moves: readonly string[]): string[] {
  const fens = [rootFen];
  for (const uci of moves) {
    const next = fenAfterUci(fens[fens.length - 1], uci);
    if (!next) break;
    fens.push(next);
  }
  return fens;
}
