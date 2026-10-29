/** Practice sessions (design §8.3): starting, answering, resuming and ending them. */
import { nanoid } from "nanoid";
import type {
  AttemptResult,
  PracticeActionInput,
  PracticeActionResult,
  PracticeSessionSnapshot,
  PracticeSummary,
  RecordAttemptInput,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import {
  firstAnswerOutcome,
  orderQueue,
  type PracticeOutcome
} from "@chaturanga/shared/chess/repertoire-scheduler";
import { masteryOf } from "@chaturanga/shared/chess/repertoire-mastery";
import { requireRepertoire } from "./core";
import { fenAfterMove, normalizeUci } from "./chapter-validation";
import { transaction } from "./repository";
import { attemptRepository, sessionRepository, type AttemptRecord } from "./practice-repository";
import { parseStoredJson } from "../stored-json";
import {
  answerOf,
  applySchedule,
  cardIndex,
  cardRepertoireId,
  cardTurn,
  gradeIsFinal,
  historyAction,
  nextCursor,
  nextHintStage,
  progressChanged,
  requireActiveSession,
  requireSession,
  snapshotOf,
  stillCurrent,
  type CardTurn
} from "./practice-state";
import {
  OTHER_LINE,
  finishStale,
  loadRehearsal,
  rehearsalAction,
  rehearsalAttempt,
  startRehearsal
} from "./rehearsal";
import { clock } from "./service-runtime";
import { practiceSettings, remainingNewToday } from "./practice-limits";
import {
  frozenQueue,
  openSession,
  practiceCandidates,
  queueSources,
  type Candidate
} from "./practice-queue";
import { startWeakPractice } from "./weak-practice";

const DEFAULT_DUE_LIMIT = 20;
const DEFAULT_LEARN_LIMIT = 10;
/** Review adds at most this many new positions after the due ones (§4). */
const REVIEW_NEW_LIMIT = 10;

/**
 * Starts a session over the eligible decisions of the scope (enabled opening chapters, within the
 * depth limit, not paused, not suspended). Review due: due cards (overdue first) up to
 * `cardLimit` (20), then unseen ones up to `newCardLimit` and at most 10, never past today's new
 * limit. Learn new: unseen decisions only, up to `cardLimit` (10) and today's new limit. Practice
 * early: learning decisions not due yet, soonest first (`cardLimit`, 20). With `positionKeys` the
 * queue is exactly the named eligible decisions (in a set, each repertoire's at a named
 * position), in that order and whether or not they are due (learn new keeps only unseen ones);
 * the limits don't apply and being queued records nothing. An `ungraded` targeted queue ("Retry missed") records its answers
 * with the session only: no schedule changes. `repertoireIds` (a Practice tab set) queues several
 * repertoires' decisions together. Each card freezes its policy so grading never uses a moving
 * set; with "Show the move on new positions" a new card carries its move (first sight). Depth
 * counts plies from the chapter root including the tested move (§5.3).
 */
export function startPractice(input: StartPracticeInput): PracticeSessionSnapshot {
  const now = clock();
  return transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    if (record.archivedAt !== null) {
      throw new Error("Invalid practice: this repertoire is archived; restore it to practice");
    }
    if (input.mode === "rehearse-lines") return startRehearsal(input, record, now);
    if (input.mode === "weak") return startWeakPractice(input, record, now);
    const sources = queueSources(record, input);
    for (const id of input.chapterIds ?? []) {
      if (!sources[0].chapters.has(id)) {
        throw new Error(`Invalid chapterIds: "${id}" is not in this repertoire`);
      }
    }
    const settings = practiceSettings();
    const candidates = sources.flatMap((source) => practiceCandidates(source, input));
    const picked = pickedCandidates(candidates, input, now, remainingNewToday(now, settings));
    const { cards, policies } = frozenQueue(picked, {
      firstSight: settings.showMoveOnNew && !input.ungraded,
      set: Boolean(input.repertoireIds)
    });
    return openSession(record, input, { cards, policies }, now);
  });
}

/** The session's queue (see startPractice for the modes and limits). */
function pickedCandidates(
  candidates: readonly Candidate[],
  input: StartPracticeInput,
  now: number,
  remainingNew: number
): Candidate[] {
  const unseen = orderQueue(candidates.filter((candidate) => !candidate.practiced));
  if (input.positionKeys) {
    // A targeted queue: the named decisions that are eligible, in the given order, due or not. A
    // set's repertoires each have their own decision at a position (one per repertoire and key).
    const byKey = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = candidate.entry.positionKey;
      byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
    }
    return [...new Set(input.positionKeys)]
      .flatMap((key) => byKey.get(key) ?? [])
      .filter((candidate) => input.mode === "review-due" || !candidate.practiced);
  }
  if (input.mode === "learn-new") {
    return unseen.slice(0, Math.min(input.cardLimit ?? DEFAULT_LEARN_LIMIT, remainingNew));
  }
  if (input.mode === "practice-early") {
    // Learning cards not due yet, soonest first: they don't count as overdue reviews.
    return orderQueue(
      candidates.filter(
        (candidate) =>
          candidate.dueAt !== null &&
          candidate.dueAt > now &&
          masteryOf(candidate.progress) === "learning"
      )
    ).slice(0, input.cardLimit ?? DEFAULT_DUE_LIMIT);
  }
  const due = orderQueue(
    candidates.filter(
      (candidate) => candidate.practiced && candidate.dueAt !== null && candidate.dueAt <= now
    ),
    now
  ).slice(0, input.cardLimit ?? DEFAULT_DUE_LIMIT);
  const newLimit = Math.min(input.newCardLimit ?? REVIEW_NEW_LIMIT, REVIEW_NEW_LIMIT, remainingNew);
  return [...due, ...unseen.slice(0, newLimit)];
}

/**
 * Grades a submitted move. Idempotent on `attemptId` (a replay returns the stored result). The
 * first legal answer fixes the grade (with any earlier hint making it assisted); later retries of
 * a wrongly answered card are ungraded reinforcement. Illegal moves change nothing but are kept.
 * A card whose decision is no longer current is skipped ungraded (`stale`). The stored cursor moves
 * on only after a correct answer: a wrongly answered card stays current for its retries.
 */
export function recordAttempt(input: RecordAttemptInput): AttemptResult {
  // The repertoire whose schedule this changed: its progress is announced after the commit.
  let rescheduled: string | undefined;
  const result = transaction((): AttemptResult => {
    const prior = attemptRepository.get(input.attemptId);
    if (prior) return replayedAttempt(prior, input);
    const session = requireActiveSession(input.sessionId);
    if (session.mode === "rehearse-lines") return rehearsalAttempt(session, input);
    const turn = cardTurn(session, cardIndex(session, input.queueItemId));
    const { card, policy, history, index, now } = turn;
    const uci = normalizeUci(card.fen, input.uci);
    const grade = gradeAnswer(turn, uci);
    if (grade.rescheduled) rescheduled = cardRepertoireId(session, card);
    const result = attemptResultOf(turn, uci, grade);
    attemptRepository.insert({
      attemptId: input.attemptId,
      sessionId: session.id,
      queueItemId: card.queueItemId,
      sequence: (history.at(-1)?.sequence ?? 0) + 1,
      kind: "attempt",
      uci,
      legal: grade.legal,
      correct: grade.correct,
      isFinalGrade: grade.finalGrade,
      outcome: grade.gradeOutcome,
      positionKey: card.positionKey,
      fingerprint: policy.fingerprint,
      resultJson: JSON.stringify(result),
      at: now
    });
    session.cards[index] = card;
    if (grade.outcome === "correct" || grade.outcome === "stale") {
      session.cursor = nextCursor(session.cards, index);
    }
    session.updatedAt = now;
    sessionRepository.save(session);
    return result;
  });
  if (rescheduled !== undefined) progressChanged(rescheduled);
  return result;
}

/** A replayed attempt id returns what was stored; one already used for another card is refused. */
function replayedAttempt(prior: AttemptRecord, input: RecordAttemptInput): AttemptResult {
  if (
    prior.sessionId !== input.sessionId ||
    prior.queueItemId !== input.queueItemId ||
    !prior.resultJson
  ) {
    throw new Error("Invalid attemptId: already used for another card");
  }
  return parseStoredJson<AttemptResult>(prior.resultJson);
}

/** What an answer was, and whether it fixed the card's grade (and changed its schedule). */
type Grade = {
  outcome: AttemptResult["outcome"];
  legal: boolean;
  correct: boolean;
  finalGrade: boolean;
  gradeOutcome: PracticeOutcome | null;
  rescheduled: boolean;
};

/**
 * Grades `uci` on the turn's card (updating the card): a final card or an illegal move changes
 * nothing; a stale card is skipped; the first legal answer to an unanswered card fixes its grade
 * and schedule; later answers to a wrongly answered card only count as retries.
 */
function gradeAnswer(turn: CardTurn, uci: string): Grade {
  const { session, card, policy, history, now } = turn;
  const legal = fenAfterMove(card.fen, uci) !== null;
  const correct = legal && policy.acceptedUcis.includes(uci);
  const ungraded = (outcome: AttemptResult["outcome"]): Grade => ({
    outcome,
    legal,
    correct,
    finalGrade: false,
    gradeOutcome: null,
    rescheduled: false
  });
  if (card.state === "answered-correct" || card.state === "revealed" || card.state === "skipped")
    return ungraded("already-final");
  if (!legal) return ungraded("illegal");
  if (
    card.state === "unanswered" &&
    !stillCurrent(cardRepertoireId(session, card), card.positionKey, policy)
  ) {
    card.state = "skipped";
    return ungraded("stale");
  }
  const outcome = correct ? "correct" : "outside-repertoire";
  card.attemptsSoFar += 1;
  if (card.state !== "unanswered") return ungraded(outcome);
  if (card.preview) {
    // First sight: the move was shown, so playing it is "seen" (learning, no success credit);
    // another move changes nothing and the card waits for the shown one.
    if (!correct) return ungraded(outcome);
    card.state = "answered-correct";
    return {
      outcome,
      legal,
      correct,
      finalGrade: true,
      gradeOutcome: "seen",
      rescheduled: applySchedule(session, card, "seen", now)
    };
  }
  const gradeOutcome = firstAnswerOutcome([
    ...history.map(historyAction),
    { kind: "attempt", legal: true, correct }
  ]);
  card.state = correct ? "answered-correct" : "answered-wrong";
  return {
    outcome,
    legal,
    correct,
    finalGrade: true,
    gradeOutcome,
    rescheduled: applySchedule(session, card, gradeOutcome, now)
  };
}

function attemptResultOf({ card, policy }: CardTurn, uci: string, grade: Grade): AttemptResult {
  // A wrong answer shows the move to play to continue ("Not 1…e5. Your move here is 1…c6."); the
  // grade stays as that first answer left it. Any other final state shows the accepted set.
  const revealed = gradeIsFinal(card);
  const answer = revealed ? answerOf(policy) : null;
  return {
    outcome: grade.outcome,
    acceptedUcis: answer?.ucis ?? [],
    preferredUci: answer?.preferredUci ?? null,
    ...(answer
      ? {
          explanation: answer.explanation,
          ...(answer.moveComments ? { moveComments: answer.moveComments } : {})
        }
      : {}),
    feedback:
      grade.outcome === "outside-repertoire" ? (policy.wrongMoveFeedback[uci] ?? null) : null,
    card,
    finalGrade: grade.finalGrade
  };
}

/**
 * Hint, reveal or skip, persisted before the result is returned. Hints raise the card's hint
 * stage (1: authored hint; 2: the piece of the preferred move; 3: its squares) and make a later
 * correct answer assisted. Reveal fixes an unanswered card's grade as a lapse; skip leaves the
 * schedule unchanged.
 */
export function recordPracticeAction(input: PracticeActionInput): PracticeActionResult {
  // The repertoire whose schedule this changed: its progress is announced after the commit.
  let rescheduled: string | undefined;
  const result = transaction((): PracticeActionResult => {
    const session = requireActiveSession(input.sessionId);
    if (session.mode === "rehearse-lines") return rehearsalAction(session, input);
    const { index, card, policy, history, now } = cardTurn(
      session,
      cardIndex(session, input.queueItemId)
    );
    const kind = input.action.kind;
    if (kind === "follow-other-line") {
      throw new Error("Invalid action: follow-other-line is only for rehearse-lines");
    }
    const persist = (isFinalGrade: boolean, outcome: PracticeOutcome | null) =>
      attemptRepository.insert({
        attemptId: nanoid(),
        sessionId: session.id,
        queueItemId: card.queueItemId,
        sequence: (history.at(-1)?.sequence ?? 0) + 1,
        kind,
        uci: null,
        legal: true,
        correct: false,
        isFinalGrade,
        outcome,
        positionKey: card.positionKey,
        fingerprint: policy.fingerprint,
        resultJson: null,
        at: now
      });

    let revealed: PracticeActionResult["revealed"];
    if (kind === "hint") {
      persist(false, null);
      card.hintStage = nextHintStage(card.hintStage);
      revealed = {
        ucis: [],
        preferredUci:
          card.hintStage >= 2 ? (policy.preferredUci ?? policy.acceptedUcis.at(0) ?? null) : null,
        explanation: policy.hint
      };
    } else if (kind === "reveal") {
      if (
        card.state === "unanswered" &&
        !stillCurrent(cardRepertoireId(session, card), card.positionKey, policy)
      ) {
        // No grade against a changed decision: the card is skipped, the frozen answer still shown.
        persist(false, null);
        card.state = "skipped";
        session.cursor = nextCursor(session.cards, index);
      } else if (card.state === "unanswered") {
        const outcome = firstAnswerOutcome([...history.map(historyAction), { kind: "reveal" }]);
        persist(true, outcome);
        card.state = "revealed";
        if (applySchedule(session, card, outcome, now)) {
          rescheduled = cardRepertoireId(session, card);
        }
        session.cursor = nextCursor(session.cards, index);
      } else if (card.state === "answered-wrong") {
        persist(false, null);
      }
      revealed = answerOf(policy);
    } else if (card.state === "unanswered") {
      persist(false, "no-change");
      card.state = "skipped";
      session.cursor = nextCursor(session.cards, index);
    }

    session.cards[index] = card;
    session.updatedAt = now;
    sessionRepository.save(session);
    return revealed ? { card, revealed } : { card };
  });
  if (rescheduled !== undefined) progressChanged(rescheduled);
  return result;
}

/**
 * Reopens a session. When the repertoire changed since the session froze its policies, unanswered
 * cards that are no longer current (see stillCurrent) are dropped as skipped. A rehearsal keeps
 * its queue, cursor and line; if its chapter changed, the session is finished instead.
 */
export function resumePractice(sessionId: string): PracticeSessionSnapshot {
  const now = clock();
  return transaction(() => {
    const session = requireSession(sessionId);
    if (session.status === "finished") return snapshotOf(session);
    const record = requireRepertoire(session.repertoireId);
    if (record.revision !== session.snapshotRevision && session.mode === "rehearse-lines") {
      // A rehearsal is planned against one chapter revision: a changed chapter ends it.
      if (!loadRehearsal(session)) finishStale(session);
      session.snapshotRevision = record.revision;
      session.updatedAt = now;
      sessionRepository.save(session);
    } else if (record.revision !== session.snapshotRevision || session.scope.repertoireIds) {
      // A set's other repertoires may have changed too: each card is checked against its own.
      session.cards = session.cards.map((card) =>
        card.state === "unanswered" &&
        !stillCurrent(
          cardRepertoireId(session, card),
          card.positionKey,
          session.policies[card.queueItemId]
        )
          ? { ...card, state: "skipped" }
          : card
      );
      session.snapshotRevision = record.revision;
      if (session.cards.length && session.cards[session.cursor]?.state !== "unanswered") {
        session.cursor = nextCursor(session.cards, session.cursor);
      }
      session.updatedAt = now;
      sessionRepository.save(session);
    }
    return snapshotOf(session);
  });
}

/** Ends a session (idempotent) and summarises it from its recorded actions. */
export function endPractice(sessionId: string): PracticeSummary {
  const now = clock();
  return transaction(() => {
    const session = requireSession(sessionId);
    if (session.status !== "finished") {
      session.status = "finished";
      session.updatedAt = now;
      sessionRepository.save(session);
    }
    const attempts = attemptRepository.list(session.id);
    const finals = attempts.filter((attempt) => attempt.isFinalGrade);
    const countOf = (...outcomes: string[]) =>
      finals.filter((attempt) => outcomes.includes(attempt.outcome ?? "")).length;
    return {
      sessionId: session.id,
      repertoireId: session.repertoireId,
      unaided: countOf("unaided"),
      assisted: countOf("assisted"),
      missed: countOf("wrong", "reveal"),
      skipped: session.cards.filter((card) => card.state === "skipped").length,
      chapters: session.rehearsal
        ? [session.rehearsal.chapterId]
        : [...new Set(session.cards.map((card) => card.chapterId))],
      ...(countOf("seen") ? { seen: countOf("seen") } : {}),
      missedPositionKeys: [
        ...new Set(
          finals
            .filter((attempt) => attempt.outcome === "wrong" || attempt.outcome === "reveal")
            .map((attempt) => attempt.positionKey)
        )
      ],
      ...(session.rehearsal
        ? {
            rehearsal: {
              linesStarted: session.rehearsal.linesStarted,
              linesCompleted: session.rehearsal.linesCompleted,
              otherLineAnswers: attempts.filter((attempt) => attempt.outcome === OTHER_LINE).length
            }
          }
        : {})
    };
  });
}
