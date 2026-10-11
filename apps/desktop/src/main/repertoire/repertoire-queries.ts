/** Repertoire reads for the renderer: summaries, chapters, decisions, game comparison, due work. */
import { createHash } from "node:crypto";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  COMPARE_GAME_MAX_PLIES,
  REPERTOIRE_POSITION_KEY_VERSION,
  REPERTOIRE_ROOT_NODE_ID,
  type CompareGameInput,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireComparison,
  type RepertoireDecision,
  type RepertoireDetail,
  type RepertoireDueSummary,
  type RepertoireNextDue,
  type RepertoireListFilters,
  type RepertoireOccurrence,
  type PractisedElsewhereInput,
  type RepertoireSummary
} from "@chaturanga/shared/types/repertoire";
import { buildChapterLookup, type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { compareGameToRepertoire } from "@chaturanga/shared/chess/repertoire-compare";
import { formatPath } from "@chaturanga/shared/chess/repertoire-pgn";
import { detail, practisedElsewhere, requireRepertoire, stripFingerprint } from "./core";
import { fenAfterMove, isValidFen } from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  positionIndexRepository,
  repertoireRepository
} from "./repository";
import { sessionRepository } from "./practice-repository";
import { clock, loadChapter } from "./service-runtime";

/** Summaries for the hub (aggregates only; no tree is loaded). */
export function listRepertoires(filters: RepertoireListFilters = {}): RepertoireSummary[] {
  return repertoireRepository.list(filters, clock());
}

export function getRepertoire(id: string): RepertoireDetail {
  return detail(id, clock());
}

/** One chapter with its tree (throws RepertoireCorruptChapterError when it is damaged). */
export function getChapter(input: { repertoireId: string; chapterId: string }): RepertoireChapter {
  return loadChapter(input.repertoireId, input.chapterId, clock());
}

/** The stored policy at one position, or null when the repertoire has none there yet. */
export function getDecision(input: {
  repertoireId: string;
  positionKey: string;
}): RepertoireDecision | null {
  requireRepertoire(input.repertoireId);
  const stored = decisionRepository.get(input.repertoireId, input.positionKey);
  return stored ? stripFingerprint(stored) : null;
}

/** The moves other chapters practise at positions of a chapter (see practisedElsewhere). */
export function getPractisedElsewhere(input: PractisedElsewhereInput): Record<string, string[]> {
  const record = requireRepertoire(input.repertoireId);
  return practisedElsewhere(record, input.chapterId, input.positionKeys);
}

/**
 * Position keys of the repertoire's paused decisions: practice leaves them out and a rehearsal
 * plays their moves as context, so Study offers a rehearsal only where something else is asked.
 */
export function getPausedKeys(id: string): string[] {
  requireRepertoire(id);
  return [...decisionRepository.pausedKeys(id)].sort();
}

/**
 * Every occurrence of a position in the repertoire (any scope state: this is for study
 * navigation, not training), with its chapter title and SAN path. Each involved chapter's tree is
 * read once per call.
 */
export function getOccurrences(input: {
  repertoireId: string;
  positionKey: string;
}): RepertoireOccurrence[] {
  requireRepertoire(input.repertoireId);
  const rows = positionIndexRepository.occurrences(input.repertoireId, input.positionKey);
  const lookups = new Map<string, ChapterLookup>();
  return rows.map((row) => {
    let lookup = lookups.get(row.chapterId);
    if (!lookup) {
      lookup = buildChapterLookup(chapterRepository.get(row.chapterId)!);
      lookups.set(row.chapterId, lookup);
    }
    const ids = lookup.parentPath.get(row.nodeId) ?? [];
    const moves = ids.slice(1).map((id) => lookup.nodesById.get(id)!);
    return { ...row, path: formatPath(moves) };
  });
}

/** Comparisons kept in memory; each entry names the revision it was computed against. */
const COMPARE_CACHE_SIZE = 32;
const compareCache = new Map<string, RepertoireComparison>();

/**
 * A finished game's mainline against one repertoire (§6.3). Archived repertoires can still be
 * compared. Every move must be legal from `rootFen`. Results are cached by repertoire, revision,
 * player colour, position-key version and game content, so any repertoire edit (a revision bump)
 * misses the cache; the 32 most recently used results are kept.
 */
export function compareGame(input: CompareGameInput): RepertoireComparison {
  const record = requireRepertoire(input.repertoireId);
  if (input.color !== record.color) {
    throw new Error(`Invalid color: this repertoire is for ${record.color}`);
  }
  if (!isValidFen(input.rootFen)) throw new Error("Invalid rootFen: not a legal position");
  if (input.moves.length > COMPARE_GAME_MAX_PLIES) {
    throw new Error(`Invalid moves: more than ${COMPARE_GAME_MAX_PLIES} plies`);
  }
  const gameHash = createHash("sha256")
    .update(`${input.rootFen}\n${input.moves.join(" ")}`)
    .digest("hex");
  const cacheKey = [
    record.id,
    record.revision,
    input.color,
    REPERTOIRE_POSITION_KEY_VERSION,
    gameHash
  ].join("|");
  const cached = compareCache.get(cacheKey);
  if (cached) {
    compareCache.delete(cacheKey);
    compareCache.set(cacheKey, cached);
    return cached;
  }

  let fen = input.rootFen;
  input.moves.forEach((uci, index) => {
    const next = fenAfterMove(fen, uci);
    if (!next) throw new Error(`Invalid moves: "${uci}" (ply ${index + 1}) is not legal`);
    fen = next;
  });

  const result = compareGameToRepertoire(
    { color: input.color, rootFen: input.rootFen, moves: input.moves },
    {
      id: record.id,
      name: record.name,
      revision: record.revision,
      chapters: chapterRepository.list(record.id).filter((chapter) => chapter.enabled),
      decisions: decisionRepository.list(record.id).map(stripFingerprint)
    }
  );
  compareCache.set(cacheKey, result);
  if (compareCache.size > COMPARE_CACHE_SIZE) {
    compareCache.delete(compareCache.keys().next().value!);
  }
  return result;
}

/**
 * Due decisions across active repertoires, the next one to review, the most recent study place,
 * and the practice session to resume (Play's Repertoire card and the hub).
 */
export function getDueSummary(): RepertoireDueSummary {
  const now = clock();
  const totals = repertoireRepository.dueTotals(now);
  const ranking = repertoireRepository.dueRanking(now, 2);
  const top = ranking.at(0);
  const second = ranking.at(1);
  const place = repertoireRepository.lastStudyPlace();
  const session = sessionRepository.lastActive();
  return {
    ...totals,
    continue: place
      ? {
          repertoireId: place.repertoireId,
          chapterId: place.chapterId,
          nodeId: place.nodeId ?? REPERTOIRE_ROOT_NODE_ID,
          repertoireName: place.repertoireName,
          color: place.color,
          chapterTitle: place.chapterTitle,
          fen:
            (place.nodeId && chapterRepository.node(place.chapterId, place.nodeId)?.fenAfter) ||
            place.rootFen
        }
      : null,
    resume: session
      ? {
          repertoireId: session.repertoireId,
          sessionId: session.id,
          mode: session.mode,
          repertoireName: session.repertoireName,
          color: session.color
        }
      : null,
    next: top ? nextDue(top, now) : null,
    alsoDue: second
      ? { repertoireId: second.id, name: second.name, dueCount: second.dueCount }
      : null
  };
}

/** The next due position of a repertoire with due decisions, and the move that reached it. */
function nextDue(
  repertoire: { id: string; name: string; color: RepertoireColor; dueCount: number },
  now: number
): RepertoireNextDue | null {
  const due = repertoireRepository.nextDue(repertoire.id, now);
  if (!due) return null;
  const node = chapterRepository.node(due.chapterId, due.nodeId);
  return {
    repertoireId: repertoire.id,
    repertoireName: repertoire.name,
    color: repertoire.color,
    dueCount: repertoire.dueCount,
    chapterId: due.chapterId,
    nodeId: due.nodeId,
    fen: node?.fenAfter ?? due.rootFen,
    lastMove: node ? moveInto(node) : null
  };
}

/** The move into a node ("3…Nf6": number 3, Black), from the position before it; null at a root. */
function moveInto(
  node: Pick<MoveNode, "san" | "uci" | "fenBefore">
): RepertoireNextDue["lastMove"] {
  if (!node.san || !node.uci) return null;
  const [, turn, , , , fullmove] = node.fenBefore.trim().split(/\s+/);
  const moveNumber = Number(fullmove);
  return {
    uci: node.uci,
    san: node.san,
    moveNumber: Number.isInteger(moveNumber) && moveNumber > 0 ? moveNumber : 1,
    color: turn === "b" ? "black" : "white"
  };
}
