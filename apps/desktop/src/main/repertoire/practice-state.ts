/**
 * What review practice and rehearsal share (design §8.3): session snapshots, card lookup, frozen
 * answers, grading history and scheduling.
 */
import {
  type PracticeAnswer,
  type PracticeCard,
  type PracticeSessionSnapshot,
  type PracticeTotals
} from "@chaturanga/shared/types/repertoire";
import { type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  scheduleAfterOutcome,
  type PracticeHistoryAction,
  type PracticeOutcome
} from "@chaturanga/shared/chess/repertoire-scheduler";
import { normalizeUci } from "./chapter-validation";
import { decisionRepository, progressRepository, repertoireRepository } from "./repository";
import {
  attemptRepository,
  sessionRepository,
  type AttemptRecord,
  type FrozenPolicy,
  type PracticeSessionRecord
} from "./practice-repository";
import { changed, clock } from "./service-runtime";

/** The next hint stage, up to the last (3). */
export function nextHintStage(stage: PracticeCard["hintStage"]): PracticeCard["hintStage"] {
  return stage === 0 ? 1 : stage === 1 ? 2 : 3;
}

function totalsOf(cards: readonly PracticeCard[]): PracticeTotals {
  const count = (state: PracticeCard["state"]) =>
    cards.filter((card) => card.state === state).length;
  const correct = count("answered-correct");
  const wrong = count("answered-wrong");
  const revealed = count("revealed");
  return {
    total: cards.length,
    answered: correct + wrong + revealed,
    correct,
    wrong,
    revealed,
    skipped: count("skipped"),
    remaining: count("unanswered")
  };
}

export function snapshotOf(session: PracticeSessionRecord): PracticeSessionSnapshot {
  const snapshot: PracticeSessionSnapshot = {
    sessionId: session.id,
    repertoireId: session.repertoireId,
    mode: session.mode,
    scope: session.scope,
    status: session.status,
    cursor: session.cursor,
    cards: session.cards,
    totals: totalsOf(session.cards)
  };
  // No card when the queue is empty.
  const card = session.cards.at(session.cursor);
  const policy = card ? session.policies[card.queueItemId] : undefined;
  if (!card || !policy) return snapshot;
  // A reveal after a wrong answer leaves the card answered-wrong; its recorded action says so.
  const revealed =
    card.state === "revealed" ||
    (card.state === "answered-wrong" &&
      attemptRepository
        .list(session.id, card.queueItemId)
        .some((attempt) => attempt.kind === "reveal"));
  if (!card.hintStage && !revealed) return snapshot;
  // Only what the hint and reveal actions already returned for this card.
  return {
    ...snapshot,
    shown: {
      hint: card.hintStage >= 1 ? policy.hint : null,
      hintUci:
        card.hintStage >= 2 ? (policy.preferredUci ?? policy.acceptedUcis.at(0) ?? null) : null,
      revealed: revealed ? answerOf(policy) : null
    }
  };
}

/**
 * A card's answer as the page shows it once the grade is final: the accepted moves, the
 * position's explanation (its comment, else the hint) and the accepted moves' own comments.
 */
export function answerOf(policy: FrozenPolicy): PracticeAnswer {
  return {
    ucis: policy.acceptedUcis,
    preferredUci: policy.preferredUci,
    explanation: policy.explanation ?? policy.hint,
    ...(policy.moveComments ? { moveComments: policy.moveComments } : {})
  };
}

/** The comments of the accepted moves played from `nodeId` in its chapter, by UCI. */
export function acceptedMoveComments(
  lookup: ChapterLookup,
  nodeId: string,
  accepted: readonly string[]
): Record<string, string> {
  const comments: Record<string, string> = {};
  for (const id of lookup.childrenById.get(nodeId) ?? []) {
    const child = lookup.nodesById.get(id);
    const comment = child?.comment?.trim();
    if (!child?.uci || !comment) continue;
    const uci = normalizeUci(child.fenBefore, child.uci);
    if (accepted.includes(uci)) comments[uci] = comment;
  }
  return comments;
}

/** The next unanswered card after `from` (wrapping), or `from` when none is left. */
export function nextCursor(cards: readonly PracticeCard[], from: number): number {
  for (let offset = 1; offset <= cards.length; offset += 1) {
    const index = (from + offset) % cards.length;
    if (cards[index].state === "unanswered") return index;
  }
  return Math.max(0, Math.min(from, cards.length - 1));
}

export function requireSession(sessionId: string): PracticeSessionRecord {
  const session = sessionRepository.get(sessionId);
  if (!session) throw new Error("Invalid sessionId: not found");
  return session;
}

export function requireActiveSession(sessionId: string): PracticeSessionRecord {
  const session = requireSession(sessionId);
  if (session.status !== "active")
    throw new Error("Invalid sessionId: this practice session has ended");
  return session;
}

export function cardIndex(session: PracticeSessionRecord, queueItemId: string): number {
  const index = session.cards.findIndex((card) => card.queueItemId === queueItemId);
  if (index < 0) throw new Error("Invalid queueItemId: not in this practice session");
  return index;
}

/**
 * A card can still be graded: its repertoire isn't archived, and the decision it was frozen from
 * is unchanged (same accepted set, supported, not paused) and not graded since by another session.
 */
export function stillCurrent(
  repertoireId: string,
  positionKey: string,
  policy: FrozenPolicy
): boolean {
  if (repertoireRepository.get(repertoireId)?.archivedAt !== null) return false;
  const decision = decisionRepository.get(repertoireId, positionKey);
  if (
    !decision ||
    decision.paused ||
    decision.acceptanceFingerprint !== policy.fingerprint ||
    !decisionRepository.isSupported(repertoireId, positionKey)
  ) {
    return false;
  }
  if (policy.progressAt === undefined) return true;
  const progress = progressRepository.get(repertoireId, positionKey);
  return (progress?.lastAttemptAt ?? null) === policy.progressAt;
}

export function historyAction(attempt: AttemptRecord): PracticeHistoryAction {
  if (attempt.kind === "attempt") {
    return { kind: "attempt", legal: attempt.legal, correct: attempt.correct };
  }
  return { kind: attempt.kind };
}

/**
 * Applies a card's final outcome to its progress (scheduler v1). Callers first check the card is
 * still current (§8.3: no grade against a moving set). Returns whether it was written. An
 * ungraded session's outcome is recorded with the session only: progress stays as it was.
 */
export function applySchedule(
  session: PracticeSessionRecord,
  card: PracticeCard,
  outcome: PracticeOutcome,
  now: number
): boolean {
  if (session.scope.ungraded) return false;
  const { repertoireId } = session;
  const previous = progressRepository.get(repertoireId, card.positionKey);
  const schedule = scheduleAfterOutcome(previous, outcome, now, previous?.lastAttemptAt);
  if (!schedule) return false;
  progressRepository.upsert({
    repertoireId,
    positionKey: card.positionKey,
    ...schedule,
    // The policy the card was graded against.
    acceptanceFingerprint: session.policies[card.queueItemId].fingerprint,
    suspended: false
  });
  return true;
}

export const gradeIsFinal = (card: PracticeCard) =>
  card.state === "answered-correct" || card.state === "answered-wrong" || card.state === "revealed";

export function progressChanged(repertoireId: string): void {
  const record = repertoireRepository.get(repertoireId);
  if (record) changed({ repertoireId, revision: record.revision, kind: "progress" });
}

/**
 * The card an answer or action is for: a copy to update, its frozen policy, its actions so far,
 * and the time to record (never before the session's latest action).
 */
export type CardTurn = {
  session: PracticeSessionRecord;
  index: number;
  card: PracticeCard;
  policy: FrozenPolicy;
  history: AttemptRecord[];
  now: number;
};

export function cardTurn(session: PracticeSessionRecord, index: number): CardTurn {
  const card = { ...session.cards[index] };
  return {
    session,
    index,
    card,
    policy: session.policies[card.queueItemId],
    now: Math.max(clock(), attemptRepository.lastAt(session.id) ?? -Infinity),
    history: attemptRepository.list(session.id, card.queueItemId)
  };
}
