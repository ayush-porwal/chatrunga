/**
 * Repertoire write core shared by the main process (service.ts) and the import writer worker
 * (import-writer-worker.ts): revision checks, the derived-state rebuild (reindex) and the import
 * commit. No Electron import: queries run on whichever connection the thread registered
 * (connection.ts).
 */
import { nanoid } from "nanoid";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_NOT_FOUND_ERROR,
  REPERTOIRE_ROOT_NODE_ID,
  type ChapterKind,
  type ImportResult,
  type RepertoireChapter,
  type RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  acceptanceFingerprint,
  buildChapterLookup,
  collectDecisions,
  computeScopeStates,
  defaultImportNodeMeta,
  effectiveAcceptedUcis,
  reconcileDecisions,
  type CollectedDecision
} from "@chaturanga/shared/chess/repertoire-index";
import { chapterTitle, sanitizeHeaders } from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  positionIndexRepository,
  progressRepository,
  repertoireRepository,
  transaction,
  workspaceRepository,
  type PositionIndexRow,
  type RepertoireRecord,
  type StoredDecision
} from "./repository";

export function requireRepertoire(id: string): RepertoireRecord {
  const record = repertoireRepository.get(id);
  if (!record) throw new Error(REPERTOIRE_NOT_FOUND_ERROR);
  return record;
}

/** Refuses a stale draft: the stored revision must be the one the caller started from. */
export function checkRevision(record: RepertoireRecord, expected: number): void {
  if (record.revision !== expected) {
    throw new Error(
      `Invalid expectedRevision: repertoire changed (stored ${record.revision}, expected ${expected})`
    );
  }
}

/** Bumps the repertoire's revision and saves it; returns the new record. */
export function bump(
  record: RepertoireRecord,
  now: number,
  patch: Partial<RepertoireRecord> = {}
): RepertoireRecord {
  const next: RepertoireRecord = {
    ...record,
    ...patch,
    revision: record.revision + 1,
    updatedAt: now
  };
  repertoireRepository.update(next);
  return next;
}

export function detail(id: string, now: number): RepertoireDetail {
  const summary = repertoireRepository.summary(id, now);
  if (!summary) throw new Error(REPERTOIRE_NOT_FOUND_ERROR);
  return {
    ...summary,
    chapters: chapterRepository.summaries(id, now),
    workspace: workspaceRepository.get(id)
  };
}

/** `positionKey` remembering each FEN's key, optionally seeded with keys computed elsewhere. */
export function memoizedPositionKey(seed?: Map<string, string>): (fen: string) => string {
  const keys = seed ?? new Map<string, string>();
  return (fen) => {
    let key = keys.get(fen);
    if (key === undefined) {
      key = positionKey(fen);
      keys.set(fen, key);
    }
    return key;
  };
}

/* ------------------------------------------------------------------ index and invalidation */

export type ReindexResult = { decisionsChanged: number; progressChanged: boolean };

/** Everything a reindex writes, computed from the chapters and decisions without writing. */
export type ReindexPlan = {
  collected: Map<string, CollectedDecision>;
  /** Every decision after reconciliation, by position key. */
  decisions: Map<string, StoredDecision>;
  /** The decisions to store (new, changed, or with a new acceptance fingerprint). */
  decisionUpserts: StoredDecision[];
  rows: PositionIndexRow[];
};

/**
 * Plans the rebuild of a repertoire's derived state from all of its chapters (design §8.3):
 * reconciled decisions and the position index rows. Pure apart from the inputs it is given, so a
 * caller may compute it before taking the write lock (the import writer does).
 */
export function planReindex(
  record: RepertoireRecord,
  chapters: readonly RepertoireChapter[],
  existing: readonly StoredDecision[],
  keyOf: (fen: string) => string = memoizedPositionKey()
): ReindexPlan {
  const collected = collectDecisions(record.color, chapters, keyOf);
  const { upserts } = reconcileDecisions(existing, collected, { repertoireId: record.id });

  const decisions = new Map(existing.map((decision) => [decision.positionKey, { ...decision }]));
  const touched = new Set<string>();
  for (const upsert of upserts) {
    const previous = decisions.get(upsert.positionKey);
    decisions.set(upsert.positionKey, {
      ...upsert,
      acceptanceFingerprint: previous?.acceptanceFingerprint ?? ""
    });
    touched.add(upsert.positionKey);
  }

  const decisionUpserts: StoredDecision[] = [];
  for (const decision of decisions.values()) {
    const entry = collected.get(decision.positionKey);
    const fingerprint = entry
      ? acceptanceFingerprint(effectiveAcceptedUcis(decision, entry.acceptedUcis))
      : "";
    if (fingerprint === decision.acceptanceFingerprint && !touched.has(decision.positionKey))
      continue;
    decision.acceptanceFingerprint = fingerprint;
    decisionUpserts.push(decision);
  }

  const occurrenceIds = new Set<string>();
  for (const entry of collected.values()) {
    for (const occurrence of entry.occurrences) {
      occurrenceIds.add(`${occurrence.chapterId}\u0000${occurrence.nodeId}`);
    }
  }
  const rows: PositionIndexRow[] = [];
  for (const chapter of chapters) {
    const lookup = buildChapterLookup(chapter, keyOf);
    const states = computeScopeStates(chapter, lookup);
    for (const nodeId of lookup.order) {
      rows.push({
        chapterId: chapter.id,
        nodeId,
        positionKey: lookup.positionKeys.get(nodeId)!,
        scopeState: states.get(nodeId)!,
        isDecision: occurrenceIds.has(`${chapter.id}\u0000${nodeId}`),
        ply: lookup.nodesById.get(nodeId)!.ply
      });
    }
  }
  return { collected, decisions, decisionUpserts, rows };
}

/**
 * Writes a planned reindex: the decisions, the position index rows (tagged with the record's
 * revision), and progress eligibility — a decision nothing supports is suspended; an accepted move
 * removed from its effective set makes it due now (no lapse); re-enabling identical choices just
 * unsuspends it, so its timestamps come back unchanged.
 */
export function applyReindex(
  record: RepertoireRecord,
  plan: ReindexPlan,
  now: number
): ReindexResult {
  for (const decision of plan.decisionUpserts) decisionRepository.upsert(decision, now);
  positionIndexRepository.replace(record.id, plan.rows, record.revision);

  let progressChanged = false;
  for (const progress of progressRepository.list(record.id)) {
    const entry = plan.collected.get(progress.positionKey);
    const decision = plan.decisions.get(progress.positionKey);
    const effective = entry && decision ? effectiveAcceptedUcis(decision, entry.acceptedUcis) : [];
    if (!effective.length) {
      if (!progress.suspended) {
        progressRepository.upsert({ ...progress, suspended: true });
        progressChanged = true;
      }
      continue;
    }
    const fingerprint = acceptanceFingerprint(effective);
    const next = { ...progress, suspended: false };
    if (fingerprint !== progress.acceptanceFingerprint) {
      const previous = progress.acceptanceFingerprint
        ? progress.acceptanceFingerprint.split(",")
        : [];
      if (previous.some((uci) => !effective.includes(uci))) next.dueAt = now;
      next.acceptanceFingerprint = fingerprint;
    }
    if (
      next.suspended !== progress.suspended ||
      next.dueAt !== progress.dueAt ||
      next.acceptanceFingerprint !== progress.acceptanceFingerprint
    ) {
      progressRepository.upsert(next);
      progressChanged = true;
    }
  }
  return { decisionsChanged: plan.decisionUpserts.length, progressChanged };
}

/** Rebuilds a repertoire's derived state from its stored chapters (see planReindex/applyReindex). */
export function reindex(record: RepertoireRecord, now: number): ReindexResult {
  const plan = planReindex(
    record,
    chapterRepository.list(record.id),
    decisionRepository.list(record.id)
  );
  return applyReindex(record, plan, now);
}

/* ------------------------------------------------------------------ import commit */

/** The tree without the excluded nodes and their subtrees. */
export function pruneTree(
  tree: readonly MoveNode[],
  excludeNodeIds: readonly string[]
): MoveNode[] {
  if (excludeNodeIds.includes(REPERTOIRE_ROOT_NODE_ID)) {
    throw new Error("Invalid excludeNodeIds: the root can't be excluded");
  }
  const byId = new Map(tree.map((node) => [node.id, node]));
  const dropped = new Set<string>();
  const pending = excludeNodeIds.filter((id) => byId.has(id));
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (dropped.has(id)) continue;
    dropped.add(id);
    pending.push(...byId.get(id)!.children);
  }
  return tree
    .filter((node) => !dropped.has(node.id))
    .map((node) => ({ ...node, children: node.children.filter((id) => !dropped.has(id)) }));
}

/** One selected game of a previewed import, as the commit receives it. */
export type ImportCommitChapter = {
  /** The title the user typed (blank: the proposed one). */
  title: string;
  proposedTitle: string;
  kind: ChapterKind;
  rootFen: string;
  headers: Record<string, string>;
  /** The validated tree from the preview. */
  tree: MoveNode[];
  excludeNodeIds: string[];
  /** Position keys the parse worker computed, by node id. */
  positionKeys: Record<string, string>;
};

export type ImportCommitJob = {
  repertoireId: string;
  expectedRevision: number;
  now: number;
  /** Most moves the selected games may hold together. */
  maxNodes: number;
  chapters: ImportCommitChapter[];
};

/**
 * Stores the selected games of an import as new chapters, atomically. Everything is prepared
 * before the write transaction — pruned trees, metadata, and the reindex plan built with the
 * worker's precomputed position keys — so the transaction itself only checks the revision again,
 * runs the inserts and bumps the revision; a change to the repertoire in between refuses the
 * commit with the stale-revision error and writes nothing.
 */
export function commitImportJob(job: ImportCommitJob): ImportResult {
  const { now } = job;
  const record = requireRepertoire(job.repertoireId);
  checkRevision(record, job.expectedRevision);
  const seed = new Map<string, string>();
  let totalNodes = 0;
  let sortOrder = chapterRepository.maxSortOrder(record.id) + 1;
  const prepared: RepertoireChapter[] = job.chapters.map((chapter) => {
    const tree = pruneTree(chapter.tree, chapter.excludeNodeIds);
    totalNodes += tree.length - 1;
    if (totalNodes > job.maxNodes) {
      throw new Error(
        `The selected games have more than ${job.maxNodes} moves; import them in parts.`
      );
    }
    for (const node of tree) {
      const key = chapter.positionKeys[node.id];
      if (key) seed.set(node.fenAfter, key);
    }
    return {
      id: nanoid(),
      title: chapterTitle(chapter.title, chapter.proposedTitle),
      sortOrder: sortOrder++,
      kind: chapter.kind,
      enabled: true,
      rootFen: chapter.rootFen,
      revision: 1,
      nodeCount: tree.length - 1,
      dueCount: 0,
      headers: sanitizeHeaders(chapter.headers),
      tree,
      nodeMeta: defaultImportNodeMeta(record.color, tree)
    };
  });
  const plan = planReindex(
    record,
    [...chapterRepository.list(record.id), ...prepared],
    decisionRepository.list(record.id),
    memoizedPositionKey(seed)
  );

  return transaction(() => {
    const current = requireRepertoire(job.repertoireId);
    checkRevision(current, job.expectedRevision);
    for (const chapter of prepared) chapterRepository.upsert(current.id, chapter, now);
    applyReindex(bump(current, now), plan, now);
    return { repertoire: detail(current.id, now), chaptersAdded: prepared.length };
  });
}
