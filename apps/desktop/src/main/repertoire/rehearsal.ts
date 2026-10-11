/** Rehearse-lines practice: playing a chapter's lines through, move by move. */
import { nanoid } from "nanoid";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AttemptResult,
  type PracticeActionInput,
  type PracticeActionResult,
  type PracticeCard,
  type PracticeLeadUpMove,
  type PracticeSessionSnapshot,
  type RecordAttemptInput,
  type RehearsalStep,
  type RepertoireChapter,
  type RepertoireColor,
  type StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import {
  acceptanceFingerprint,
  buildChapterLookup,
  computeScopeStates,
  nodeMetaOf
} from "@chaturanga/shared/chess/repertoire-index";
import {
  firstAnswerOutcome,
  type PracticeHistoryAction
} from "@chaturanga/shared/chess/repertoire-scheduler";
import {
  DEFAULT_REHEARSAL_DEPTH_PLIES,
  continuations,
  lineEnds,
  isDecisionNode,
  isPlayerNode,
  lineIdOf,
  nextOnRoute,
  planRoute,
  rehearsalContext,
  type RehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import { formatPath } from "@chaturanga/shared/chess/repertoire-pgn";
import { fenAfterMove, normalizeUci } from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  positionIndexRepository,
  progressRepository,
  repertoireRepository,
  type RepertoireRecord
} from "./repository";
import {
  attemptRepository,
  sessionRepository,
  type AttemptKind,
  type AttemptRecord,
  type FrozenPolicy,
  type PracticeSessionRecord,
  type RehearsalState
} from "./practice-repository";
import { parseStoredJson } from "../stored-json";
import {
  cardIndex,
  cardTurn,
  gradeIsFinal,
  historyAction,
  nextHintStage,
  snapshotOf,
  type CardTurn
} from "./practice-state";

/** Marker stored in an attempt row's `outcome` for an answer from another line (not a miss). */
export const OTHER_LINE = "other-line";

type Rehearsal = {
  state: RehearsalState;
  chapter: RepertoireChapter;
  context: RehearsalContext;
  color: RepertoireColor;
};

/**
 * The session's chapter prepared for rehearsal, or null when the session can't continue: the
 * repertoire was archived, or the chapter was removed, disabled or edited since it was planned.
 */
export function loadRehearsal(session: PracticeSessionRecord): Rehearsal | null {
  const current = currentRehearsal(session);
  if (!current) return null;
  const { state, chapter, color } = current;
  return {
    state,
    chapter,
    context: rehearsalContext(chapter, color, {
      maxDepthPlies: state.maxDepthPlies,
      paused: decisionRepository.pausedKeys(session.repertoireId)
    }),
    color
  };
}

/**
 * The rehearsal's chapter and colour while it can continue (the repertoire is active and the
 * chapter unchanged, enabled and an opening chapter), without indexing it; else null.
 */
function currentRehearsal(
  session: PracticeSessionRecord
): Pick<Rehearsal, "state" | "chapter" | "color"> | null {
  const state = session.rehearsal;
  if (!state) return null;
  const record = repertoireRepository.get(session.repertoireId);
  if (!record || record.archivedAt !== null) return null;
  const chapter = chapterRepository.get(state.chapterId);
  if (
    !chapter ||
    chapter.revision !== state.chapterRevision ||
    !chapter.enabled ||
    chapter.kind !== "opening"
  ) {
    return null;
  }
  return { state, chapter, color: record.color };
}

/** Ends a session that can't continue: every unanswered card is skipped ungraded. */
export function finishStale(session: PracticeSessionRecord): void {
  session.cards = session.cards.map((card) =>
    card.state === "unanswered" ? { ...card, state: "skipped" } : card
  );
  session.status = "finished";
}

function leadUpMove(node: MoveNode): PracticeLeadUpMove {
  return { san: node.san ?? "", uci: node.uci ?? "", fen: node.fenAfter };
}

/**
 * Appends the decision at `nodeId` on the current line as the session's current card. Its frozen
 * policy accepts exactly the line's own move there (other accepted choices are `other-line`).
 */
function pushRehearsalCard(
  session: PracticeSessionRecord,
  rehearsal: Rehearsal,
  nodeId: string,
  stepIndex: number
): PracticeCard {
  const { lookup } = rehearsal.context;
  const node = lookup.nodesById.get(nodeId)!;
  const key = lookup.positionKeys.get(nodeId)!;
  const move = nextOnRoute(lookup, nodeId, rehearsal.state.lineEnd)!;
  const decision = decisionRepository.get(session.repertoireId, key);
  const queueItemId = `q${session.cards.length + 1}`;
  const card: PracticeCard = {
    queueItemId,
    positionKey: key,
    fen: node.fenAfter,
    orientation: rehearsal.color,
    leadUp: lookup.parentPath
      .get(nodeId)!
      .slice(1)
      .map((id) => leadUpMove(lookup.nodesById.get(id)!)),
    chapterId: rehearsal.chapter.id,
    nodeId,
    prompt: decision?.prompt ?? null,
    stage: progressRepository.get(session.repertoireId, key) ? "review" : "new",
    state: "unanswered",
    hintStage: 0,
    attemptsSoFar: 0,
    rehearsal: {
      lineId: lineIdOf(rehearsal.state.lineEnd),
      stepIndex,
      lineNumber: lineNumberOf(rehearsal.state, rehearsal.state.lineEnd)
    }
  };
  session.cards.push(card);
  session.policies[queueItemId] = {
    acceptedUcis: [move.uci!],
    preferredUci: move.uci!,
    fingerprint: acceptanceFingerprint([move.uci!]),
    hint: decision?.hint ?? null,
    wrongMoveFeedback: decision?.wrongMoveFeedback ?? {},
    explanation: node.comment ?? null
  };
  session.cursor = session.cards.length - 1;
  return card;
}

/** End nodes of the lines from the session's start node that are neither completed nor skipped. */
function pendingLines(rehearsal: Rehearsal): Set<string> {
  const finished = new Set(rehearsal.state.finished);
  return new Set(
    lineEnds(rehearsal.context, rehearsal.state.fromNodeId).filter(
      (endNodeId) => !finished.has(endNodeId)
    )
  );
}

function countSeen(state: RehearsalState, nodeId: string): void {
  state.seen[nodeId] = (state.seen[nodeId] ?? 0) + 1;
}

/**
 * The session's number of the line ending at `endNodeId`: lines are numbered by first appearance,
 * so a line planned again keeps its number and a different line gets a new one.
 */
function lineNumberOf(state: RehearsalState, endNodeId: string): number {
  const order = (state.lineOrder ??= []);
  if (!order.includes(endNodeId)) order.push(endNodeId);
  return order.indexOf(endNodeId) + 1;
}

/** Makes the line ending at `endNodeId` the one being played, and counts it as started. */
function startLine(state: RehearsalState, endNodeId: string): void {
  state.lineEnd = endNodeId;
  state.linesStarted += 1;
  lineNumberOf(state, endNodeId);
}

/**
 * Plans the next pending line from the start node and appends its first decision. The moves before
 * it (lead-up above a "Start training here" marker, an opening opponent reply) are played
 * automatically and show in that card's lead-up. With no line left the session is finished and
 * null is returned.
 */
function startNextLine(session: PracticeSessionRecord, rehearsal: Rehearsal): PracticeCard | null {
  const { state, context } = rehearsal;
  const pending = pendingLines(rehearsal);
  if (!pending.size) {
    session.status = "finished";
    return null;
  }
  const plan = planRoute(context, state.fromNodeId, {
    pending,
    seen: state.seen,
    finished: new Set(state.finished)
  });
  startLine(state, plan.endNodeId);
  // A pending line always has a decision before its end, so this stops on the line.
  let index = 0;
  while (index < plan.nodeIds.length - 1 && !isDecisionNode(context, plan.nodeIds[index])) {
    index += 1;
    if (!isPlayerNode(context, plan.nodeIds[index - 1])) countSeen(state, plan.nodeIds[index]);
  }
  return pushRehearsalCard(session, rehearsal, plan.nodeIds[index], 0);
}

/** Marks the current line finished; a line already finished this session isn't counted again. */
function finishLine(state: RehearsalState, completed: boolean): void {
  if (state.finished.includes(state.lineEnd)) return;
  state.finished.push(state.lineEnd);
  if (completed) state.linesCompleted += 1;
}

/**
 * Continues the current line from `reachedId`, the node the player's move (or a revealed or
 * followed move) led to: supplies the authored reply on the line and appends the next decision,
 * or completes the line and starts the next one. A paused decision after the reply isn't asked:
 * the line's move there and the reply after it are played as context (the next card's lead-up).
 */
function continueLine(
  session: PracticeSessionRecord,
  rehearsal: Rehearsal,
  reachedId: string,
  stepIndex: number
): RehearsalStep {
  const { state, context } = rehearsal;
  const complete = (reply: PracticeLeadUpMove | null): RehearsalStep => {
    const endReason = continuations(context, state.lineEnd).end ?? "leaf";
    finishLine(state, true);
    return { reply, next: startNextLine(session, rehearsal), lineComplete: true, endReason };
  };
  if (reachedId === state.lineEnd) return complete(null);
  const replyNode = nextOnRoute(context.lookup, reachedId, state.lineEnd)!;
  countSeen(state, replyNode.id);
  const reply = leadUpMove(replyNode);
  let decisionId = replyNode.id;
  while (decisionId !== state.lineEnd && !isDecisionNode(context, decisionId)) {
    const move = nextOnRoute(context.lookup, decisionId, state.lineEnd)!;
    if (!isPlayerNode(context, decisionId)) countSeen(state, move.id);
    decisionId = move.id;
  }
  if (decisionId === state.lineEnd) return complete(reply);
  const next = pushRehearsalCard(session, rehearsal, decisionId, stepIndex + 1);
  return { reply, next, lineComplete: false, endReason: null };
}

/**
 * Where an accepted choice that isn't this line's move lives: the first active occurrence of the
 * card's position with an active included child playing `uci`. Its own node comes first, then the
 * occurrences inside the session's branch whose move is within the depth limit, then the rest of
 * its chapter, then the other enabled opening chapters in order. Index links are only looked up,
 * never followed: only the chapters the position index has the position active in are read, and
 * one that can't be read is passed over.
 */
function findOtherLine(
  session: PracticeSessionRecord,
  rehearsal: Rehearsal,
  card: PracticeCard,
  uci: string
): NonNullable<AttemptResult["otherLine"]> | null {
  const others = function* () {
    for (const chapterId of positionIndexRepository.activeChapterIds(
      session.repertoireId,
      card.positionKey
    )) {
      if (chapterId === rehearsal.chapter.id) continue;
      let chapter: RepertoireChapter | null = null;
      try {
        chapter = chapterRepository.get(chapterId);
      } catch {
        // A damaged chapter offers no line; the rehearsed one is intact.
      }
      if (chapter) yield chapter;
    }
  };
  for (const chapter of [rehearsal.chapter, ...others()]) {
    if (!chapter.enabled || chapter.kind !== "opening") continue;
    const own = chapter === rehearsal.chapter;
    const lookup = own ? rehearsal.context.lookup : buildChapterLookup(chapter);
    const states = own ? rehearsal.context.states : computeScopeStates(chapter, lookup);
    const nodeIds = own ? ownOccurrenceOrder(rehearsal, card.nodeId) : lookup.order;
    for (const id of nodeIds) {
      if (lookup.positionKeys.get(id) !== card.positionKey || states.get(id) !== "active") {
        continue;
      }
      for (const childId of lookup.childrenById.get(id) ?? []) {
        const child = lookup.nodesById.get(childId)!;
        if (
          child.uci !== uci ||
          states.get(childId) !== "active" ||
          nodeMetaOf(chapter.nodeMeta, childId).edge !== "included"
        ) {
          continue;
        }
        const path = lookup.parentPath
          .get(childId)!
          .slice(1)
          .map((nodeId) => lookup.nodesById.get(nodeId)!);
        return {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          nodeId: childId,
          path: formatPath(path)
        };
      }
    }
  }
  return null;
}

/**
 * The rehearsed chapter's nodes in the order findOtherLine looks at them: `nodeId`, then the nodes
 * inside the session's branch whose next move is within the depth limit, then the rest.
 */
function ownOccurrenceOrder(rehearsal: Rehearsal, nodeId: string): string[] {
  const { lookup, rootPly, maxDepthPlies } = rehearsal.context;
  const { fromNodeId } = rehearsal.state;
  const branch = new Set<string>();
  const stack = [fromNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    branch.add(id);
    stack.push(...(lookup.childrenById.get(id) ?? []));
  }
  const preferred: string[] = [];
  const rest: string[] = [];
  for (const id of lookup.order) {
    if (id === nodeId) continue;
    const inBranch = branch.has(id) && lookup.nodesById.get(id)!.ply + 1 - rootPly <= maxDepthPlies;
    (inBranch ? preferred : rest).push(id);
  }
  return [nodeId, ...preferred, ...rest];
}

/** A card's actions that count towards its first-answer grade (other-line answers don't). */
function gradedHistory(history: readonly AttemptRecord[]): PracticeHistoryAction[] {
  return history.filter((attempt) => attempt.outcome !== OTHER_LINE).map(historyAction);
}

/**
 * Starts a rehearsal of one chapter from its root or `rehearse.fromNodeId`. The queue grows as
 * lines are played: the first card is the first decision of the first planned line. A disabled or
 * reference chapter is refused; a valid start node with no line to play gives an empty, finished
 * session.
 */
export function startRehearsal(
  input: StartPracticeInput,
  record: RepertoireRecord,
  now: number
): PracticeSessionSnapshot {
  const target = input.rehearse;
  if (!target?.chapterId) {
    throw new Error("Invalid rehearse: chapterId is required for rehearse-lines");
  }
  const chapter = chapterRepository.get(target.chapterId);
  if (!chapter || chapterRepository.ownerOf(chapter.id)?.repertoireId !== record.id) {
    throw new Error("Invalid rehearse.chapterId: not found");
  }
  if (!chapter.enabled || chapter.kind !== "opening") {
    throw new Error("Invalid rehearse: this chapter has nothing to rehearse");
  }
  const fromNodeId = target.fromNodeId ?? REPERTOIRE_ROOT_NODE_ID;
  const maxDepthPlies = input.maxDepthPlies ?? DEFAULT_REHEARSAL_DEPTH_PLIES;
  // A paused decision is played as context, never asked (as practice leaves it out).
  const context = rehearsalContext(chapter, record.color, {
    maxDepthPlies,
    paused: decisionRepository.pausedKeys(record.id)
  });
  if (!context.lookup.parentPath.get(fromNodeId)) {
    throw new Error("Invalid rehearse.fromNodeId: not in this chapter");
  }
  const state: RehearsalState = {
    chapterId: chapter.id,
    fromNodeId,
    chapterRevision: chapter.revision,
    maxDepthPlies,
    lineEnd: fromNodeId,
    seen: {},
    finished: [],
    linesStarted: 0,
    linesCompleted: 0,
    lineOrder: []
  };
  const session: PracticeSessionRecord = {
    id: nanoid(),
    repertoireId: record.id,
    mode: "rehearse-lines",
    scope: {
      repertoireId: record.id,
      ...(input.maxDepthPlies !== undefined ? { maxDepthPlies: input.maxDepthPlies } : {}),
      rehearse: {
        chapterId: chapter.id,
        ...(target.fromNodeId !== undefined ? { fromNodeId: target.fromNodeId } : {})
      }
    },
    snapshotRevision: record.revision,
    cards: [],
    policies: {},
    rehearsal: state,
    cursor: 0,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  startNextLine(session, { state, chapter, context, color: record.color });
  sessionRepository.save(session);
  return snapshotOf(session);
}

/** A rehearsal answer: its outcome and grade, the outcome its row keeps, where the line went. */
type RehearsalAnswer = {
  outcome: AttemptResult["outcome"];
  finalGrade: boolean;
  recorded: string | null;
  otherLine: AttemptResult["otherLine"] | null;
  step?: RehearsalStep;
};

/**
 * Rehearsal grading (§5.3). Only the current card can be answered. The line's own move is
 * correct: the first legal answer fixes the session grade (never progress), and the line goes on
 * with the next authored reply and decision. Another accepted choice at this position is
 * `other-line`: not a miss, the card stays open. Anything else is outside the repertoire: the card
 * stays current for retries. A changed chapter ends the session (`stale`).
 */
export function rehearsalAttempt(
  session: PracticeSessionRecord,
  input: RecordAttemptInput
): AttemptResult {
  const turn = cardTurn(session, cardIndex(session, input.queueItemId));
  const { card, policy, history, index, now } = turn;
  const uci = normalizeUci(card.fen, input.uci);
  const legal = fenAfterMove(card.fen, uci) !== null;
  const correct = legal && uci === policy.acceptedUcis[0];
  const answer = answerRehearsal(turn, uci, { legal, correct });
  const { outcome } = answer;

  // A stale answer reveals nothing: the line it was checked against is no longer the chapter's.
  const revealed =
    outcome !== "stale" && (card.state === "answered-wrong" ? correct : gradeIsFinal(card));
  const result: AttemptResult = {
    outcome,
    ...(answer.otherLine ? { otherLine: answer.otherLine } : {}),
    ...(answer.step ? { rehearsal: answer.step } : {}),
    acceptedUcis: revealed ? policy.acceptedUcis : [],
    preferredUci: revealed ? policy.preferredUci : null,
    feedback: outcome === "outside-repertoire" ? (policy.wrongMoveFeedback[uci] ?? null) : null,
    card,
    finalGrade: answer.finalGrade,
    // Also on a card being retried (still answered-wrong): the session is over either way.
    ...(outcome === "stale" ? { sessionEnded: true as const } : {})
  };
  attemptRepository.insert({
    attemptId: input.attemptId,
    sessionId: session.id,
    queueItemId: card.queueItemId,
    sequence: (history.at(-1)?.sequence ?? 0) + 1,
    kind: "attempt",
    uci,
    legal,
    correct,
    isFinalGrade: answer.finalGrade,
    outcome: answer.recorded,
    positionKey: card.positionKey,
    fingerprint: policy.fingerprint,
    resultJson: JSON.stringify(result),
    at: now
  });
  session.cards[index] = card;
  session.updatedAt = now;
  sessionRepository.save(session);
  return result;
}

/** Grades `uci` on the turn's card (updating the card, and the line when it is the line's move). */
function answerRehearsal(
  turn: CardTurn,
  uci: string,
  { legal, correct }: { legal: boolean; correct: boolean }
): RehearsalAnswer {
  const { session, card, index, history } = turn;
  const plain = (outcome: AttemptResult["outcome"]): RehearsalAnswer => ({
    outcome,
    finalGrade: false,
    recorded: null,
    otherLine: null
  });
  const open =
    index === session.cursor && (card.state === "unanswered" || card.state === "answered-wrong");
  if (!open) return plain("already-final");
  if (!legal) return plain("illegal");
  const rehearsal = loadRehearsal(session);
  if (!rehearsal) {
    finishStale(session);
    if (card.state === "unanswered") card.state = "skipped";
    return plain("stale");
  }
  if (correct) return playLineMove(turn, rehearsal);
  const otherLine = findOtherLine(session, rehearsal, card, uci);
  card.attemptsSoFar += 1;
  if (otherLine)
    return { outcome: "other-line", finalGrade: false, recorded: OTHER_LINE, otherLine };
  return {
    outcome: "outside-repertoire",
    ...gradeFirstAnswer(card, history, false),
    otherLine: null
  };
}

/** The first legal answer to an unanswered card fixes its session grade (never progress). */
function gradeFirstAnswer(
  card: PracticeCard,
  history: readonly AttemptRecord[],
  correct: boolean
): { finalGrade: boolean; recorded: string | null } {
  if (card.state !== "unanswered") return { finalGrade: false, recorded: null };
  const recorded = firstAnswerOutcome([
    ...gradedHistory(history),
    { kind: "attempt", legal: true, correct }
  ]);
  card.state = correct ? "answered-correct" : "answered-wrong";
  return { finalGrade: true, recorded };
}

/** The line's own move: graded correct, and the line goes on with its next reply and decision. */
function playLineMove(turn: CardTurn, rehearsal: Rehearsal): RehearsalAnswer {
  const { session, card, index, history } = turn;
  card.attemptsSoFar += 1;
  const graded = gradeFirstAnswer(card, history, true);
  session.cards[index] = card;
  const child = nextOnRoute(rehearsal.context.lookup, card.nodeId, rehearsal.state.lineEnd)!;
  const step = continueLine(session, rehearsal, child.id, card.rehearsal?.stepIndex ?? 0);
  return { outcome: "correct", ...graded, otherLine: null, step };
}

/** The answer a reveal shows: the line's move (and the others accepted), with its explanation. */
function revealedAnswer(policy: FrozenPolicy): NonNullable<PracticeActionResult["revealed"]> {
  return {
    ucis: policy.acceptedUcis,
    preferredUci: policy.preferredUci,
    explanation: policy.explanation ?? policy.hint
  };
}

/** Records a hint, reveal, skip or followed answer of the turn's card (no move of its own). */
function recordAction(
  { session, card, policy, history, now }: CardTurn,
  action: { kind: AttemptKind; isFinalGrade: boolean; outcome: string | null; correct?: boolean }
): void {
  attemptRepository.insert({
    attemptId: nanoid(),
    sessionId: session.id,
    queueItemId: card.queueItemId,
    sequence: (history.at(-1)?.sequence ?? 0) + 1,
    kind: action.kind,
    uci: null,
    legal: true,
    correct: action.correct ?? false,
    isFinalGrade: action.isFinalGrade,
    outcome: action.outcome,
    positionKey: card.positionKey,
    fingerprint: policy.fingerprint,
    resultJson: null,
    at: now
  });
}

/** Saves the session as the action left it, and returns the action's result. */
function saved(turn: CardTurn, result: PracticeActionResult): PracticeActionResult {
  turn.session.updatedAt = turn.now;
  sessionRepository.save(turn.session);
  return result;
}

/**
 * Rehearsal actions on the current card. Hints work as in the other modes. Reveal misses an
 * unanswered card, then plays the line's move and continues. Skip abandons the current line (not
 * completed) and starts the next one. Follow-other-line, right after an `other-line` answer,
 * switches to that occurrence (same chapter only) and continues from it. A reveal, skip or follow
 * of a card the line has already left (a retry after a lost response) returns the card unchanged.
 */
export function rehearsalAction(
  session: PracticeSessionRecord,
  input: PracticeActionInput
): PracticeActionResult {
  const index = cardIndex(session, input.queueItemId);
  const kind = input.action.kind;
  // A retry after a lost response: the line already moved on, so the card is returned as it is.
  if (index !== session.cursor) return settledCardAction(session.cards[index], session, kind);
  const turn = cardTurn(session, index);
  if (kind === "hint") return rehearsalHint(turn);
  const { card, history } = turn;
  const open = card.state === "unanswered" || card.state === "answered-wrong";
  const lastAction = history.at(-1);
  if (
    kind === "follow-other-line" &&
    (!open || lastAction?.outcome !== OTHER_LINE || !lastAction.resultJson)
  ) {
    throw new Error("Invalid action: follow-other-line needs an answer from another line first");
  }
  const revealed = revealedAnswer(turn.policy);
  if (!open) return kind === "reveal" ? { card, revealed } : { card };

  const rehearsal = loadRehearsal(session);
  if (!rehearsal) return endStaleRehearsal(turn, kind, revealed);
  if (kind === "reveal") return revealLineMove(turn, rehearsal, revealed);
  if (kind === "skip") return skipLine(turn, rehearsal);
  return followOtherLine(turn, rehearsal, lastAction!);
}

/** A changed chapter ends the rehearsal; the action (but not a follow) is kept on the old card. */
function endStaleRehearsal(
  turn: CardTurn,
  kind: Exclude<PracticeActionInput["action"]["kind"], "hint">,
  revealed: NonNullable<PracticeActionResult["revealed"]>
): PracticeActionResult {
  const { session, index } = turn;
  if (kind !== "follow-other-line")
    recordAction(turn, { kind, isFinalGrade: false, outcome: null });
  finishStale(session);
  const skipped = session.cards[index];
  return saved(turn, kind === "reveal" ? { card: skipped, revealed } : { card: skipped });
}

/** A card the line already left: a reveal shows its answer again, a skip or follow returns it. */
function settledCardAction(
  settled: PracticeCard,
  session: PracticeSessionRecord,
  kind: PracticeActionInput["action"]["kind"]
): PracticeActionResult {
  if (kind === "reveal") {
    return { card: settled, revealed: revealedAnswer(session.policies[settled.queueItemId]) };
  }
  if (kind === "skip" || kind === "follow-other-line") return { card: settled };
  throw new Error("Invalid queueItemId: not the current card of this rehearsal");
}

function rehearsalHint(turn: CardTurn): PracticeActionResult {
  const { session, card, index, policy } = turn;
  // A changed chapter ends the rehearsal before a hint is given (or recorded) on its old card.
  if (!currentRehearsal(session)) {
    finishStale(session);
    return saved(turn, { card: session.cards[index], sessionEnded: true });
  }
  recordAction(turn, { kind: "hint", isFinalGrade: false, outcome: null });
  card.hintStage = nextHintStage(card.hintStage);
  session.cards[index] = card;
  return saved(turn, {
    card,
    revealed: {
      ucis: [],
      preferredUci: card.hintStage >= 2 ? policy.preferredUci : null,
      explanation: policy.hint
    }
  });
}

/** Reveal: an unanswered card is missed; the line's move is played and the line goes on. */
function revealLineMove(
  turn: CardTurn,
  rehearsal: Rehearsal,
  revealed: NonNullable<PracticeActionResult["revealed"]>
): PracticeActionResult {
  const { session, card, index, history } = turn;
  if (card.state === "unanswered") {
    recordAction(turn, {
      kind: "reveal",
      isFinalGrade: true,
      outcome: firstAnswerOutcome([...gradedHistory(history), { kind: "reveal" }])
    });
    card.state = "revealed";
  } else {
    recordAction(turn, { kind: "reveal", isFinalGrade: false, outcome: null });
  }
  session.cards[index] = card;
  const child = nextOnRoute(rehearsal.context.lookup, card.nodeId, rehearsal.state.lineEnd)!;
  const step = continueLine(session, rehearsal, child.id, card.rehearsal?.stepIndex ?? 0);
  return saved(turn, { card, rehearsal: step, revealed });
}

/** Skip: the current line is abandoned (not completed) and the next one starts. */
function skipLine(turn: CardTurn, rehearsal: Rehearsal): PracticeActionResult {
  const { session, card, index } = turn;
  const unanswered = card.state === "unanswered";
  recordAction(turn, {
    kind: "skip",
    isFinalGrade: false,
    outcome: unanswered ? "no-change" : null
  });
  if (unanswered) card.state = "skipped";
  session.cards[index] = card;
  finishLine(rehearsal.state, false);
  const next = startNextLine(session, rehearsal);
  return saved(turn, {
    card,
    rehearsal: { reply: null, next, lineComplete: false, endReason: null }
  });
}

/** Follow-other-line: the answer from another line of the same chapter is played from there. */
function followOtherLine(
  turn: CardTurn,
  rehearsal: Rehearsal,
  lastAction: AttemptRecord
): PracticeActionResult {
  const { session, card, index, history } = turn;
  const other = parseStoredJson<AttemptResult>(lastAction.resultJson!).otherLine;
  if (!other) {
    throw new Error("Invalid action: follow-other-line needs an answer from another line first");
  }
  if (other.chapterId !== rehearsal.chapter.id) {
    throw new Error("Invalid action: that line is in another chapter; rehearse it from there");
  }
  // A followed answer is a correct recall of the player's own choice (unaided unless a hint was
  // taken first): its final row keeps the summary in step with the live "Correct" count. Nothing
  // is scheduled in a rehearsal.
  const unanswered = card.state === "unanswered";
  recordAction(turn, {
    kind: "attempt",
    isFinalGrade: unanswered,
    outcome: unanswered
      ? firstAnswerOutcome([
          ...gradedHistory(history),
          { kind: "attempt", legal: true, correct: true }
        ])
      : null,
    correct: true
  });
  if (unanswered) card.state = "answered-correct";
  session.cards[index] = card;
  // Following starts a new line from that occurrence; a line already finished this session is
  // only replayed when nothing else is left below it (and isn't counted again).
  const plan = planRoute(rehearsal.context, other.nodeId, {
    pending: pendingLines(rehearsal),
    seen: rehearsal.state.seen,
    finished: new Set(rehearsal.state.finished)
  });
  startLine(rehearsal.state, plan.endNodeId);
  const step = continueLine(session, rehearsal, other.nodeId, card.rehearsal?.stepIndex ?? 0);
  return saved(turn, { card, rehearsal: step });
}
