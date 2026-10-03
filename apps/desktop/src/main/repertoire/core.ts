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
  type RepertoireDecision,
  type RepertoireDetail,
  type RepertoireProgress
} from "@chaturanga/shared/types/repertoire";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  acceptanceFingerprint,
  buildChapterLookup,
  chapterDecisionNodes,
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

/** The shared decision type, without the stored fingerprint. */
export function stripFingerprint(stored: StoredDecision): RepertoireDecision {
  const decision: Partial<StoredDecision> = { ...stored };
  delete decision.acceptanceFingerprint;
  return decision as RepertoireDecision;
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
  const { decisions, decisionUpserts } = planDecisions(record.id, collected, existing);

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

/** The supported choices of each position key, as collectDecisions gathers them. */
type SupportedChoices = ReadonlyMap<string, Pick<CollectedDecision, "acceptedUcis">>;

/**
 * Reconciles stored decisions with the supported choices (reconcileDecisions), and returns every
 * decision afterwards with the ones to store: new, changed, or with a new acceptance fingerprint.
 * `existing` may be a subset of the repertoire's decisions; only those and the keys of
 * `collected` are planned.
 */
function planDecisions(
  repertoireId: string,
  collected: SupportedChoices,
  existing: readonly StoredDecision[]
): Pick<ReindexPlan, "decisions" | "decisionUpserts"> {
  const { upserts } = reconcileDecisions(existing, collected, { repertoireId });

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
  return { decisions, decisionUpserts };
}

/**
 * Writes a planned reindex: the decisions, the position index rows (tagged with the record's
 * revision), and progress eligibility (see updateProgress).
 */
export function applyReindex(
  record: RepertoireRecord,
  plan: ReindexPlan,
  now: number
): ReindexResult {
  for (const decision of plan.decisionUpserts) decisionRepository.upsert(decision, now);
  positionIndexRepository.replace(record.id, plan.rows, record.revision);
  const progressChanged = updateProgress(
    progressRepository.list(record.id),
    plan.collected,
    plan.decisions,
    now
  );
  return { decisionsChanged: plan.decisionUpserts.length, progressChanged };
}

/**
 * Brings progress rows in line with the reconciled decisions: a decision nothing supports is
 * suspended; an accepted move removed from its effective set makes it due now (no lapse);
 * re-enabling identical choices just unsuspends it, so its timestamps come back unchanged.
 * Returns whether any row changed.
 */
function updateProgress(
  rows: readonly RepertoireProgress[],
  collected: SupportedChoices,
  decisions: ReadonlyMap<string, StoredDecision>,
  now: number
): boolean {
  let progressChanged = false;
  for (const progress of rows) {
    const entry = collected.get(progress.positionKey);
    const decision = decisions.get(progress.positionKey);
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
  return progressChanged;
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

/* ------------------------------------------------------------------ incremental reindex */

/**
 * True when two versions of a chapter feed the derived state the same way: the same kind, enabled
 * flag, order and root, the same tree structure (ids, parents, children, moves, positions, plies)
 * and the same training marks. Comments, titles, headers, NAGs, arrows and highlights don't count.
 */
export function sameIndexInputs(a: RepertoireChapter, b: RepertoireChapter): boolean {
  if (
    a.id !== b.id ||
    a.kind !== b.kind ||
    a.enabled !== b.enabled ||
    a.sortOrder !== b.sortOrder ||
    a.rootFen !== b.rootFen ||
    a.tree.length !== b.tree.length
  ) {
    return false;
  }
  for (let index = 0; index < a.tree.length; index++) {
    const x = a.tree[index];
    const y = b.tree[index];
    if (
      x.id !== y.id ||
      x.parentId !== y.parentId ||
      x.uci !== y.uci ||
      x.fenAfter !== y.fenAfter ||
      x.ply !== y.ply ||
      x.children.length !== y.children.length ||
      x.children.some((childId, at) => childId !== y.children[at])
    ) {
      return false;
    }
  }
  const ids = Object.keys(a.nodeMeta);
  if (ids.length !== Object.keys(b.nodeMeta).length) return false;
  return ids.every((id) => {
    const x = a.nodeMeta[id];
    const y = b.nodeMeta[id];
    return (
      y !== undefined &&
      x.edge === y.edge &&
      Boolean(x.trainingStart) === Boolean(y.trainingStart) &&
      Boolean(x.trainingStop) === Boolean(y.trainingStop) &&
      Boolean(x.disabled) === Boolean(y.disabled)
    );
  });
}

/** One chapter's share of the derived state. */
type ChapterIndex = {
  rows: PositionIndexRow[];
  /** The choices the chapter supports at each position key, in its authored order. */
  choices: Map<string, string[]>;
};

const NO_CHAPTER: ChapterIndex = { rows: [], choices: new Map() };

/** Appends the choices not listed yet, keeping first-seen order. */
function addChoices(choices: Map<string, string[]>, key: string, ucis: readonly string[]): void {
  const list = choices.get(key);
  if (!list) {
    choices.set(key, [...new Set(ucis)]);
    return;
  }
  for (const uci of ucis) if (!list.includes(uci)) list.push(uci);
}

function chapterIndex(
  color: RepertoireRecord["color"],
  chapter: RepertoireChapter,
  keyOf: (fen: string) => string
): ChapterIndex {
  const lookup = buildChapterLookup(chapter, keyOf);
  const states = computeScopeStates(chapter, lookup);
  const decisionNodes = new Set<string>();
  const choices = new Map<string, string[]>();
  for (const { nodeId, ucis } of chapterDecisionNodes(color, chapter, lookup, states)) {
    decisionNodes.add(nodeId);
    addChoices(choices, lookup.positionKeys.get(nodeId)!, ucis);
  }
  const rows = lookup.order.map((nodeId) => ({
    chapterId: chapter.id,
    nodeId,
    positionKey: lookup.positionKeys.get(nodeId)!,
    scopeState: states.get(nodeId)!,
    isDecision: decisionNodes.has(nodeId),
    ply: lookup.nodesById.get(nodeId)!.ply
  }));
  return { rows, choices };
}

const sameChoices = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((uci, index) => uci === b[index]);

/**
 * The supported choices of `keys` across the repertoire, merged in chapter order as
 * collectDecisions merges them. The changed chapter (if any) contributes `own`; every other
 * chapter with a decision occurrence of one of the keys (found through the stored index) is loaded
 * and asked for its choices at those nodes. Position keys aren't recomputed for them: the index
 * has them.
 */
function supportedChoices(
  record: RepertoireRecord,
  chapterId: string | null,
  keys: readonly string[],
  own: ReadonlyMap<string, string[]>
): Map<string, CollectedDecision> {
  const wanted = new Set(keys);
  const nodesByChapter = new Map<string, Map<string, string>>();
  for (const row of positionIndexRepository.decisionOccurrences(record.id, keys, chapterId)) {
    let nodes = nodesByChapter.get(row.chapterId);
    if (!nodes) nodesByChapter.set(row.chapterId, (nodes = new Map()));
    nodes.set(row.nodeId, row.positionKey);
  }
  const contributions = new Map<string, ReadonlyMap<string, string[]>>();
  if (chapterId !== null) contributions.set(chapterId, own);
  for (const [otherId, nodes] of nodesByChapter) {
    const chapter = chapterRepository.get(otherId);
    if (!chapter) continue;
    const lookup = buildChapterLookup(chapter, () => "");
    const states = computeScopeStates(chapter, lookup);
    const choices = new Map<string, string[]>();
    for (const { nodeId, ucis } of chapterDecisionNodes(record.color, chapter, lookup, states)) {
      const key = nodes.get(nodeId);
      if (key !== undefined) addChoices(choices, key, ucis);
    }
    contributions.set(otherId, choices);
  }

  const collected = new Map<string, CollectedDecision>();
  for (const id of chapterRepository.orderedIds(record.id)) {
    const choices = contributions.get(id);
    if (!choices) continue;
    for (const [key, ucis] of choices) {
      if (!wanted.has(key)) continue;
      let entry = collected.get(key);
      if (!entry) {
        entry = { positionKey: key, fen: "", acceptedUcis: new Set(), occurrences: [] };
        collected.set(key, entry);
      }
      for (const uci of ucis) entry.acceptedUcis.add(uci);
    }
  }
  return collected;
}

/**
 * The supported choices of `keys` where the changed chapter only gained choices, without reading
 * the other chapters: what a key supported before is exactly its stored decision's acceptance
 * fingerprint (every accepted move that had a supporting occurrence), and now it also supports
 * the chapter's choices. A key without a decision supported nothing before. The merge equals
 * collectDecisions' for reconciliation: the choices new to the decision come only from this
 * chapter, in its order.
 */
function grownChoices(
  record: RepertoireRecord,
  keys: readonly string[],
  own: ReadonlyMap<string, string[]>
): Map<string, CollectedDecision> {
  const collected = new Map<string, CollectedDecision>();
  for (const key of keys) {
    const fingerprint = decisionRepository.get(record.id, key)?.acceptanceFingerprint ?? "";
    const acceptedUcis = new Set(fingerprint ? fingerprint.split(",") : []);
    for (const uci of own.get(key) ?? []) acceptedUcis.add(uci);
    if (acceptedUcis.size) {
      collected.set(key, { positionKey: key, fen: "", acceptedUcis, occurrences: [] });
    }
  }
  return collected;
}

/**
 * Updates the derived state after one chapter changed — saved (`before` and `after`), added (no
 * `before`) or removed (no `after`) — with the same result as a full reindex, touching only what
 * the chapter can affect. The chapter change must already be stored, and the derived state must
 * be what reindex built before it (every write that changes chapters or decisions leaves it so).
 *
 * - A change that doesn't feed the index (sameIndexInputs: a comment, a title) writes nothing.
 * - Otherwise the chapter's own index rows are rewritten. Decisions and progress are reconciled
 *   only at the position keys where the chapter's supported choices changed (all of its keys when
 *   it moved in the chapter order). Where it lost a choice, the choices other chapters support
 *   there, transpositions included, are read from those chapters; where it only gained choices,
 *   the stored decisions say what they support (grownChoices).
 * - When the stored index doesn't cover the old chapter (an index from an older key version, a
 *   damaged chapter), it falls back to the full reindex.
 */
export function reindexChapter(
  record: RepertoireRecord,
  before: RepertoireChapter | null,
  after: RepertoireChapter | null,
  now: number
): ReindexResult {
  if (before && after && sameIndexInputs(before, after)) {
    return { decisionsChanged: 0, progressChanged: false };
  }
  const chapterId = (after ?? before)?.id;
  if (!chapterId) return reindex(record, now);

  // The stored keys of the old tree also seed the new one: most of its positions are the same.
  const storedKeys = before ? positionIndexRepository.chapterKeys(chapterId) : new Map();
  const seed = new Map<string, string>();
  for (const node of before?.tree ?? []) {
    const key = storedKeys.get(node.id);
    if (key !== undefined) seed.set(node.fenAfter, key);
  }
  const keyOf = memoizedPositionKey(seed);
  const old = before ? chapterIndex(record.color, before, keyOf) : NO_CHAPTER;
  if (old.rows.length !== storedKeys.size) return reindex(record, now);
  const next = after ? chapterIndex(record.color, after, keyOf) : NO_CHAPTER;

  const reordered = before !== null && after !== null && before.sortOrder !== after.sortOrder;
  const changedKeys: string[] = [];
  for (const key of new Set([...old.choices.keys(), ...next.choices.keys()])) {
    if (reordered || !sameChoices(old.choices.get(key), next.choices.get(key))) {
      changedKeys.push(key);
    }
  }

  // Where the chapter only gained choices, the stored decision already says what the other
  // chapters support there; anything it lost may still be supported elsewhere, so those keys
  // read the other chapters.
  const grown: string[] = [];
  const shrunk: string[] = [];
  for (const key of changedKeys) {
    const kept = new Set(next.choices.get(key));
    if ((old.choices.get(key) ?? []).every((uci) => kept.has(uci))) grown.push(key);
    else shrunk.push(key);
  }
  const collected = new Map([
    ...grownChoices(record, grown, next.choices),
    ...(shrunk.length ? supportedChoices(record, chapterId, shrunk, next.choices) : [])
  ]);
  const result = changedKeys.length
    ? reconcilePositions(record, changedKeys, collected, now)
    : { decisionsChanged: 0, progressChanged: false };
  positionIndexRepository.replaceChapter(record.id, chapterId, next.rows, record.revision);
  return result;
}

/**
 * Re-reconciles the decisions and progress of `keys` after a write that changed only stored
 * decisions there (no chapter), with the same result as a full reindex: the chapters supporting
 * those positions are read through the index, which doesn't change.
 */
export function reindexPositions(
  record: RepertoireRecord,
  keys: readonly string[],
  now: number
): ReindexResult {
  return reconcilePositions(record, keys, supportedChoices(record, null, keys, new Map()), now);
}

/** Reconciles and stores the decisions and progress of `keys` (planDecisions, updateProgress). */
function reconcilePositions(
  record: RepertoireRecord,
  keys: readonly string[],
  collected: SupportedChoices,
  now: number
): ReindexResult {
  const existing: StoredDecision[] = [];
  const progress: RepertoireProgress[] = [];
  for (const key of keys) {
    const decision = decisionRepository.get(record.id, key);
    if (decision) existing.push(decision);
    const row = progressRepository.get(record.id, key);
    if (row) progress.push(row);
  }
  const { decisions, decisionUpserts } = planDecisions(record.id, collected, existing);
  for (const decision of decisionUpserts) decisionRepository.upsert(decision, now);
  return {
    decisionsChanged: decisionUpserts.length,
    progressChanged: updateProgress(progress, collected, decisions, now)
  };
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
