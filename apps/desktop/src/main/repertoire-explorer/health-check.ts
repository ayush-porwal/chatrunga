/**
 * The health check's rules (docs/repertoire-games-and-practice.md §6.3), on one repertoire:
 * - **No answer**, without the engine: a covered reply after which the player has no practised
 *   move anywhere in the repertoire, unless the reply's node is a chapter end (a leaf, or nothing
 *   after it is enabled) or a stop;
 * - **Engine disagrees**: a practised move (of a decision that isn't paused) loses at least 10
 *   win-% against the engine's best move (MultiPV 2; a move outside the two lines is searched on
 *   its own);
 * - **Their common mistake**, with Maia 3: at an opponent position in the active scope, Maia (at
 *   the user's rating) puts at least 30% on a reply the repertoire doesn't cover, and that reply
 *   loses at least 20 win-% for the opponent; the engine's best answer to it is the punishment.
 */
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { sideToMoveWin } from "@chaturanga/shared/chess/move-assessment";
import type { PuzzleEngine } from "@chaturanga/shared/chess/puzzle-generator";
import type { PuzzleEngineLine } from "@chaturanga/shared/chess/puzzle-solution";
import {
  buildChapterLookup,
  collectDecisions,
  computeScopeStates,
  effectiveAcceptedUcis,
  nodeMetaOf,
  type RepertoireChapterContent
} from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import { rankedMoves, type Maia3Evaluator } from "@chaturanga/shared/engine/maia3";
import type { RepertoireHealthFlagKind } from "@chaturanga/shared/types/repertoire-health";
import type {
  RepertoireColor,
  RepertoireDecision,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";

/** Every search of the check. */
const HEALTH_DEPTH = 18;
const MULTIPV = 2;
/** Engine disagrees: the practised move loses at least this much win-%. */
const DISAGREE_LOSS = 10;
/** Their common mistake: Maia's weight on the reply… */
const MISTAKE_PROBABILITY = 0.3;
/** …and what it loses the opponent (win-%). */
const MISTAKE_LOSS = 20;

/** A flag as the check finds it (what Study shows of its line is read when it is shown). */
export type FoundFlag = {
  positionKey: string;
  fen: string;
  kind: RepertoireHealthFlagKind;
  uci: string;
  bestUci: string | null;
  loss: number | null;
  probability: number | null;
  rating: number | null;
};

export type HealthRepertoire = {
  color: RepertoireColor;
  chapters: readonly RepertoireChapterContent[];
  decisions: readonly RepertoireDecision[];
};

/** A player decision the engine checks: its practised moves (standard UCI). */
type CheckedDecision = { positionKey: string; fen: string; ucis: string[] };
/** An opponent position in the active scope, with the replies the repertoire covers there. */
type OpponentPosition = { positionKey: string; fen: string; covered: Set<string> };

type HealthPositions = {
  decisions: CheckedDecision[];
  opponent: OpponentPosition[];
  noAnswer: FoundFlag[];
};

/** A position's practised moves, repertoire-wide (stored choices that are still supported). */
type PractisedAt = (key: string) => string[];

/** A covered reply in one chapter: the node it is, and the occurrence it is played from. */
type CoveredReply = {
  key: string;
  fen: string;
  uci: string;
  childId: string;
  lookup: ReturnType<typeof buildChapterLookup>;
  states: ReturnType<typeof computeScopeStates>;
  meta: RepertoireNodeMeta;
};

/** Every covered reply at an active opponent position of the enabled opening chapters. */
function coveredReplies(repertoire: HealthRepertoire): CoveredReply[] {
  const replies: CoveredReply[] = [];
  const ordered = [...repertoire.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const chapter of ordered) {
    if (!chapter.enabled || chapter.kind !== "opening") continue;
    const lookup = buildChapterLookup(chapter);
    const states = computeScopeStates(chapter, lookup);
    for (const id of lookup.order) {
      const node = lookup.nodesById.get(id)!;
      if (states.get(id) !== "active" || playerToMove(node.fenAfter) === repertoire.color) continue;
      for (const childId of lookup.childrenById.get(id) ?? []) {
        const child = lookup.nodesById.get(childId)!;
        const meta = nodeMetaOf(chapter.nodeMeta, childId);
        if (!child.uci || states.get(childId) !== "active" || meta.edge === "reference") continue;
        const uci = standardCastlingUci(node.fenAfter, child.uci);
        const key = lookup.positionKeys.get(id)!;
        replies.push({ key, fen: node.fenAfter, uci, childId, lookup, states, meta });
      }
    }
  }
  return replies;
}

/**
 * The player has no practised move after the reply, and its line goes on: not a chapter end
 * (nothing enabled after it) nor a stop.
 */
function unanswered(reply: CoveredReply, practisedAt: PractisedAt): boolean {
  const continues = (reply.lookup.childrenById.get(reply.childId) ?? []).some(
    (grandchildId) => reply.states.get(grandchildId) !== "disabled"
  );
  if (reply.meta.trainingStop || !continues) return false;
  return !practisedAt(reply.lookup.positionKeys.get(reply.childId)!).length;
}

/** The positions the check reads, and the no-answer flags (no engine needed). */
export function healthPositions(repertoire: HealthRepertoire): HealthPositions {
  const collected = collectDecisions(repertoire.color, repertoire.chapters);
  const stored = new Map(repertoire.decisions.map((decision) => [decision.positionKey, decision]));
  const practisedAt: PractisedAt = (key) => {
    const supported = collected.get(key)?.acceptedUcis ?? new Set<string>();
    const decision = stored.get(key);
    return decision ? effectiveAcceptedUcis(decision, supported) : [...supported];
  };

  const decisions: CheckedDecision[] = [];
  for (const [key, decision] of collected) {
    if (stored.get(key)?.paused) continue;
    const ucis = practisedAt(key).map((uci) => standardCastlingUci(decision.fen, uci));
    if (ucis.length) decisions.push({ positionKey: key, fen: decision.fen, ucis });
  }

  const opponent = new Map<string, OpponentPosition>();
  const noAnswer = new Map<string, FoundFlag>();
  for (const reply of coveredReplies(repertoire)) {
    const position = opponent.get(reply.key) ?? {
      positionKey: reply.key,
      fen: reply.fen,
      covered: new Set<string>()
    };
    position.covered.add(reply.uci);
    opponent.set(reply.key, position);
    if (!unanswered(reply, practisedAt)) continue;
    noAnswer.set(`${reply.key} ${reply.uci}`, {
      positionKey: reply.key,
      fen: reply.fen,
      kind: "no-answer",
      uci: reply.uci,
      bestUci: null,
      loss: null,
      probability: null,
      rating: null
    });
  }
  return { decisions, opponent: [...opponent.values()], noAnswer: [...noAnswer.values()] };
}

type EngineCheckInput = {
  positions: Pick<HealthPositions, "decisions" | "opponent">;
  engine: PuzzleEngine;
  /** Maia 3 when it is installed (without it, no common-mistake flags). */
  maia: Pick<Maia3Evaluator, "evaluate"> | null;
  /** The user's rating Maia reads both sides at. */
  rating: number;
  signal: AbortSignal;
  /** Before every search: waits while the user's engine or the puzzle queue is busy. */
  beforeSearch(): Promise<void>;
  onProgress(done: number, total: number): void;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The engine's two best lines, best first; a move's own line when `searchmoves` names it. */
async function search(
  input: EngineCheckInput,
  fen: string,
  searchmoves?: string[]
): Promise<PuzzleEngineLine[]> {
  input.signal.throwIfAborted();
  await input.beforeSearch();
  input.signal.throwIfAborted();
  const lines = await input.engine.analyse(fen, {
    depth: HEALTH_DEPTH,
    multipv: searchmoves ? 1 : MULTIPV,
    ...(searchmoves ? { searchmoves } : {})
  });
  return lines.filter((line) => line.pv.length > 0).sort((a, b) => a.multipv - b.multipv);
}

const firstMove = (fen: string, line: PuzzleEngineLine) => standardCastlingUci(fen, line.pv[0]);

async function disagreements(input: EngineCheckInput, decision: CheckedDecision) {
  const flags: FoundFlag[] = [];
  const lines = await search(input, decision.fen);
  const best = lines.at(0);
  if (!best) return flags;
  const bestUci = firstMove(decision.fen, best);
  const bestWin = sideToMoveWin(best.score);
  for (const uci of decision.ucis) {
    if (uci === bestUci) continue;
    const line =
      lines.find((item) => firstMove(decision.fen, item) === uci) ??
      (await search(input, decision.fen, [uci])).at(0);
    if (!line) continue;
    const loss = bestWin - sideToMoveWin(line.score);
    if (loss < DISAGREE_LOSS) continue;
    flags.push({
      positionKey: decision.positionKey,
      fen: decision.fen,
      kind: "engine-disagrees",
      uci,
      bestUci,
      loss: round1(loss),
      probability: null,
      rating: null
    });
  }
  return flags;
}

async function commonMistakes(
  input: EngineCheckInput,
  position: OpponentPosition,
  policy: Readonly<Record<string, number>>
) {
  const flags: FoundFlag[] = [];
  const candidates = rankedMoves(policy)
    .filter((move) => move.prob >= MISTAKE_PROBABILITY)
    .map((move) => ({ ...move, uci: standardCastlingUci(position.fen, move.uci) }))
    .filter((move) => !position.covered.has(move.uci));
  if (!candidates.length) return flags;
  const best = (await search(input, position.fen)).at(0);
  if (!best) return flags;
  const bestUci = firstMove(position.fen, best);
  const bestWin = sideToMoveWin(best.score);
  for (const candidate of candidates) {
    if (candidate.uci === bestUci) continue;
    const after = fenAfterUci(position.fen, candidate.uci);
    if (!after) continue;
    // No line: the reply mated or stalemated, which is no mistake of theirs.
    const punishment = (await search(input, after)).at(0);
    if (!punishment) continue;
    const loss = bestWin - (100 - sideToMoveWin(punishment.score));
    if (loss < MISTAKE_LOSS) continue;
    flags.push({
      positionKey: position.positionKey,
      fen: position.fen,
      kind: "common-mistake",
      uci: candidate.uci,
      bestUci: firstMove(after, punishment),
      loss: round1(loss),
      probability: candidate.prob,
      rating: input.rating
    });
  }
  return flags;
}

/** The engine-disagrees and common-mistake flags (the second only with Maia 3). */
export async function engineFlags(input: EngineCheckInput): Promise<FoundFlag[]> {
  const { decisions, opponent } = input.positions;
  const total = decisions.length + (input.maia ? opponent.length : 0);
  let done = 0;
  const flags: FoundFlag[] = [];
  input.onProgress(done, total);
  for (const decision of decisions) {
    flags.push(...(await disagreements(input, decision)));
    input.onProgress(++done, total);
  }
  if (!input.maia || !opponent.length) return flags;
  const outputs = await input.maia.evaluate(
    opponent.map((position) => ({
      fen: position.fen,
      eloSelf: input.rating,
      eloOppo: input.rating
    })),
    { priority: "review", signal: input.signal }
  );
  for (const [index, position] of opponent.entries()) {
    flags.push(...(await commonMistakes(input, position, outputs[index].policy)));
    input.onProgress(++done, total);
  }
  return flags;
}
