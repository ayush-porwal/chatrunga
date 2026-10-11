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
  type CollectedDecision,
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

/** The repertoire as the comparison reads it. */
type PreparedRepertoire = {
  color: RepertoireColor;
  /** Active occurrences by position key (see `indexActiveOccurrences`). */
  active: Map<string, Occurrence[]>;
  /** The supported choices at each player decision. */
  collected: Map<string, CollectedDecision>;
  /** Stored decisions by position key. */
  stored: Map<string, RepertoireDecision>;
  titles: Map<string, string>;
};

/** The active occurrences of a position, best anchor first (see `rankOccurrences`). */
function rankedAt(
  prepared: PreparedRepertoire,
  fen: string,
  current: OccurrenceRef | null
): Occurrence[] {
  return rankOccurrences(
    prepared.active.get(positionKey(fen)) ?? [],
    current,
    playerToMove(fen) === prepared.color
  );
}

/** One move of the game, with the position it was played from. */
type Step = {
  ply: number;
  fen: string;
  key: string;
  played: ReplayedMove;
  /** The position's active occurrences, best anchor first. */
  ranked: Occurrence[];
  anchor: Occurrence | null;
};

/** How the comparison judges one move. */
type Judgement = {
  status: ComparisonMoveStatus;
  /** The occurrence the move is credited to. */
  credited: OccurrenceRef | null;
  /** The occurrence the game follows after the move (null: none). */
  next: OccurrenceRef | null;
  /** The move matched the repertoire (it counts toward `matchedPlies`). */
  matched: boolean;
  /** The deviation or gap the move is (null: none). */
  issue: ComparisonIssue | null;
};

function issueAt(
  { ply, fen, key, played, anchor }: Step,
  kind: ComparisonIssue["status"],
  expectedUcis: string[],
  preferredUci: string | null
): ComparisonIssue {
  return {
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
  };
}

/** A move that isn't judged against the repertoire: credited to the anchor, matching nothing. */
function unjudged(status: ComparisonMoveStatus, anchor: Occurrence | null): Judgement {
  return { status, credited: anchor, next: null, matched: false, issue: null };
}

/** The first occurrence with an active `edge` child playing `uci`, and that child as `next`. */
function supplierOf(
  ranked: readonly Occurrence[],
  uci: string,
  edge: "included" | "covered"
): Pick<Judgement, "credited" | "next"> | null {
  for (const occurrence of ranked) {
    const child = activeChild(occurrence, uci, edge);
    if (child) {
      return { credited: occurrence, next: { chapterId: occurrence.chapterId, nodeId: child.id } };
    }
  }
  return null;
}

/** A move at a recognized position, the player's or the opponent's by whose turn it is. */
function judgeRecognized(prepared: PreparedRepertoire, step: Step): Judgement {
  return playerToMove(step.fen) === prepared.color
    ? judgePlayerMove(prepared, step)
    : judgeOpponentMove(prepared, step);
}

/** The player's move must be one of the effective accepted choices. */
function judgePlayerMove(prepared: PreparedRepertoire, step: Step): Judgement {
  const { fen, key, played, ranked, anchor } = step;
  const supported = prepared.collected.get(key)?.acceptedUcis ?? new Set<string>();
  const decision = prepared.stored.get(key);
  const accepted = (decision ? effectiveAcceptedUcis(decision, supported) : [...supported]).map(
    (uci) => standardCastlingUci(fen, uci)
  );
  if (!accepted.length) return unjudged("after-end", anchor);
  if (accepted.includes(played.uci)) {
    return {
      status: "player-choice",
      credited: anchor,
      next: null,
      ...supplierOf(ranked, played.uci, "included"),
      matched: true,
      issue: null
    };
  }
  const preferred = decision
    ? effectivePreferredUci(decision, supported)
    : (accepted.at(0) ?? null);
  return {
    ...unjudged("deviation", anchor),
    issue: issueAt(
      step,
      "player-deviation",
      accepted,
      preferred ? standardCastlingUci(fen, preferred) : null
    )
  };
}

/** The opponent's reply must be a covered edge, or land in prepared material. */
function judgeOpponentMove(prepared: PreparedRepertoire, step: Step): Judgement {
  const { played, ranked, anchor } = step;
  const supplier = supplierOf(ranked, played.uci, "covered");
  if (supplier) return { status: "covered-reply", ...supplier, matched: true, issue: null };
  // A reply that isn't a covered edge here still lands in prepared material when its position
  // has an active occurrence (a transposition); credit the one it lands on.
  const landing = rankedAt(prepared, played.fenAfter, null).at(0);
  if (landing) {
    return {
      status: "covered-reply",
      credited: landing,
      next: { chapterId: landing.chapterId, nodeId: landing.nodeId },
      matched: true,
      issue: null
    };
  }
  const replies = coveredReplies(ranked);
  if (!replies.length) return unjudged("after-end", anchor);
  return {
    ...unjudged("uncovered", anchor),
    issue: issueAt(step, "uncovered-opponent", replies, null)
  };
}

/** The issue of a game no chapter applies to: at its first move, or its start when it has none. */
function noApplicableChapter(
  game: ComparedGame,
  moves: readonly ComparisonMove[],
  firstPly: number
): ComparisonIssue {
  const first = moves.at(0);
  return {
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

/** What the comparison has found so far, as it walks the game. */
type Walk = {
  /** The first deviation or gap; once set, the comparison only notes returns. */
  issue: ComparisonIssue | null;
  /** Where preparation first ended; the issue only when nothing actionable follows. */
  end: ComparisonIssue | null;
  matchedAtEnd: number;
  matchedAny: boolean;
  matchedPlies: number;
  /** The occurrence the game is following (its chapter continues when it can). */
  current: OccurrenceRef | null;
  /** The previous move was already transposed back (one entry per return, not per ply). */
  returning: boolean;
  /** Returns by transposition, by position key (a position counts once). */
  returned: Map<string, RepertoireComparison["returnedByTransposition"][number]>;
  chaptersUsed: RepertoireComparison["chaptersUsed"];
};

function noteChapterUsed(prepared: PreparedRepertoire, walk: Walk, chapterId: string): void {
  if (!walk.chaptersUsed.some((item) => item.chapterId === chapterId)) {
    walk.chaptersUsed.push({ chapterId, title: prepared.titles.get(chapterId) ?? "" });
  }
}

/** Judges one move, updates the walk, and returns the move as the comparison lists it. */
function advance(prepared: PreparedRepertoire, walk: Walk, step: Step): ComparisonMove {
  const judged = judgeInWalk(prepared, walk, step);
  if (judged.matched) walk.matchedPlies += 1;
  if (judged.issue) walk.issue = judged.issue;
  // The first move past the prepared route marks where preparation ended.
  if (judged.status === "after-end" && !walk.end) {
    walk.end = issueAt(step, "preparation-ends", [], null);
    walk.matchedAtEnd = walk.matchedPlies;
  }
  walk.returning = judged.status === "transposed-back";
  walk.current = judged.next;
  return {
    ply: step.ply,
    san: step.played.san,
    uci: step.played.uci,
    fenBefore: step.fen,
    fenAfter: step.played.fenAfter,
    positionKey: step.key,
    status: judged.status,
    chapterId: judged.credited?.chapterId ?? null,
    nodeId: judged.credited?.nodeId ?? null
  };
}

/**
 * A move after the issue only notes returns to prepared positions; one at a recognized position
 * is judged against the repertoire; any other is outside it, or past the end of a matched route.
 */
function judgeInWalk(prepared: PreparedRepertoire, walk: Walk, step: Step): Judgement {
  const { anchor, key } = step;
  if (walk.issue) {
    if (anchor && !walk.returning && !walk.returned.has(key)) {
      walk.returned.set(key, {
        ply: step.ply,
        chapterId: anchor.chapterId,
        chapterTitle: anchor.title,
        nodeId: anchor.nodeId
      });
    }
    return unjudged(anchor ? "transposed-back" : "outside-scope", anchor);
  }
  if (anchor) {
    walk.matchedAny = true;
    const judged = judgeRecognized(prepared, step);
    if (judged.credited) noteChapterUsed(prepared, walk, judged.credited.chapterId);
    return judged;
  }
  // After a match, a move off every active position means the route ended (a matched move
  // always reaches an active position: its supporting child is active).
  return unjudged(walk.end || walk.matchedAny ? "after-end" : "outside-scope", null);
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
  const prepared: PreparedRepertoire = {
    color,
    active: indexActiveOccurrences(repertoire.chapters),
    collected: collectDecisions(color, repertoire.chapters),
    stored: new Map(repertoire.decisions.map((decision) => [decision.positionKey, decision])),
    titles: new Map(repertoire.chapters.map((chapter) => [chapter.id, chapter.title]))
  };
  const walk: Walk = {
    issue: null,
    end: null,
    matchedAtEnd: 0,
    matchedAny: false,
    matchedPlies: 0,
    current: null,
    returning: false,
    returned: new Map(),
    chaptersUsed: []
  };

  const moves: ComparisonMove[] = [];
  let fen = game.rootFen;
  const firstPly = rootPly(game.rootFen) + 1;
  for (let index = 0; index < game.moves.length; index++) {
    const played = replay(fen, game.moves[index]);
    if (!played) break;
    const ranked = rankedAt(prepared, fen, walk.current);
    const anchor = ranked.at(0) ?? null;
    const step: Step = {
      ply: firstPly + index,
      fen,
      key: positionKey(fen),
      played,
      ranked,
      anchor
    };
    moves.push(advance(prepared, walk, step));
    fen = played.fenAfter;
  }

  if (!walk.issue && walk.end) {
    walk.issue = walk.end;
    walk.matchedPlies = walk.matchedAtEnd;
  }
  if (!walk.issue && !walk.matchedAny) {
    // A game that ends exactly where a chapter begins has nothing judged yet, but it applies.
    const final = rankedAt(prepared, fen, null).at(0);
    if (final) noteChapterUsed(prepared, walk, final.chapterId);
    else walk.issue = noApplicableChapter(game, moves, firstPly);
  }

  return {
    repertoireId: repertoire.id,
    repertoireName: repertoire.name,
    color,
    revision: repertoire.revision,
    moves,
    matchedPlies: walk.matchedPlies,
    issue: walk.issue,
    returnedByTransposition: [...walk.returned.values()],
    chaptersUsed: walk.chaptersUsed
  };
}
