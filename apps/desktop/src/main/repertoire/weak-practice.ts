/**
 * Weak-spots practice (docs/repertoire-games-and-practice.md §5.5), from the user's games under
 * the saved Insights filters: first the positions where they left the repertoire, most games
 * first; then the lines they meet most, walked through the repertoire with the opponent's reply
 * at each position the one played most often in their games (replies not followed yet rotate in
 * after the top one), until a stop, a leaf or the end of the games' data. Answers schedule like
 * Review. With one position key, that position only (a report row's Practise).
 */
import {
  REPERTOIRE_ROOT_NODE_ID,
  type PracticeSessionSnapshot,
  type StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { effectivePreferredUci } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import {
  continuations,
  rehearsalContext,
  type RehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import { replyFrequencies, weakSpotPositions } from "../repertoire-insights/weak-spots";
import { decisionRepository, type RepertoireRecord } from "./repository";
import {
  frozenQueue,
  openSession,
  practiceCandidates,
  queueSources,
  type Candidate,
  type QueueSource
} from "./practice-queue";

/** Forgotten positions one session asks at most. */
const WEAK_SPOT_LIMIT = 20;
/** Decisions the lines rehearsal adds at most, and lines it walks at most. */
const LINE_CARD_LIMIT = 20;
const MAX_LINES = 10;
/** Rehearsal depth the walk follows (the practice limit, in plies). */
const LINE_DEPTH_PLIES = 512;

type WeakCandidate = Candidate & { weakGames?: number };

export function startWeakPractice(
  input: StartPracticeInput,
  record: RepertoireRecord,
  now: number
): PracticeSessionSnapshot {
  const sources = queueSources(record, input);
  const eligible = new Map(
    sources.map((source) => [
      source.record.id,
      new Map(
        practiceCandidates(source, input).map((candidate) => [
          candidate.entry.positionKey,
          candidate
        ])
      )
    ])
  );
  const only = input.positionKeys?.[0];
  const picked: WeakCandidate[] = [];
  const queued = new Set<string>();
  const spots = weakSpotPositions(
    {
      ...(input.repertoireIds ? {} : { repertoireId: record.id }),
      ...(only ? { positionKey: only } : {})
    },
    now
  );
  for (const spot of spots) {
    if (picked.length >= WEAK_SPOT_LIMIT) break;
    const candidate = eligible.get(spot.repertoireId)?.get(spot.positionKey);
    const id = `${spot.repertoireId}\n${spot.positionKey}`;
    if (!candidate || queued.has(id)) continue;
    queued.add(id);
    picked.push({ ...candidate, weakGames: spot.games });
  }
  if (!only) {
    let budget = LINE_CARD_LIMIT;
    for (const source of sources) {
      if (budget <= 0) break;
      const lines = lineCandidates(
        source,
        eligible.get(source.record.id)!,
        replyFrequencies(source.record.id, now),
        { queued, budget }
      );
      budget -= lines.length;
      picked.push(...lines);
    }
  }
  return openSession(
    record,
    input,
    frozenQueue(picked, { firstSight: false, set: Boolean(input.repertoireIds) }),
    now
  );
}

/** Where a position occurs in the repertoire's chapters (each chapter prepared for rehearsal). */
type Occurrence = { context: RehearsalContext; nodeId: string };

/** The repertoire's positions (by key) in its enabled opening chapters, and its chapters' roots. */
function repertoirePositions(source: QueueSource): {
  at: Map<string, Occurrence[]>;
  roots: string[];
} {
  const paused = decisionRepository.pausedKeys(source.record.id);
  const at = new Map<string, Occurrence[]>();
  const roots: string[] = [];
  for (const chapter of source.chapters.values()) {
    if (chapter.kind !== "opening" || !chapter.enabled) continue;
    const context = rehearsalContext(chapter, source.record.color, {
      maxDepthPlies: LINE_DEPTH_PLIES,
      paused
    });
    for (const nodeId of context.lookup.order) {
      const key = context.lookup.positionKeys.get(nodeId)!;
      const list = at.get(key) ?? [];
      list.push({ context, nodeId });
      at.set(key, list);
    }
    const root = context.lookup.positionKeys.get(REPERTOIRE_ROOT_NODE_ID)!;
    if (!roots.includes(root)) roots.push(root);
  }
  return { at, roots };
}

/** The moves a line may continue with from a position (UCI → the position after it). */
function nextPositions(occurrences: readonly Occurrence[]): Map<string, string> {
  const next = new Map<string, string>();
  for (const { context, nodeId } of occurrences) {
    for (const childId of continuations(context, nodeId).children) {
      const child = context.lookup.nodesById.get(childId)!;
      if (child.uci && !next.has(child.uci)) {
        next.set(child.uci, context.lookup.positionKeys.get(childId)!);
      }
    }
  }
  return next;
}

/** A lines rehearsal being planned: the repertoire, its data, and the decisions picked so far. */
type LineWalk = {
  source: QueueSource;
  at: Map<string, Occurrence[]>;
  eligible: ReadonlyMap<string, Candidate>;
  frequencies: ReadonlyMap<string, { uci: string; games: number }[]>;
  queued: Set<string>;
  picked: Candidate[];
  /** How often each reply was followed this session, by position (the rotation). */
  followed: Map<string, Map<string, number>>;
};

/**
 * The decisions of the lines the user meets most, in the order a line asks them, skipping those
 * already queued (`queued` gains them), up to `budget`.
 */
function lineCandidates(
  source: QueueSource,
  eligible: ReadonlyMap<string, Candidate>,
  frequencies: ReadonlyMap<string, { uci: string; games: number }[]>,
  { queued, budget }: { queued: Set<string>; budget: number }
): Candidate[] {
  const { at, roots } = repertoirePositions(source);
  const walk: LineWalk = {
    source,
    at,
    eligible,
    frequencies,
    queued,
    picked: [],
    followed: new Map()
  };
  for (let line = 0; line < MAX_LINES && roots.length && walk.picked.length < budget; line += 1) {
    const before = walk.picked.length;
    const visited = new Set<string>();
    for (
      let key: string | undefined = roots[line % roots.length];
      key && !visited.has(key) && walk.picked.length < budget;
      key = stepFrom(walk, key)
    ) {
      visited.add(key);
    }
    // A line that asks nothing new: the lines met most are all queued.
    if (walk.picked.length === before) break;
  }
  return walk.picked;
}

/**
 * One step of a line from a position: at the player's turn its decision is picked (once) and the
 * line follows the preferred move; at the opponent's, the reply the games played most (see
 * nextReply). Undefined when the line ends here.
 */
function stepFrom(walk: LineWalk, key: string): string | undefined {
  const occurrences = walk.at.get(key) ?? [];
  const next = nextPositions(occurrences);
  if (!next.size) return undefined;
  const { lookup } = occurrences[0].context;
  const fen = lookup.nodesById.get(occurrences[0].nodeId)!.fenAfter;
  if (playerToMove(fen) !== walk.source.record.color) {
    return nextReply(key, next, walk.frequencies, walk.followed);
  }
  const candidate = walk.eligible.get(key);
  const id = `${walk.source.record.id}\n${key}`;
  if (candidate && !walk.queued.has(id)) {
    walk.queued.add(id);
    walk.picked.push(candidate);
  }
  const preferred = candidate
    ? (effectivePreferredUci(candidate.decision, candidate.entry.acceptedUcis) ??
      candidate.effective[0])
    : undefined;
  return (preferred && next.get(preferred)) ?? next.values().next().value;
}

/**
 * The position after the reply a line follows at an opponent position: among the covered replies
 * the user's games played there, the one followed least this session, then the most played; none
 * (the line ends) without such a reply.
 */
function nextReply(
  key: string,
  next: ReadonlyMap<string, string>,
  frequencies: ReadonlyMap<string, { uci: string; games: number }[]>,
  followed: Map<string, Map<string, number>>
): string | undefined {
  const counts = followed.get(key) ?? new Map<string, number>();
  const reply = (frequencies.get(key) ?? [])
    .filter((item) => item.games > 0 && next.has(item.uci))
    .sort((a, b) => (counts.get(a.uci) ?? 0) - (counts.get(b.uci) ?? 0) || b.games - a.games)
    .at(0);
  if (!reply) return undefined;
  counts.set(reply.uci, (counts.get(reply.uci) ?? 0) + 1);
  followed.set(key, counts);
  return next.get(reply.uci);
}
