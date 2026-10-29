/**
 * Building a practice queue (design §8.3): the repertoires a session draws from, their eligible
 * decisions, and the cards each freezes its grading policy into. Review, learn new, practice early
 * and weak-spots sessions all queue through here.
 */
import { nanoid } from "nanoid";
import { stripBookPage } from "@chaturanga/shared/books/book-page";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type PracticeCard,
  type PracticeScope,
  type PracticeSessionSnapshot,
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
  chapterRepository,
  decisionRepository,
  progressRepository,
  repertoireRepository,
  type RepertoireRecord,
  type StoredDecision
} from "./repository";
import {
  sessionRepository,
  type FrozenPolicy,
  type PracticeSessionRecord
} from "./practice-repository";
import { acceptedMoveComments, snapshotOf } from "./practice-state";

/** A repertoire a queue draws from, with its chapters by id. */
export type QueueSource = {
  record: RepertoireRecord;
  chapters: ReadonlyMap<string, RepertoireChapter>;
};

export type Candidate = {
  source: QueueSource;
  entry: CollectedDecision;
  decision: StoredDecision;
  effective: string[];
  occurrence: DecisionOccurrence;
  practiced: boolean;
  progress: RepertoireProgress | null;
  dueAt: number | null;
  /** Plies from the occurrence's chapter root, including the tested move. */
  ply: number;
  chapterOrder: number;
};

/**
 * The repertoires a session draws from: the one named, or a set's (its active repertoires, the
 * named one first; ids that are gone or archived are left out).
 */
export function queueSources(record: RepertoireRecord, input: StartPracticeInput): QueueSource[] {
  const ids = input.repertoireIds ? [...new Set([record.id, ...input.repertoireIds])] : [record.id];
  if (input.repertoireIds && input.chapterIds) {
    throw new Error("Invalid practice: a set of repertoires can't name chapters");
  }
  return ids.flatMap((id) => {
    const source = id === record.id ? record : repertoireRepository.get(id);
    if (!source || source.archivedAt !== null) return [];
    return [queueSource(source)];
  });
}

/** A repertoire's chapters, read for a queue. */
function queueSource(record: RepertoireRecord): QueueSource {
  return {
    record,
    chapters: new Map(chapterRepository.list(record.id).map((chapter) => [chapter.id, chapter]))
  };
}

/**
 * The eligible decisions of the scope: not paused or suspended, with accepted moves, and an
 * occurrence in a chosen chapter within the depth limit (the shallowest, then the first chapter).
 */
export function practiceCandidates(
  source: QueueSource,
  input: Pick<StartPracticeInput, "chapterIds" | "maxDepthPlies">
): Candidate[] {
  const { record } = source;
  const chapters = [...source.chapters.values()];
  const progress = new Map(
    progressRepository.list(record.id).map((item) => [item.positionKey, item])
  );
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
      source,
      entry,
      decision,
      effective,
      occurrence: inScope[0].occurrence,
      practiced: Boolean(stored),
      progress: stored ?? null,
      dueAt: stored?.dueAt ?? null,
      ply: inScope[0].depth,
      chapterOrder: inScope[0].occurrence.chapterOrder
    });
  }
  return candidates;
}

/**
 * The queue's cards, each with the policy it freezes for grading. `firstSight`: new cards carry
 * their move (shown before they are asked). `set`: cards name their repertoire and chapter.
 */
export function frozenQueue(
  picked: readonly (Candidate & { weakGames?: number })[],
  { firstSight, set }: { firstSight: boolean; set: boolean }
): { cards: PracticeCard[]; policies: Record<string, FrozenPolicy> } {
  const lookups = new Map<string, ChapterLookup>();
  const lookupOf = (source: QueueSource, chapterId: string) => {
    let lookup = lookups.get(chapterId);
    if (!lookup) {
      lookup = buildChapterLookup(source.chapters.get(chapterId)!);
      lookups.set(chapterId, lookup);
    }
    return lookup;
  };
  const cards: PracticeCard[] = [];
  const policies: Record<string, FrozenPolicy> = {};
  picked.forEach((candidate, index) => {
    const { record } = candidate.source;
    const { chapterId, nodeId } = candidate.occurrence;
    const lookup = lookupOf(candidate.source, chapterId);
    const node = lookup.nodesById.get(nodeId)!;
    const queueItemId = `q${index + 1}`;
    const preferredUci = effectivePreferredUci(candidate.decision, candidate.entry.acceptedUcis);
    const previewUci = preferredUci ?? candidate.effective[0];
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
      attemptsSoFar: 0,
      ...(set
        ? {
            repertoireId: record.id,
            chapterTitle: candidate.source.chapters.get(chapterId)!.title
          }
        : {}),
      ...(firstSight && !candidate.practiced && previewUci ? { preview: { uci: previewUci } } : {}),
      ...(candidate.weakGames !== undefined ? { weakGames: candidate.weakGames } : {})
    });
    policies[queueItemId] = {
      acceptedUcis: candidate.effective,
      preferredUci,
      fingerprint: acceptanceFingerprint(candidate.effective),
      hint: candidate.decision.hint,
      wrongMoveFeedback: candidate.decision.wrongMoveFeedback,
      explanation: stripBookPage(node.comment),
      moveComments: acceptedMoveComments(lookup, nodeId, candidate.effective),
      progressAt: candidate.progress?.lastAttemptAt ?? null
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
    ...(input.ungraded && input.positionKeys?.length ? { ungraded: true } : {}),
    ...(input.repertoireIds ? { repertoireIds: [...input.repertoireIds] } : {})
  };
}

/** Stores a new session over the queue (finished at once when it is empty) and returns it. */
export function openSession(
  record: RepertoireRecord,
  input: StartPracticeInput,
  queue: { cards: PracticeCard[]; policies: Record<string, FrozenPolicy> },
  now: number
): PracticeSessionSnapshot {
  const session: PracticeSessionRecord = {
    id: nanoid(),
    repertoireId: record.id,
    mode: input.mode,
    scope: sessionScope(record.id, input),
    snapshotRevision: record.revision,
    cards: queue.cards,
    policies: queue.policies,
    cursor: 0,
    status: queue.cards.length ? "active" : "finished",
    createdAt: now,
    updatedAt: now
  };
  sessionRepository.save(session);
  return snapshotOf(session);
}
