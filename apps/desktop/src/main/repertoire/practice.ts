/** Practice sessions (design §8.3): starting, answering, resuming and ending them. */
import { nanoid } from "nanoid";
import { stripBookPage } from "@chaturanga/shared/books/book-page";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AttemptResult,
  type PracticeActionInput,
  type PracticeActionResult,
  type PracticeCard,
  type PracticeScope,
  type PracticeSessionSnapshot,
  type PracticeSummary,
  type RecordAttemptInput,
  type RepertoireChapter,
  type RepertoireProgress,
  type StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import {
  acceptanceFingerprint,
  buildChapterLookup,
  collectDecisions,
  effectiveAcceptedUcis,
  effectivePreferredUci,
  type ChapterLookup,
  type CollectedDecision,
  type DecisionOccurrence
} from "@chaturanga/shared/chess/repertoire-index";
import {
  firstAnswerOutcome,
  orderQueue,
  type PracticeOutcome
} from "@chaturanga/shared/chess/repertoire-scheduler";
import { requireRepertoire } from "./core";
import { fenAfterMove, normalizeUci } from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  progressRepository,
  transaction,
  type RepertoireRecord,
  type StoredDecision
} from "./repository";
import {
  attemptRepository,
  sessionRepository,
  type AttemptRecord,
  type FrozenPolicy,
  type PracticeSessionRecord
} from "./practice-repository";
import { parseStoredJson } from "../stored-json";
import {
  acceptedMoveComments,
  answerOf,
  applySchedule,
  cardIndex,
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

const DEFAULT_DUE_LIMIT = 20;
const DEFAULT_NEW_AFTER_DUE = 5;
const DEFAULT_LEARN_LIMIT = 10;

type Candidate = {
  entry: CollectedDecision;
  decision: StoredDecision;
  effective: string[];
  occurrence: DecisionOccurrence;
  practiced: boolean;
  dueAt: number | null;
  /** Plies from the occurrence's chapter root, including the tested move. */
  ply: number;
  chapterOrder: number;
};

/**
 * Starts a session over the eligible decisions of the scope (enabled opening chapters, within the
 * depth limit, not paused, not suspended). Review due: due cards (overdue first) up to
 * `cardLimit` (20), then up to `newCardLimit` (5) unseen ones. Learn new: unseen decisions only,
 * up to `cardLimit` (10). With `positionKeys` the queue is exactly the named eligible decisions,
 * in that order and whether or not they are due (learn new keeps only unseen ones); the limits
 * don't apply and being queued records nothing. An `ungraded` targeted queue ("Retry missed")
 * records its answers with the session only: no schedule changes. Each card freezes its policy so
 * grading never uses a moving set. Depth counts plies from the chapter root including the tested
 * move (§5.3).
 */
export function startPractice(input: StartPracticeInput): PracticeSessionSnapshot {
  const now = clock();
  return transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    if (record.archivedAt !== null) {
      throw new Error("Invalid practice: this repertoire is archived; restore it to practice");
    }
    if (input.mode === "rehearse-lines") return startRehearsal(input, record, now);
    const chapters = chapterRepository.list(record.id);
    const known = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    for (const id of input.chapterIds ?? []) {
      if (!known.has(id)) throw new Error(`Invalid chapterIds: "${id}" is not in this repertoire`);
    }
    const progress = new Map(
      progressRepository.list(record.id).map((item) => [item.positionKey, item])
    );
    const candidates = practiceCandidates(record, chapters, progress, input);
    const { cards, policies } = frozenQueue(
      record,
      known,
      pickedCandidates(candidates, input, now),
      progress
    );
    const session: PracticeSessionRecord = {
      id: nanoid(),
      repertoireId: record.id,
      mode: input.mode,
      scope: sessionScope(record.id, input),
      snapshotRevision: record.revision,
      cards,
      policies,
      cursor: 0,
      status: cards.length ? "active" : "finished",
      createdAt: now,
      updatedAt: now
    };
    sessionRepository.save(session);
    return snapshotOf(session);
  });
}

/**
 * The eligible decisions of the scope: not paused or suspended, with accepted moves, and an
 * occurrence in a chosen chapter within the depth limit (the shallowest, then the first chapter).
 */
function practiceCandidates(
  record: RepertoireRecord,
  chapters: readonly RepertoireChapter[],
  progress: ReadonlyMap<string, RepertoireProgress>,
  input: StartPracticeInput
): Candidate[] {
  const scope = input.chapterIds ? new Set(input.chapterIds) : null;
  const rootPlies = new Map(
    chapters.map((chapter) => [
      chapter.id,
      chapter.tree.find((node) => node.id === REPERTOIRE_ROOT_NODE_ID)?.ply ?? 0
    ])
  );
  const decisions = new Map(
    decisionRepository.list(record.id).map((item) => [item.positionKey, item])
  );
  const candidates: Candidate[] = [];
  for (const entry of collectDecisions(record.color, chapters).values()) {
    const decision = decisions.get(entry.positionKey);
    const stored = progress.get(entry.positionKey);
    if (!decision || decision.paused || stored?.suspended) continue;
    const effective = effectiveAcceptedUcis(decision, entry.acceptedUcis);
    if (!effective.length) continue;
    // Depth from the chapter root, so chapters starting at different move numbers compare fairly.
    const inScope = entry.occurrences
      .filter((occurrence) => !scope || scope.has(occurrence.chapterId))
      .map((occurrence) => ({
        occurrence,
        depth: occurrence.ply - rootPlies.get(occurrence.chapterId)! + 1
      }))
      .filter(({ depth }) => input.maxDepthPlies === undefined || depth <= input.maxDepthPlies)
      .sort((a, b) => a.depth - b.depth || a.occurrence.chapterOrder - b.occurrence.chapterOrder);
    if (!inScope.length) continue;
    candidates.push({
      entry,
      decision,
      effective,
      occurrence: inScope[0].occurrence,
      practiced: Boolean(stored),
      dueAt: stored?.dueAt ?? null,
      ply: inScope[0].depth,
      chapterOrder: inScope[0].occurrence.chapterOrder
    });
  }
  return candidates;
}

/** The session's queue (see startPractice for the modes and limits). */
function pickedCandidates(
  candidates: readonly Candidate[],
  input: StartPracticeInput,
  now: number
): Candidate[] {
  const unseen = orderQueue(candidates.filter((candidate) => !candidate.practiced));
  if (input.positionKeys) {
    // A targeted queue: the named decisions that are eligible, in the given order, due or not.
    const byKey = new Map(candidates.map((candidate) => [candidate.entry.positionKey, candidate]));
    return [...new Set(input.positionKeys)]
      .map((key) => byKey.get(key))
      .filter((candidate): candidate is Candidate => candidate !== undefined)
      .filter((candidate) => input.mode === "review-due" || !candidate.practiced);
  }
  if (input.mode === "learn-new") return unseen.slice(0, input.cardLimit ?? DEFAULT_LEARN_LIMIT);
  const due = orderQueue(
    candidates.filter(
      (candidate) => candidate.practiced && candidate.dueAt !== null && candidate.dueAt <= now
    ),
    now
  ).slice(0, input.cardLimit ?? DEFAULT_DUE_LIMIT);
  return [...due, ...unseen.slice(0, input.newCardLimit ?? DEFAULT_NEW_AFTER_DUE)];
}

/** The queue's cards, each with the policy it freezes for grading. */
function frozenQueue(
  record: RepertoireRecord,
  chapters: ReadonlyMap<string, RepertoireChapter>,
  picked: readonly Candidate[],
  progress: ReadonlyMap<string, RepertoireProgress>
): { cards: PracticeCard[]; policies: Record<string, FrozenPolicy> } {
  const lookups = new Map<string, ChapterLookup>();
  const lookupOf = (chapterId: string) => {
    let lookup = lookups.get(chapterId);
    if (!lookup) {
      lookup = buildChapterLookup(chapters.get(chapterId)!);
      lookups.set(chapterId, lookup);
    }
    return lookup;
  };
  const cards: PracticeCard[] = [];
  const policies: Record<string, FrozenPolicy> = {};
  picked.forEach((candidate, index) => {
    const { chapterId, nodeId } = candidate.occurrence;
    const lookup = lookupOf(chapterId);
    const node = lookup.nodesById.get(nodeId)!;
    const queueItemId = `q${index + 1}`;
    cards.push({
      queueItemId,
      positionKey: candidate.entry.positionKey,
      fen: node.fenAfter,
      orientation: record.color,
      leadUp: lookup.parentPath
        .get(nodeId)!
        .slice(1)
        .map((id) => {
          const move = lookup.nodesById.get(id)!;
          return { san: move.san ?? "", uci: move.uci ?? "", fen: move.fenAfter };
        }),
      chapterId,
      nodeId,
      prompt: candidate.decision.prompt,
      stage: candidate.practiced ? "review" : "new",
      state: "unanswered",
      hintStage: 0,
      attemptsSoFar: 0
    });
    policies[queueItemId] = {
      acceptedUcis: candidate.effective,
      preferredUci: effectivePreferredUci(candidate.decision, candidate.entry.acceptedUcis),
      fingerprint: acceptanceFingerprint(candidate.effective),
      hint: candidate.decision.hint,
      wrongMoveFeedback: candidate.decision.wrongMoveFeedback,
      explanation: stripBookPage(node.comment),
      moveComments: acceptedMoveComments(lookup, nodeId, candidate.effective),
      progressAt: progress.get(candidate.entry.positionKey)?.lastAttemptAt ?? null
    };
  });
  return { cards, policies };
}

/** What the session was started over, kept with it (only the options that were given). */
function sessionScope(repertoireId: string, input: StartPracticeInput): PracticeScope {
  return {
    repertoireId,
    ...(input.chapterIds ? { chapterIds: [...input.chapterIds] } : {}),
    ...(input.maxDepthPlies !== undefined ? { maxDepthPlies: input.maxDepthPlies } : {}),
    ...(input.cardLimit !== undefined ? { cardLimit: input.cardLimit } : {}),
    ...(input.newCardLimit !== undefined ? { newCardLimit: input.newCardLimit } : {}),
    ...(input.positionKeys ? { positionKeys: [...input.positionKeys] } : {}),
    ...(input.ungraded && input.positionKeys?.length ? { ungraded: true } : {})
  };
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
    if (grade.rescheduled) rescheduled = session.repertoireId;
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
    !stillCurrent(session.repertoireId, card.positionKey, policy)
  ) {
    card.state = "skipped";
    return ungraded("stale");
  }
  const outcome = correct ? "correct" : "outside-repertoire";
  card.attemptsSoFar += 1;
  if (card.state !== "unanswered") return ungraded(outcome);
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
  // A wrong answer keeps the answer hidden so the card can be retried (§5.3); a correct retry,
  // like any other final state, shows the accepted set.
  const revealed = card.state === "answered-wrong" ? grade.correct : gradeIsFinal(card);
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
        !stillCurrent(session.repertoireId, card.positionKey, policy)
      ) {
        // No grade against a changed decision: the card is skipped, the frozen answer still shown.
        persist(false, null);
        card.state = "skipped";
        session.cursor = nextCursor(session.cards, index);
      } else if (card.state === "unanswered") {
        const outcome = firstAnswerOutcome([...history.map(historyAction), { kind: "reveal" }]);
        persist(true, outcome);
        card.state = "revealed";
        if (applySchedule(session, card, outcome, now)) rescheduled = session.repertoireId;
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
    } else if (record.revision !== session.snapshotRevision) {
      session.cards = session.cards.map((card) =>
        card.state === "unanswered" &&
        !stillCurrent(record.id, card.positionKey, session.policies[card.queueItemId])
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
