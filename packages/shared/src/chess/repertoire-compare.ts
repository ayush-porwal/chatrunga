/**
 * Game review: repertoire comparison (design §6.3). Replays a finished game's mainline against one
 * repertoire's derived index and reports the earliest actionable difference. Pure and bounded by
 * the game's finite mainline: every chapter tree is indexed once and index links are never
 * followed recursively.
 */
import { makeSanAndPlay } from "chessops/san";
import { makeFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import type {
  ComparisonIssue,
  ComparisonMove,
  ComparisonMoveStatus,
  RepertoireColor,
  RepertoireComparison,
  RepertoireDecision
} from "../types/repertoire";
import { rootPly } from "./pgn";
import { positionFromFen } from "./position";
import { standardCastlingUci } from "./review";
import {
  buildChapterLookup,
  collectDecisions,
  computeScopeStates,
  effectiveAcceptedUcis,
  effectivePreferredUci,
  nodeMetaOf,
  type ChapterLookup,
  type RepertoireChapterContent,
  type ScopeState
} from "./repertoire-index";
import { playerToMove, positionKey } from "./repertoire-position";

/** The game side of a comparison: the player's colour and the mainline as UCI from `rootFen`. */
export type ComparedGame = {
  color: RepertoireColor;
  rootFen: string;
  moves: readonly string[];
};

/** The repertoire side of a comparison: its chapters (with titles) and stored decisions. */
export type ComparedRepertoire = {
  id: string;
  name: string;
  revision: number;
  chapters: readonly (RepertoireChapterContent & { title: string })[];
  decisions: readonly RepertoireDecision[];
};

type Occurrence = {
  chapterId: string;
  title: string;
  nodeId: string;
  ply: number;
  chapterOrder: number;
  lookup: ChapterLookup;
  states: Map<string, ScopeState>;
  nodeMeta: RepertoireChapterContent["nodeMeta"];
};

type ReplayedMove = { uci: string; san: string; fenAfter: string };

/** Plays one UCI move; null when it is malformed or illegal in `fen`. */
function replay(fen: string, uci: string): ReplayedMove | null {
  const position = positionFromFen(fen);
  const move = parseUci(standardCastlingUci(fen, uci));
  if (!move || !position.isLegal(move)) return null;
  const normalized = standardCastlingUci(fen, makeUci(move));
  const san = makeSanAndPlay(position, move);
  return { uci: normalized, san, fenAfter: makeFen(position.toSetup()) };
}

function sanOf(fen: string, uci: string): string {
  return replay(fen, uci)?.san ?? uci;
}

/**
 * Indexes the `active` occurrences (the coached scope) of enabled opening chapters by position
 * key. Positions before a training start or after a stop are context only, and reference chapters,
 * reference edges and disabled nodes never count as coverage. Each list is ordered shallowest
 * first, then by chapter order, then authored order.
 */
function indexActiveOccurrences(chapters: ComparedRepertoire["chapters"]) {
  const active = new Map<string, Occurrence[]>();
  const ordered = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  ordered.forEach((chapter, chapterOrder) => {
    if (!chapter.enabled || chapter.kind !== "opening") return;
    const lookup = buildChapterLookup(chapter);
    const states = computeScopeStates(chapter, lookup);
    for (const nodeId of lookup.order) {
      if (states.get(nodeId) !== "active") continue;
      const key = lookup.positionKeys.get(nodeId)!;
      const occurrence: Occurrence = {
        chapterId: chapter.id,
        title: chapter.title,
        nodeId,
        ply: lookup.nodesById.get(nodeId)!.ply,
        chapterOrder,
        lookup,
        states,
        nodeMeta: chapter.nodeMeta
      };
      const list = active.get(key);
      if (list) list.push(occurrence);
      else active.set(key, [occurrence]);
    }
  });
  for (const list of active.values()) {
    // Stable: equal plies keep chapter order, then authored order.
    list.sort((a, b) => a.ply - b.ply || a.chapterOrder - b.chapterOrder);
  }
  return active;
}

/** Active children of an occurrence that play `uci` (castling compared in standard form). */
function activeChild(occurrence: Occurrence, uci: string, edge: "included" | "covered") {
  for (const childId of occurrence.lookup.childrenById.get(occurrence.nodeId) ?? []) {
    const child = occurrence.lookup.nodesById.get(childId)!;
    if (!child.uci || occurrence.states.get(childId) !== "active") continue;
    if (standardCastlingUci(child.fenBefore, child.uci) !== uci) continue;
    const kind = nodeMetaOf(occurrence.nodeMeta, childId).edge;
    // Opponent replies count as covered unless they are reference-only (an edge without metadata
    // defaults to `included`, which the study panel also shows as covered on the opponent's turn).
    if (edge === "included" ? kind !== "included" : kind === "reference") continue;
    return child;
  }
  return null;
}

/** Covered opponent replies at a position, across its active occurrences, in first-seen order. */
function coveredReplies(occurrences: readonly Occurrence[]): string[] {
  const replies: string[] = [];
  for (const occurrence of occurrences) {
    for (const childId of occurrence.lookup.childrenById.get(occurrence.nodeId) ?? []) {
      const child = occurrence.lookup.nodesById.get(childId)!;
      if (!child.uci || occurrence.states.get(childId) !== "active") continue;
      if (nodeMetaOf(occurrence.nodeMeta, childId).edge === "reference") continue;
      const uci = standardCastlingUci(child.fenBefore, child.uci);
      if (!replies.includes(uci)) replies.push(uci);
    }
  }
  return replies;
}

/**
 * Whether an occurrence plans something after its position: an active included move on the
 * player's turn, or an active non-reference reply on the opponent's turn.
 */
function hasContinuation(occurrence: Occurrence, playerTurn: boolean): boolean {
  for (const childId of occurrence.lookup.childrenById.get(occurrence.nodeId) ?? []) {
    if (!occurrence.lookup.nodesById.get(childId)!.uci) continue;
    if (occurrence.states.get(childId) !== "active") continue;
    const kind = nodeMetaOf(occurrence.nodeMeta, childId).edge;
    if (playerTurn ? kind === "included" : kind !== "reference") return true;
  }
  return false;
}

type OccurrenceRef = { chapterId: string; nodeId: string };

/**
 * The occurrences of one position, best anchor first: those with active continuations, then the
 * one the game is already following, then the shallowest (the index order).
 */
function rankOccurrences(
  occurrences: readonly Occurrence[],
  current: OccurrenceRef | null,
  playerTurn: boolean
): Occurrence[] {
  const score = (item: Occurrence) =>
    (hasContinuation(item, playerTurn) ? 0 : 2) +
    (item.chapterId === current?.chapterId && item.nodeId === current.nodeId ? 0 : 1);
  // Stable: equal scores keep the index order (shallowest first).
  return [...occurrences].sort((a, b) => score(a) - score(b));
}

/**
 * Compares a game's mainline with a repertoire (§6.3):
 * - positions before any active occurrence are `outside-scope` (a custom-root chapter may apply
 *   later);
 * - at a recognized player decision the played move must be in the repertoire-wide effective
 *   accepted set (stored choices ∩ supported occurrences), else it is the `player-deviation`;
 * - at a recognized opponent position the reply must be a covered active edge of some occurrence
 *   or land on an active position (a transposition into prepared material), else it is the
 *   `uncovered-opponent` gap;
 * - a recognized position with nothing planned after it (an authored stop or a leaf) is where
 *   preparation ends; the walk goes on (moves stay `after-end` until a position is recognized
 *   again) and `preparation-ends` is the issue only when no deviation or gap follows;
 * - after the first deviation or gap, later recognized positions are `transposed-back` context;
 * - nothing recognized at all is `no-applicable-chapter`.
 * When several occurrences recognize a position, the anchor is one with active continuations,
 * then the one the game is following, then the shallowest; a matched move is credited to the
 * occurrence that supplied it. Whose move it is comes from each position, never from ply parity.
 * The walk stops at the first illegal move (the caller validated the game; such moves are left
 * out of `moves`).
 */
export function compareGameToRepertoire(
  game: ComparedGame,
  repertoire: ComparedRepertoire
): RepertoireComparison {
  const { color } = game;
  const active = indexActiveOccurrences(repertoire.chapters);
  const collected = collectDecisions(color, repertoire.chapters);
  const stored = new Map(repertoire.decisions.map((decision) => [decision.positionKey, decision]));
  const titles = new Map(repertoire.chapters.map((chapter) => [chapter.id, chapter.title]));

  const moves: ComparisonMove[] = [];
  const returnedByTransposition: RepertoireComparison["returnedByTransposition"] = [];
  const returnedKeys = new Set<string>();
  const chaptersUsed: RepertoireComparison["chaptersUsed"] = [];
  const noteChapterUsed = (chapterId: string) => {
    if (!chaptersUsed.some((item) => item.chapterId === chapterId)) {
      chaptersUsed.push({ chapterId, title: titles.get(chapterId) ?? "" });
    }
  };
  /** The active occurrences of a position, best anchor first (see `rankOccurrences`). */
  const rankedAt = (positionFen: string, current: OccurrenceRef | null) =>
    rankOccurrences(
      active.get(positionKey(positionFen)) ?? [],
      current,
      playerToMove(positionFen) === color
    );

  /** The first deviation or gap; once set, the comparison only notes returns. */
  let issue: ComparisonIssue | null = null;
  /** Where preparation first ended; the issue only when nothing actionable follows. */
  let end: ComparisonIssue | null = null;
  let matchedAtEnd = 0;
  let matchedAny = false;
  let matchedPlies = 0;
  /** The occurrence the game is following (its chapter continues when it can). */
  let current: OccurrenceRef | null = null;
  /** The previous move was already transposed back (one entry per return, not per ply). */
  let returning = false;

  let fen = game.rootFen;
  let key = positionKey(fen);
  const firstPly = rootPly(game.rootFen) + 1;

  for (let index = 0; index < game.moves.length; index++) {
    const played = replay(fen, game.moves[index]);
    if (!played) break;
    const ply = firstPly + index;
    const fenAfter = played.fenAfter;
    const ranked = rankedAt(fen, current);
    const anchor = ranked[0] ?? null;
    /** The occurrence the move is credited to. */
    let credited: OccurrenceRef | null = anchor;
    let status: ComparisonMoveStatus;
    let next: OccurrenceRef | null = null;

    const issueAt = (
      kind: ComparisonIssue["status"],
      expectedUcis: string[],
      preferredUci: string | null
    ): ComparisonIssue => ({
      status: kind,
      ply,
      fenBefore: fen,
      positionKey: key,
      playedUci: played.uci,
      playedSan: played.san,
      expectedUcis,
      expectedSans: expectedUcis.map((uci) => sanOf(fen, uci)),
      preferredUci,
      chapterId: anchor?.chapterId ?? null,
      chapterTitle: anchor?.title ?? null,
      nodeId: anchor?.nodeId ?? null
    });
    const endHere = () => {
      if (end) return;
      end = issueAt("preparation-ends", [], null);
      matchedAtEnd = matchedPlies;
    };

    if (issue) {
      if (anchor) {
        status = "transposed-back";
        if (!returning && !returnedKeys.has(key)) {
          returnedKeys.add(key);
          returnedByTransposition.push({
            ply,
            chapterId: anchor.chapterId,
            chapterTitle: anchor.title,
            nodeId: anchor.nodeId
          });
        }
      } else {
        status = "outside-scope";
      }
    } else if (!anchor) {
      if (end) {
        status = "after-end";
      } else if (!matchedAny) {
        status = "outside-scope";
      } else {
        // Defensive: a matched move always reaches an active position (its supporting child is
        // active), so the route ended here (it continues only as context, or not at all).
        status = "after-end";
        endHere();
      }
    } else {
      matchedAny = true;
      if (playerToMove(fen) === color) {
        const entry = collected.get(key);
        const supported = entry?.acceptedUcis ?? new Set<string>();
        const decision = stored.get(key);
        const accepted = (
          decision ? effectiveAcceptedUcis(decision, supported) : [...supported]
        ).map((uci) => standardCastlingUci(fen, uci));
        if (!accepted.length) {
          status = "after-end";
          endHere();
        } else if (accepted.includes(played.uci)) {
          status = "player-choice";
          matchedPlies += 1;
          for (const occurrence of ranked) {
            const child = activeChild(occurrence, played.uci, "included");
            if (child) {
              credited = occurrence;
              next = { chapterId: occurrence.chapterId, nodeId: child.id };
              break;
            }
          }
        } else {
          status = "deviation";
          const preferred = decision
            ? effectivePreferredUci(decision, supported)
            : (accepted[0] ?? null);
          issue = issueAt(
            "player-deviation",
            accepted,
            preferred ? standardCastlingUci(fen, preferred) : null
          );
        }
      } else {
        let supplied = false;
        for (const occurrence of ranked) {
          const child = activeChild(occurrence, played.uci, "covered");
          if (child) {
            supplied = true;
            credited = occurrence;
            next = { chapterId: occurrence.chapterId, nodeId: child.id };
            break;
          }
        }
        // A reply that isn't a covered edge here still lands in prepared material when its
        // position has an active occurrence (a transposition); credit the one it lands on.
        const landing = supplied ? null : (rankedAt(fenAfter, null)[0] ?? null);
        if (supplied || landing) {
          status = "covered-reply";
          matchedPlies += 1;
          if (landing) {
            credited = landing;
            next = { chapterId: landing.chapterId, nodeId: landing.nodeId };
          }
        } else {
          const replies = coveredReplies(ranked);
          if (!replies.length) {
            status = "after-end";
            endHere();
          } else {
            status = "uncovered";
            issue = issueAt("uncovered-opponent", replies, null);
          }
        }
      }
      if (credited) noteChapterUsed(credited.chapterId);
    }

    moves.push({
      ply,
      san: played.san,
      uci: played.uci,
      fenBefore: fen,
      fenAfter,
      positionKey: key,
      status,
      chapterId: credited?.chapterId ?? null,
      nodeId: credited?.nodeId ?? null
    });
    returning = status === "transposed-back";
    current = next;
    fen = fenAfter;
    key = positionKey(fen);
  }

  if (!issue && end) {
    issue = end;
    matchedPlies = matchedAtEnd;
  }
  if (!issue && !matchedAny) {
    // A game that ends exactly where a chapter begins has nothing judged yet, but it applies.
    const final = rankedAt(fen, null)[0];
    if (final) {
      noteChapterUsed(final.chapterId);
    } else {
      const first = moves[0];
      issue = {
        status: "no-applicable-chapter",
        ply: firstPly,
        fenBefore: game.rootFen,
        positionKey: first?.positionKey ?? positionKey(game.rootFen),
        playedUci: first?.uci ?? null,
        playedSan: first?.san ?? null,
        expectedUcis: [],
        expectedSans: [],
        preferredUci: null,
        chapterId: null,
        chapterTitle: null,
        nodeId: null
      };
    }
  }

  return {
    repertoireId: repertoire.id,
    repertoireName: repertoire.name,
    color,
    revision: repertoire.revision,
    moves,
    matchedPlies,
    issue,
    returnedByTransposition,
    chaptersUsed
  };
}
