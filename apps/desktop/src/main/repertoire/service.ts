/**
 * The repertoire authority (design §7–§10): revision checks, decision reconciliation, the derived
 * position index, progress invalidation, PGN import/export and practice grading. Every mutation
 * runs in one transaction; change events are broadcast only after it commits.
 */
import { BrowserWindow, dialog } from "electron";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";
import {
  COMPARE_GAME_MAX_PLIES,
  REPERTOIRE_POSITION_KEY_VERSION,
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameInput,
  type AddFromGamePreview,
  type AddFromGameResult,
  type AddFromGameScope,
  type ArchiveRepertoireInput,
  type AttemptResult,
  type ChapterKind,
  type ChapterSaveResult,
  type CompareGameInput,
  type CreateRepertoireInput,
  type DecisionSaveResult,
  type DuplicateRepertoireInput,
  type ExportInput,
  type ExportResult,
  type ImportCommitInput,
  type ImportPreview,
  type ImportResult,
  type PracticeActionInput,
  type PracticeActionResult,
  type PracticeCard,
  type PracticeSessionSnapshot,
  type PracticeSummary,
  type PracticeTotals,
  type PreviewImportInput,
  type RecordAttemptInput,
  type RemoveChapterInput,
  type RemoveRepertoireInput,
  type RepertoireChangedEvent,
  type RepertoireChangeResult,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireComparison,
  type RepertoireDecision,
  type RepertoireDetail,
  type RepertoireDueSummary,
  type LinkGameInput,
  type RepertoireGameLink,
  type RepertoireListFilters,
  type RepertoireNodeMeta,
  type RepertoireOccurrence,
  type RepertoireSummary,
  type SaveChapterInput,
  type SaveWorkspaceInput,
  type StartPracticeInput,
  type UpdateDecisionInput,
  type UpdateRepertoireMetadataInput
} from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { playerToMove, positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  applyPolicy,
  extractScope,
  listOpponentMoves,
  listOwnMoves,
  pathToPosition,
  proposePolicy,
  untrainedMoveWarnings,
  type AddFromGamePolicy,
  type ExtractedScope
} from "@chaturanga/shared/chess/repertoire-add-from-game";
import { mergeIntoChapter } from "@chaturanga/shared/chess/repertoire-merge";
import {
  acceptanceFingerprint,
  buildChapterLookup,
  collectDecisions,
  computeScopeStates,
  defaultImportNodeMeta,
  effectiveAcceptedUcis,
  effectivePreferredUci,
  nodeMetaOf,
  reconcileDecisions,
  type ChapterLookup,
  type CollectedDecision,
  type DecisionOccurrence
} from "@chaturanga/shared/chess/repertoire-index";
import {
  firstAnswerOutcome,
  orderQueue,
  scheduleAfterOutcome,
  type PracticeHistoryAction,
  type PracticeOutcome
} from "@chaturanga/shared/chess/repertoire-scheduler";
import { compareGameToRepertoire } from "@chaturanga/shared/chess/repertoire-compare";
import {
  exportRepertoirePgn,
  formatPath,
  parseRepertoirePgn,
  type ParsedRepertoireGame
} from "@chaturanga/shared/chess/repertoire-pgn";
import { gameRepository } from "../db/repositories";
import { broadcast } from "../ipc/broadcast";
import {
  chapterTitle,
  fenAfterMove,
  isValidFen,
  normalizeUci,
  rootNode,
  sanitizeChapter,
  sanitizeHeaders,
  validateTree
} from "./chapter-validation";
import {
  attemptRepository,
  chapterRepository,
  decisionRepository,
  gameLinkRepository,
  libraryGameExists,
  positionIndexRepository,
  progressRepository,
  repertoireRepository,
  sessionRepository,
  transaction,
  workspaceRepository,
  type AttemptRecord,
  type FrozenPolicy,
  type PositionIndexRow,
  type PracticeSessionRecord,
  type RepertoireRecord,
  type StoredDecision
} from "./repository";

const MAX_NAME = 200;
const MAX_DESCRIPTION = 5_000;
const MAX_TAGS = 32;
const MAX_TAG = 50;
const MAX_POLICY_TEXT = 2_000;
const MAX_PGN_BYTES = 20 * 1024 * 1024;
const IMPORT_JOB_TTL_MS = 30 * 60_000;
/** Pending import previews kept in memory at once; each holds its parsed game trees. */
const MAX_IMPORT_JOBS = 3;
const DEFAULT_DUE_LIMIT = 20;
const DEFAULT_NEW_AFTER_DUE = 5;
const DEFAULT_LEARN_LIMIT = 10;

/** Injectable clock (tests); main-process time is the only time grading uses. */
let clock: () => number = () => Date.now();

/** Replaces the service clock (tests only); pass nothing to restore `Date.now`. */
export function setRepertoireClock(next?: () => number): void {
  clock = next ?? (() => Date.now());
}

function changed(event: RepertoireChangedEvent): void {
  broadcast("repertoires:changed", event);
}

/* ------------------------------------------------------------------ shared helpers */

function requireRepertoire(id: string): RepertoireRecord {
  const record = repertoireRepository.get(id);
  if (!record) throw new Error("Invalid repertoireId: not found");
  return record;
}

/** Refuses a stale draft: the stored revision must be the one the caller started from. */
function checkRevision(record: RepertoireRecord, expected: number): void {
  if (record.revision !== expected) {
    throw new Error(
      `Invalid expectedRevision: repertoire changed (stored ${record.revision}, expected ${expected})`
    );
  }
}

/** Bumps the repertoire's revision and saves it; returns the new record. */
function bump(record: RepertoireRecord, now: number, patch: Partial<RepertoireRecord> = {}) {
  const next: RepertoireRecord = {
    ...record,
    ...patch,
    revision: record.revision + 1,
    updatedAt: now
  };
  repertoireRepository.update(next);
  return next;
}

function detail(id: string, now: number): RepertoireDetail {
  const summary = repertoireRepository.summary(id, now);
  if (!summary) throw new Error("Invalid repertoireId: not found");
  return {
    ...summary,
    chapters: chapterRepository.summaries(id, now),
    workspace: workspaceRepository.get(id)
  };
}

/** A stored chapter with its current due count. */
function loadChapter(repertoireId: string, chapterId: string, now: number): RepertoireChapter {
  if (chapterRepository.ownerOf(chapterId)?.repertoireId !== repertoireId) {
    throw new Error("Invalid chapterId: not found");
  }
  const chapter = chapterRepository.get(chapterId)!;
  const summary = chapterRepository
    .summaries(repertoireId, now)
    .find((item) => item.id === chapterId);
  return { ...chapter, dueCount: summary?.dueCount ?? 0 };
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, MAX_NAME) : "";
  if (!name) throw new Error("Invalid name: expected a non-empty name");
  return name;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().slice(0, MAX_TAG))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

/** The shared decision type, without the stored fingerprint. */
function stripFingerprint(stored: StoredDecision): RepertoireDecision {
  const decision: Partial<StoredDecision> = { ...stored };
  delete decision.acceptanceFingerprint;
  return decision as RepertoireDecision;
}

/* ------------------------------------------------------------------ index and invalidation */

type ReindexResult = { decisionsChanged: number; progressChanged: boolean };

/**
 * Rebuilds the derived state of a repertoire from all of its chapters (design §8.3): reconciles
 * decisions with the collected index, replaces the position index rows, and updates progress
 * eligibility — a decision nothing supports is suspended; an accepted move removed from its
 * effective set makes it due now (no lapse); re-enabling identical choices just unsuspends it, so
 * its timestamps come back unchanged.
 */
function reindex(record: RepertoireRecord, now: number): ReindexResult {
  const chapters = chapterRepository.list(record.id);
  const collected = collectDecisions(record.color, chapters);
  const existing = decisionRepository.list(record.id);
  const { upserts } = reconcileDecisions(existing, collected, { repertoireId: record.id });

  const decisions = new Map(existing.map((decision) => [decision.positionKey, decision]));
  const touched = new Set<string>();
  for (const upsert of upserts) {
    const previous = decisions.get(upsert.positionKey);
    decisions.set(upsert.positionKey, {
      ...upsert,
      acceptanceFingerprint: previous?.acceptanceFingerprint ?? ""
    });
    touched.add(upsert.positionKey);
  }

  let decisionsChanged = 0;
  for (const decision of decisions.values()) {
    const entry = collected.get(decision.positionKey);
    const fingerprint = entry
      ? acceptanceFingerprint(effectiveAcceptedUcis(decision, entry.acceptedUcis))
      : "";
    if (fingerprint === decision.acceptanceFingerprint && !touched.has(decision.positionKey))
      continue;
    decisionsChanged += 1;
    decision.acceptanceFingerprint = fingerprint;
    decisionRepository.upsert(decision, now);
  }

  const occurrenceIds = new Set<string>();
  for (const entry of collected.values()) {
    for (const occurrence of entry.occurrences) {
      occurrenceIds.add(`${occurrence.chapterId}\u0000${occurrence.nodeId}`);
    }
  }
  const rows: PositionIndexRow[] = [];
  for (const chapter of chapters) {
    const lookup = buildChapterLookup(chapter);
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
  positionIndexRepository.replace(record.id, rows, record.revision);

  let progressChanged = false;
  for (const progress of progressRepository.list(record.id)) {
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
  return { decisionsChanged, progressChanged };
}

/* ------------------------------------------------------------------ queries */

/** Summaries for the hub (aggregates only; no tree is loaded). */
export function listRepertoires(filters: RepertoireListFilters = {}): RepertoireSummary[] {
  return repertoireRepository.list(filters, clock());
}

export function getRepertoire(id: string): RepertoireDetail {
  return detail(id, clock());
}

/** One chapter with its tree (throws RepertoireCorruptChapterError when it is damaged). */
export function getChapter(input: { repertoireId: string; chapterId: string }): RepertoireChapter {
  return loadChapter(input.repertoireId, input.chapterId, clock());
}

/** The stored policy at one position, or null when the repertoire has none there yet. */
export function getDecision(input: {
  repertoireId: string;
  positionKey: string;
}): RepertoireDecision | null {
  requireRepertoire(input.repertoireId);
  const stored = decisionRepository.get(input.repertoireId, input.positionKey);
  return stored ? stripFingerprint(stored) : null;
}

/**
 * Every occurrence of a position in the repertoire (any scope state: this is for study
 * navigation, not training), with its chapter title and SAN path. Each involved chapter's tree is
 * read once per call.
 */
export function getOccurrences(input: {
  repertoireId: string;
  positionKey: string;
}): RepertoireOccurrence[] {
  requireRepertoire(input.repertoireId);
  const rows = positionIndexRepository.occurrences(input.repertoireId, input.positionKey);
  const lookups = new Map<string, ChapterLookup>();
  return rows.map((row) => {
    let lookup = lookups.get(row.chapterId);
    if (!lookup) {
      lookup = buildChapterLookup(chapterRepository.get(row.chapterId)!);
      lookups.set(row.chapterId, lookup);
    }
    const ids = lookup.parentPath.get(row.nodeId) ?? [];
    const moves = ids.slice(1).map((id) => lookup!.nodesById.get(id)!);
    return { ...row, path: formatPath(moves) };
  });
}

/* ------------------------------------------------------------------ game comparison */

/** Comparisons kept in memory; each entry names the revision it was computed against. */
const COMPARE_CACHE_SIZE = 32;
const compareCache = new Map<string, RepertoireComparison>();

/**
 * A finished game's mainline against one repertoire (§6.3). Archived repertoires can still be
 * compared. Every move must be legal from `rootFen`. Results are cached by repertoire, revision,
 * player colour, position-key version and game content, so any repertoire edit (a revision bump)
 * misses the cache; the 32 most recently used results are kept.
 */
export function compareGame(input: CompareGameInput): RepertoireComparison {
  const record = requireRepertoire(input.repertoireId);
  if (input.color !== "white" && input.color !== "black") {
    throw new Error("Invalid color: expected white or black");
  }
  if (input.color !== record.color) {
    throw new Error(`Invalid color: this repertoire is for ${record.color}`);
  }
  if (!isValidFen(input.rootFen)) throw new Error("Invalid rootFen: not a legal position");
  if (input.moves.length > COMPARE_GAME_MAX_PLIES) {
    throw new Error(`Invalid moves: more than ${COMPARE_GAME_MAX_PLIES} plies`);
  }
  const gameHash = createHash("sha256")
    .update(`${input.rootFen}\n${input.moves.join(" ")}`)
    .digest("hex");
  const cacheKey = [
    record.id,
    record.revision,
    input.color,
    REPERTOIRE_POSITION_KEY_VERSION,
    gameHash
  ].join("|");
  const cached = compareCache.get(cacheKey);
  if (cached) {
    compareCache.delete(cacheKey);
    compareCache.set(cacheKey, cached);
    return cached;
  }

  let fen = input.rootFen;
  input.moves.forEach((uci, index) => {
    const next = fenAfterMove(fen, uci);
    if (!next) throw new Error(`Invalid moves: "${uci}" (ply ${index + 1}) is not legal`);
    fen = next;
  });

  const result = compareGameToRepertoire(
    { color: input.color, rootFen: input.rootFen, moves: input.moves },
    {
      id: record.id,
      name: record.name,
      revision: record.revision,
      chapters: chapterRepository.list(record.id).filter((chapter) => chapter.enabled),
      decisions: decisionRepository.list(record.id).map(stripFingerprint)
    }
  );
  compareCache.set(cacheKey, result);
  if (compareCache.size > COMPARE_CACHE_SIZE) {
    compareCache.delete(compareCache.keys().next().value!);
  }
  return result;
}

/** Due decisions across active repertoires, and the most recent study place (Home card). */
export function getDueSummary(): RepertoireDueSummary {
  const now = clock();
  const totals = repertoireRepository.dueTotals(now);
  const place = repertoireRepository.lastStudyPlace();
  return {
    ...totals,
    continue: place
      ? {
          repertoireId: place.repertoireId,
          chapterId: place.chapterId,
          nodeId: place.nodeId ?? REPERTOIRE_ROOT_NODE_ID
        }
      : null
  };
}

/* ------------------------------------------------------------------ repertoire mutations */

/** A new repertoire with one chapter at `rootFen` (or the standard start). */
export function createRepertoire(input: CreateRepertoireInput): RepertoireDetail {
  const now = clock();
  const name = cleanName(input.name);
  if (input.color !== "white" && input.color !== "black") {
    throw new Error("Invalid color: expected white or black");
  }
  const rootFen = input.rootFen?.trim() || START_FEN;
  if (!isValidFen(rootFen)) throw new Error("Invalid rootFen: not a legal position");
  const id = nanoid();
  const result = transaction(() => {
    repertoireRepository.insert({
      id,
      name,
      color: input.color,
      description: cleanText(input.description, MAX_DESCRIPTION) ?? "",
      tags: cleanTags(input.tags),
      revision: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    });
    chapterRepository.upsert(
      id,
      {
        id: nanoid(),
        title: chapterTitle(input.firstChapterTitle, name),
        sortOrder: 0,
        kind: "opening",
        enabled: true,
        rootFen,
        revision: 1,
        nodeCount: 0,
        dueCount: 0,
        headers: {},
        tree: [rootNode(rootFen)],
        nodeMeta: {}
      },
      now
    );
    reindex(requireRepertoire(id), now);
    return detail(id, now);
  });
  changed({ repertoireId: id, revision: result.revision, kind: "created" });
  return result;
}

export function updateMetadata(input: UpdateRepertoireMetadataInput): RepertoireDetail {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.id);
    checkRevision(record, input.expectedRevision);
    const patch: Partial<RepertoireRecord> = {};
    if (input.patch.name !== undefined) patch.name = cleanName(input.patch.name);
    if (input.patch.description !== undefined) {
      patch.description = cleanText(input.patch.description, MAX_DESCRIPTION) ?? "";
    }
    if (input.patch.tags !== undefined) patch.tags = cleanTags(input.patch.tags);
    bump(record, now, patch);
    return detail(record.id, now);
  });
  changed({ repertoireId: result.id, revision: result.revision, kind: "updated" });
  return result;
}

/**
 * Saves one chapter (new or existing) and reconciles decisions, index and progress. An existing
 * chapter must carry its stored revision: another write (e.g. a decision change rewriting its
 * edges) may have changed it since the draft was loaded.
 */
export function saveChapter(input: SaveChapterInput): ChapterSaveResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    if (!input.chapter || typeof input.chapter.id !== "string" || !input.chapter.id) {
      throw new Error("Invalid chapter: expected a chapter with an id");
    }
    const owner = chapterRepository.ownerOf(input.chapter.id);
    if (owner && owner.repertoireId !== record.id) {
      throw new Error("Invalid chapter: it belongs to another repertoire");
    }
    if (owner && input.chapter.revision !== owner.revision) {
      throw new Error(
        `Invalid chapter.revision: chapter changed (stored ${owner.revision}, expected ${input.chapter.revision})`
      );
    }
    const chapter = sanitizeChapter(input.chapter, (owner?.revision ?? 0) + 1);
    const next = bump(record, now);
    chapterRepository.upsert(record.id, chapter, now);
    const { decisionsChanged } = reindex(next, now);
    return {
      repertoire: detail(record.id, now),
      chapter: loadChapter(record.id, chapter.id, now),
      decisionsChanged
    };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

type Occurrence = {
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  nodeId: string;
  node: MoveNode;
};

/** The child of an occurrence that plays `uci`, if any. */
function childPlaying(occurrence: Occurrence, uci: string): MoveNode | null {
  for (const childId of occurrence.lookup.childrenById.get(occurrence.nodeId) ?? []) {
    const child = occurrence.lookup.nodesById.get(childId)!;
    if (child.uci === uci) return child;
  }
  return null;
}

function isActiveIncluded(occurrence: Occurrence, child: MoveNode): boolean {
  const { chapter } = occurrence;
  if (!chapter.enabled || chapter.kind !== "opening") return false;
  if (nodeMetaOf(chapter.nodeMeta, child.id).edge !== "included") return false;
  const states = computeScopeStates(chapter, occurrence.lookup);
  return states.get(occurrence.nodeId) === "active" && states.get(child.id) === "active";
}

/**
 * Updates the policy at one position. Accepting a move with no supporting included occurrence
 * selects one (its edge becomes `included`) in the same transaction (§7.1); removing an accepted
 * move turns its included occurrences into reference moves so reconciliation doesn't re-add it.
 * A move with no occurrence at all in the repertoire is refused.
 */
export function updateDecision(input: UpdateDecisionInput): DecisionSaveResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    const chapters = chapterRepository.list(record.id).map((chapter) => ({
      ...chapter,
      nodeMeta: { ...chapter.nodeMeta }
    }));
    const occurrences: Occurrence[] = [];
    for (const chapter of chapters) {
      const lookup = buildChapterLookup(chapter);
      for (const nodeId of lookup.order) {
        if (lookup.positionKeys.get(nodeId) !== input.positionKey) continue;
        const node = lookup.nodesById.get(nodeId)!;
        if (playerToMove(node.fenAfter) !== record.color) continue;
        occurrences.push({ chapter, lookup, nodeId, node });
      }
    }
    if (!occurrences.length) throw new Error("Invalid positionKey: not found in this repertoire");
    const fen = occurrences[0].node.fenAfter;
    const stored: StoredDecision = decisionRepository.get(record.id, input.positionKey) ?? {
      repertoireId: record.id,
      positionKey: input.positionKey,
      acceptedUcis: [],
      preferredUci: null,
      prompt: null,
      hint: null,
      wrongMoveFeedback: {},
      paused: false,
      acceptanceFingerprint: ""
    };
    const next: StoredDecision = { ...stored, acceptedUcis: [...stored.acceptedUcis] };
    const touchedChapters = new Set<RepertoireChapter>();
    const setEdge = (occurrence: Occurrence, child: MoveNode, edge: RepertoireNodeMeta["edge"]) => {
      occurrence.chapter.nodeMeta[child.id] = {
        ...nodeMetaOf(occurrence.chapter.nodeMeta, child.id),
        edge
      };
      touchedChapters.add(occurrence.chapter);
    };
    const { patch } = input;

    if (patch.acceptedUcis !== undefined) {
      const accepted = [...new Set(patch.acceptedUcis.map((uci) => normalizeUci(fen, uci)))];
      for (const uci of accepted) {
        if (!fenAfterMove(fen, uci)) {
          throw new Error(`Invalid acceptedUcis: "${uci}" is not a legal move in this position`);
        }
      }
      for (const uci of accepted) {
        const candidates = occurrences.filter((occurrence) => childPlaying(occurrence, uci));
        if (!candidates.length) {
          throw new Error(
            `Invalid acceptedUcis: "${uci}" has no occurrence in this repertoire; play it on the board first`
          );
        }
        if (
          candidates.some((occurrence) =>
            isActiveIncluded(occurrence, childPlaying(occurrence, uci)!)
          )
        ) {
          continue;
        }
        for (const occurrence of candidates) {
          const child = childPlaying(occurrence, uci)!;
          const before = occurrence.chapter.nodeMeta[child.id];
          setEdge(occurrence, child, "included");
          if (isActiveIncluded(occurrence, child)) break;
          // This occurrence can't train (disabled, reference chapter, outside its boundaries).
          if (before) occurrence.chapter.nodeMeta[child.id] = before;
          else delete occurrence.chapter.nodeMeta[child.id];
        }
      }
      for (const uci of stored.acceptedUcis.filter((uci) => !accepted.includes(uci))) {
        for (const occurrence of occurrences) {
          const child = childPlaying(occurrence, uci);
          if (child && nodeMetaOf(occurrence.chapter.nodeMeta, child.id).edge === "included") {
            setEdge(occurrence, child, "reference");
          }
        }
      }
      next.acceptedUcis = accepted;
      if (next.preferredUci && !accepted.includes(next.preferredUci)) {
        next.preferredUci = accepted[0] ?? null;
      }
    }
    if (patch.preferredUci !== undefined) {
      const preferred = patch.preferredUci === null ? null : normalizeUci(fen, patch.preferredUci);
      if (preferred !== null && !next.acceptedUcis.includes(preferred)) {
        throw new Error("Invalid preferredUci: it must be one of the accepted moves");
      }
      next.preferredUci = preferred;
    }
    if (patch.prompt !== undefined) next.prompt = cleanText(patch.prompt, MAX_POLICY_TEXT);
    if (patch.hint !== undefined) next.hint = cleanText(patch.hint, MAX_POLICY_TEXT);
    if (patch.wrongMoveFeedback !== undefined) {
      next.wrongMoveFeedback = {};
      for (const [uci, text] of Object.entries(patch.wrongMoveFeedback)) {
        const feedback = cleanText(text, MAX_POLICY_TEXT);
        if (feedback) next.wrongMoveFeedback[normalizeUci(fen, uci)] = feedback;
      }
    }
    if (patch.paused !== undefined) next.paused = patch.paused === true;

    const bumped = bump(record, now);
    for (const chapter of touchedChapters) {
      chapterRepository.upsert(record.id, { ...chapter, revision: chapter.revision + 1 }, now);
    }
    decisionRepository.upsert(next, now);
    reindex(bumped, now);
    return {
      repertoire: detail(record.id, now),
      decision: stripFingerprint(decisionRepository.get(record.id, input.positionKey)!)
    };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

export function removeChapter(input: RemoveChapterInput): RepertoireChangeResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    if (chapterRepository.ownerOf(input.chapterId)?.repertoireId !== record.id) {
      throw new Error("Invalid chapterId: not found");
    }
    chapterRepository.remove(input.chapterId);
    reindex(bump(record, now), now);
    return { repertoire: detail(record.id, now) };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/** A copy with fresh ids: chapters, decisions and workspace; progress starts fresh (§8.3). */
export function duplicateRepertoire(input: DuplicateRepertoireInput): RepertoireDetail {
  const now = clock();
  const id = nanoid();
  const result = transaction(() => {
    const source = requireRepertoire(input.id);
    const name = input.name?.trim() ? cleanName(input.name) : cleanName(`${source.name} (copy)`);
    repertoireRepository.insert({
      ...source,
      id,
      name,
      revision: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    });
    const chapterIds = new Map<string, string>();
    for (const chapter of chapterRepository.list(source.id)) {
      const copyId = nanoid();
      chapterIds.set(chapter.id, copyId);
      chapterRepository.upsert(id, { ...chapter, id: copyId, revision: 1 }, now);
    }
    for (const decision of decisionRepository.list(source.id)) {
      decisionRepository.upsert({ ...decision, repertoireId: id }, now);
    }
    const workspace = workspaceRepository.get(source.id);
    if (workspace) {
      const lastChapterId = workspace.lastChapterId
        ? (chapterIds.get(workspace.lastChapterId) ?? null)
        : null;
      workspaceRepository.save(
        id,
        {
          ...workspace,
          lastChapterId,
          lastNodeId: lastChapterId ? workspace.lastNodeId : null,
          practiceDraft: null
        },
        now
      );
    }
    reindex(requireRepertoire(id), now);
    return detail(id, now);
  });
  changed({ repertoireId: id, revision: result.revision, kind: "created" });
  return result;
}

/** Archives or restores a repertoire (archived ones contribute no due cards). */
export function archiveRepertoire(input: ArchiveRepertoireInput): RepertoireChangeResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.id);
    checkRevision(record, input.expectedRevision);
    bump(record, now, { archivedAt: input.archived ? (record.archivedAt ?? now) : null });
    return { repertoire: detail(record.id, now) };
  });
  changed({ repertoireId: input.id, revision: result.repertoire.revision, kind: "updated" });
  return result;
}

/** Deletes a repertoire and everything that belongs to it. */
export function removeRepertoire(input: RemoveRepertoireInput): void {
  const revision = transaction(() => {
    const record = requireRepertoire(input.id);
    checkRevision(record, input.expectedRevision);
    repertoireRepository.remove(record.id);
    return record.revision + 1;
  });
  changed({ repertoireId: input.id, revision, kind: "removed" });
}

/**
 * Study preferences (last chapter/node, orientation, practice draft); no revision bump. A chapter
 * of another repertoire (or a deleted one) isn't kept as the place to continue, nor a node that
 * isn't in the chapter. Announced as a `workspace` change, since summaries show when it was last
 * studied and where to continue.
 */
export function saveWorkspace(input: SaveWorkspaceInput): void {
  const record = requireRepertoire(input.repertoireId);
  let { lastChapterId, lastNodeId } = input.workspace;
  if (
    lastChapterId !== null &&
    chapterRepository.ownerOf(lastChapterId)?.repertoireId !== record.id
  ) {
    lastChapterId = null;
  }
  if (lastChapterId === null) lastNodeId = null;
  else if (lastNodeId !== null) {
    const tree = chapterRepository.get(lastChapterId)?.tree ?? [];
    if (!tree.some((node) => node.id === lastNodeId)) lastNodeId = null;
  }
  workspaceRepository.save(
    record.id,
    { ...input.workspace, lastChapterId, lastNodeId },
    clock(),
    !input.practiceSetup
  );
  changed({ repertoireId: record.id, revision: record.revision, kind: "workspace" });
}

/* ------------------------------------------------------------------ import / export */

type ImportJob = { games: ParsedRepertoireGame[]; expiresAt: number };
const importJobs = new Map<string, ImportJob>();

function pruneImportJobs(now: number): void {
  for (const [jobId, job] of importJobs) if (job.expiresAt <= now) importJobs.delete(jobId);
}

/**
 * Parses every game of a PGN text (pasted, or read through the native file picker) into a pending
 * job that expires after 30 minutes. Bounded by parseRepertoirePgn's limits (games, moves, depth)
 * and a 20 MiB input. At most MAX_IMPORT_JOBS jobs are kept; a new preview drops the oldest.
 */
export async function previewImport(input: PreviewImportInput): Promise<ImportPreview> {
  const text = input.pgn;
  if (typeof text !== "string" || text.length > MAX_PGN_BYTES) {
    throw new Error("Invalid PGN: expected text up to 20 MiB");
  }
  const parsed = parseRepertoirePgn(text);
  const now = clock();
  pruneImportJobs(now);
  for (const oldest of importJobs.keys()) {
    if (importJobs.size < MAX_IMPORT_JOBS) break;
    importJobs.delete(oldest);
  }
  const jobId = nanoid();
  importJobs.set(jobId, { games: parsed.games, expiresAt: now + IMPORT_JOB_TTL_MS });
  return {
    jobId,
    games: parsed.games.map((game) => ({
      index: game.index,
      proposedTitle: game.proposedTitle,
      rootFen: game.rootFen,
      headers: game.headers,
      nodeCount: game.nodeCount,
      tree: game.tree,
      warnings: game.warnings,
      invalidBranches: game.invalidBranches
    }))
  };
}

/** The tree without the excluded nodes and their subtrees. */
function pruneTree(tree: readonly MoveNode[], excludeNodeIds: readonly string[]): MoveNode[] {
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

/** Commits the selected games of a previewed job as new chapters, atomically. */
export function commitImport(input: ImportCommitInput): ImportResult {
  const now = clock();
  pruneImportJobs(now);
  const job = importJobs.get(input.jobId);
  if (!job)
    throw new Error("Invalid jobId: the import expired or was cancelled; preview the PGN again");
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    const selections = input.selections.filter((selection) => selection.include);
    if (!selections.length)
      throw new Error("Invalid selections: choose at least one game to import");
    if (new Set(selections.map((selection) => selection.gameIndex)).size !== selections.length) {
      throw new Error("Invalid selections: each game can be included only once");
    }
    let sortOrder = chapterRepository.maxSortOrder(record.id) + 1;
    for (const selection of selections) {
      const game = job.games.find((item) => item.index === selection.gameIndex);
      if (!game)
        throw new Error(`Invalid selections: game ${selection.gameIndex} is not in this import`);
      if (game.rejected) {
        throw new Error(
          `Invalid selections: game ${selection.gameIndex + 1} can't be imported (${game.rejected})`
        );
      }
      if (selection.kind !== "opening" && selection.kind !== "reference") {
        throw new Error("Invalid selections: kind must be opening or reference");
      }
      const tree = validateTree(pruneTree(game.tree, selection.excludeNodeIds ?? []), game.rootFen);
      chapterRepository.upsert(
        record.id,
        {
          id: nanoid(),
          title: chapterTitle(selection.title, game.proposedTitle),
          sortOrder: sortOrder++,
          kind: selection.kind,
          enabled: true,
          rootFen: game.rootFen,
          revision: 1,
          nodeCount: tree.length - 1,
          dueCount: 0,
          headers: sanitizeHeaders(game.headers),
          tree,
          nodeMeta: defaultImportNodeMeta(record.color, tree)
        },
        now
      );
    }
    reindex(bump(record, now), now);
    return { repertoire: detail(record.id, now), chaptersAdded: selections.length };
  });
  importJobs.delete(input.jobId);
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

export function cancelImport(jobId: string): void {
  importJobs.delete(jobId);
}

/** A bare file name (no directories) for the save dialog. */
function exportFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "repertoire";
  return `${base}.pgn`;
}

/**
 * Multi-game PGN of a consistent snapshot (one read transaction), offered through a native save
 * dialog. The destination is only ever the path the user picked in that dialog.
 */
export async function exportRepertoire(
  input: ExportInput,
  owner: BrowserWindow | null = null
): Promise<ExportResult> {
  const { record, chapters } = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    let chapters = chapterRepository.list(record.id);
    if (input.chapterIds) {
      const known = new Set(chapters.map((chapter) => chapter.id));
      const missing = input.chapterIds.find((id) => !known.has(id));
      if (missing) throw new Error(`Invalid chapterIds: "${missing}" is not in this repertoire`);
      const wanted = new Set(input.chapterIds);
      chapters = chapters.filter((chapter) => wanted.has(chapter.id));
    }
    return { record, chapters };
  });
  if (!chapters.length) throw new Error("Invalid export: there are no chapters to export");
  const pgn = exportRepertoirePgn(
    chapters.map((chapter) => ({
      title: chapter.title,
      headers: chapter.headers,
      rootFen: chapter.rootFen,
      tree: chapter.tree
    }))
  );
  const window = owner ?? BrowserWindow.getFocusedWindow();
  const options = {
    defaultPath: exportFileName(record.name),
    filters: [{ name: "PGN files", extensions: ["pgn"] }]
  };
  const choice = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  let savedPath: string | null = null;
  if (!choice.canceled && choice.filePath) {
    await writeFile(choice.filePath, pgn, "utf8");
    savedPath = choice.filePath;
  }
  return { pgn, chapterCount: chapters.length, savedPath };
}

/* ------------------------------------------------------------------ add from a game (§6.2) */

type AddFromGamePlan = {
  /** The chapter as it would be stored (sanitised; next chapter revision). */
  chapter: RepertoireChapter;
  preview: AddFromGamePreview;
  linkHeaders: Record<string, string>;
  gameNodeId: string | null;
  capturedPath: string;
};

/** A title from the game's tags when the dialog gives none. */
function gameTitle(headers: Record<string, string>): string {
  const known = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed !== "?" ? trimmed : null;
  };
  const white = known(headers.White ?? headers.white);
  const black = known(headers.Black ?? headers.black);
  if (white && black) return `${white} – ${black}`;
  return known(headers.Event ?? headers.event) ?? "Game excerpt";
}

/** The game tree checked like a chapter tree (legal moves, root "root", castling as e1g1). */
function validateSourceTree(input: AddFromGameInput["source"]): {
  rootFen: string;
  tree: MoveNode[];
} {
  const rootFen = typeof input.rootFen === "string" ? input.rootFen.trim() : "";
  if (!rootFen || !isValidFen(rootFen)) {
    throw new Error("Invalid source rootFen: not a legal position");
  }
  if (!Array.isArray(input.tree)) throw new Error("Invalid source tree: expected an array");
  try {
    return { rootFen, tree: validateTree(input.tree, rootFen) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Invalid chapter tree/, "Invalid source tree"), {
      cause: error
    });
  }
}

/**
 * The policy's source ids must name moves of the copied material (not its context): included
 * moves must be the repertoire side's, covered moves the opponent's.
 */
function checkPolicy(
  color: RepertoireColor,
  extracted: ExtractedScope,
  policy: AddFromGamePolicy
): void {
  const byId = new Map(extracted.tree.map((node) => [node.id, node]));
  const context = new Set(extracted.contextNodeIds);
  const moveOf = (sourceId: string): MoveNode => {
    const chapterId = extracted.sourceToChapterIds[sourceId];
    const node = chapterId === undefined ? undefined : byId.get(chapterId);
    if (!node || node.id === REPERTOIRE_ROOT_NODE_ID || context.has(sourceId)) {
      throw new Error(`Invalid policy: node "${sourceId}" is not part of the selected material`);
    }
    return node;
  };
  for (const id of policy.includedNodeIds) {
    if (playerToMove(moveOf(id).fenBefore) !== color) {
      throw new Error(
        `Invalid policy: node "${id}" is not a ${color} move, so it can't be accepted`
      );
    }
  }
  for (const id of policy.coveredNodeIds) {
    if (playerToMove(moveOf(id).fenBefore) === color) {
      throw new Error(
        `Invalid policy: node "${id}" is not an opponent move, so it can't be covered`
      );
    }
  }
}

/** Source nodes from the root to the scope's end (whole game: the end of its main line). */
function capturedRoute(tree: readonly MoveNode[], scope: AddFromGameScope): MoveNode[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  let end = byId.get(REPERTOIRE_ROOT_NODE_ID)!;
  if (scope.kind === "path") end = byId.get(scope.toNodeId) ?? end;
  else if (scope.kind === "subtree") end = byId.get(scope.fromNodeId) ?? end;
  else {
    while (end.children.length && byId.has(end.children[0])) end = byId.get(end.children[0])!;
  }
  const route: MoveNode[] = [];
  for (let node: MoveNode | undefined = end; node && node.parentId !== null; ) {
    route.unshift(node);
    node = byId.get(node.parentId);
  }
  return route;
}

/** SAN of `uci` played at a position of the chapter (falls back to the UCI). */
function sanInChapter(lookup: ChapterLookup, key: string, uci: string): string {
  for (const id of lookup.order) {
    if (lookup.positionKeys.get(id) !== key) continue;
    for (const childId of lookup.childrenById.get(id) ?? []) {
      const child = lookup.nodesById.get(childId)!;
      if (child.uci === uci && child.san) return child.san;
    }
  }
  return uci;
}

/**
 * Everything adding from a game needs, computed without writing: the validated source, the
 * extracted material, the would-be chapter (new, or merged into the destination), and the preview
 * figures measured against the repertoire's current chapters and decisions.
 */
function planAddFromGame(
  record: RepertoireRecord,
  input: AddFromGameInput,
  now: number
): AddFromGamePlan {
  const { destination, scope } = input;
  if (input.source.gameId !== null && !libraryGameExists(input.source.gameId)) {
    throw new Error("Invalid source gameId: the game is not in the library");
  }
  const source = validateSourceTree(input.source);
  const extracted = extractScope(source, scope);

  let existing: RepertoireChapter | null = null;
  let kind: ChapterKind;
  if (destination.kind === "existing-chapter") {
    existing = loadChapter(record.id, destination.chapterId, now);
    kind = existing.kind;
  } else if (destination.kind === "new-chapter") {
    if (destination.chapterKind !== "opening" && destination.chapterKind !== "reference") {
      throw new Error("Invalid destination: chapter kind must be opening or reference");
    }
    kind = destination.chapterKind;
  } else {
    throw new Error("Invalid destination: expected a new or an existing chapter");
  }

  const defaultPolicy = proposePolicy(record.color, extracted, scope, kind);
  const policy: AddFromGamePolicy = {
    includedNodeIds: [...new Set((input.policy ?? defaultPolicy).includedNodeIds)],
    coveredNodeIds: [...new Set((input.policy ?? defaultPolicy).coveredNodeIds)]
  };
  checkPolicy(record.color, extracted, policy);
  const incomingMeta = applyPolicy(extracted, policy);
  const linkHeaders = sanitizeHeaders(input.source.headers);

  let draft: RepertoireChapter;
  let alreadyPresent = 0;
  // Copied id → stored chapter id (the same ids for a new chapter).
  let chapterIds: Record<string, string> = extracted.sourceToChapterIds;
  if (existing) {
    // Opponent context moves may cover a matched reference edge; the player's context moves stay
    // as they are (they can't be accepted here), and moves below them are reported untrained.
    const byId = new Map(extracted.tree.map((node) => [node.id, node]));
    const opponentContext = extracted.contextNodeIds.filter((id) => {
      const node = byId.get(extracted.sourceToChapterIds[id]);
      return node !== undefined && playerToMove(node.fenBefore) !== record.color;
    });
    const merged = mergeIntoChapter(existing, {
      rootFen: extracted.rootFen,
      tree: extracted.tree,
      nodeMeta: incomingMeta,
      upgradeNodeIds: [...policy.includedNodeIds, ...policy.coveredNodeIds, ...opponentContext].map(
        (id) => extracted.sourceToChapterIds[id]
      )
    });
    draft = merged.chapter;
    alreadyPresent = merged.alreadyPresent;
    chapterIds = Object.fromEntries(
      Object.entries(extracted.sourceToChapterIds).map(([sourceId, copiedId]) => [
        sourceId,
        merged.idMap[copiedId]
      ])
    );
  } else {
    const title = destination.kind === "new-chapter" ? destination.title : "";
    draft = {
      id: nanoid(),
      title: chapterTitle(title, gameTitle(linkHeaders)),
      sortOrder: chapterRepository.maxSortOrder(record.id) + 1,
      kind,
      enabled: true,
      rootFen: extracted.rootFen,
      revision: 0,
      nodeCount: extracted.tree.length - 1,
      dueCount: 0,
      headers: linkHeaders,
      tree: extracted.tree,
      nodeMeta: incomingMeta
    };
  }
  const chapter = sanitizeChapter(draft, (existing?.revision ?? 0) + 1);

  // Figures against the current repertoire.
  const chapters = chapterRepository.list(record.id);
  const before = collectDecisions(record.color, chapters);
  const after = collectDecisions(record.color, [
    ...chapters.filter((item) => item.id !== chapter.id),
    chapter
  ]);
  const stored = new Map(
    decisionRepository.list(record.id).map((decision) => [decision.positionKey, decision])
  );
  const lookup = buildChapterLookup(chapter);
  const conflicts: AddFromGamePreview["conflicts"] = [];
  let decisionsAdded = 0;
  for (const [key, entry] of after) {
    // A stored decision that regains support (suspended before) is not a new one.
    if (!before.has(key) && !stored.has(key)) decisionsAdded += 1;
    const decision = stored.get(key);
    if (!decision) continue;
    const effective = effectiveAcceptedUcis(decision, before.get(key)?.acceptedUcis ?? new Set());
    if (!effective.length) continue;
    for (const uci of entry.acceptedUcis) {
      // A stored accepted move that is merely supported again isn't a difference.
      if (decision.acceptedUcis.includes(uci)) continue;
      conflicts.push({
        positionKey: key,
        fen: entry.fen,
        existingUcis: effective,
        preferredUci: decision.preferredUci,
        newUci: uci,
        newSan: sanInChapter(lookup, key, uci),
        path: pathToPosition(extracted, key) ?? ""
      });
    }
  }

  const indexed = new Set(
    positionIndexRepository
      .list(record.id)
      .filter((row) => row.chapterId !== chapter.id)
      .map((row) => row.positionKey)
  );
  const copiedKeys = new Set(
    extracted.tree
      .filter((node) => node.id !== REPERTOIRE_ROOT_NODE_ID)
      .map((node) => positionKey(node.fenAfter))
  );
  const transpositions = [...copiedKeys].filter((key) => indexed.has(key)).length;

  // Which chosen moves the stored chapter will actually ask (§7.1).
  const ownMoves = listOwnMoves(record.color, extracted);
  const chosen = new Set(policy.includedNodeIds);
  const untrained =
    kind === "opening"
      ? untrainedMoveWarnings(
          chapter,
          ownMoves
            .filter((move) => chosen.has(move.nodeId) && chapterIds[move.nodeId] !== undefined)
            .map((move) => ({
              chapterNodeId: chapterIds[move.nodeId],
              san: move.san,
              path: move.path
            }))
        )
      : { trained: 0, warnings: [] };

  const warnings: string[] = [];
  if (scope.kind === "whole-game" && !untrained.trained && !policy.includedNodeIds.length) {
    warnings.push("Whole game added as reference: nothing will be trained until you accept moves");
  } else if (kind === "reference" && policy.includedNodeIds.length) {
    warnings.push("Reference chapters never train: the chosen moves are kept as study material");
  } else if (!policy.includedNodeIds.length) {
    warnings.push("No moves are accepted: nothing from this material will be trained");
  } else if (!untrained.trained) {
    warnings.push("None of the chosen moves will be trained: nothing from this material is asked");
  }
  warnings.push(...untrained.warnings);
  if (conflicts.length) {
    const positions = new Set(conflicts.map((conflict) => conflict.positionKey)).size;
    warnings.push(
      `${positions} position${positions === 1 ? " already has" : "s already have"} another repertoire move: the new move is added as an alternative and your preferred move stays`
    );
  }

  const route = capturedRoute(source.tree, scope);
  const nodeIds = new Set(source.tree.map((node) => node.id));
  const scopeNodeId =
    scope.kind === "path" ? scope.toNodeId : scope.kind === "subtree" ? scope.fromNodeId : null;
  const gameNodeId =
    input.source.nodeId !== null && nodeIds.has(input.source.nodeId)
      ? input.source.nodeId
      : scopeNodeId;

  return {
    chapter,
    linkHeaders,
    gameNodeId,
    capturedPath: formatPath(route),
    preview: {
      chapterTitle: chapter.title,
      nodeCount: extracted.tree.length - 1,
      decisionsAdded,
      conflicts,
      transpositions,
      alreadyPresent,
      defaultPolicy,
      ownMoves,
      opponentMoves: listOpponentMoves(record.color, extracted),
      warnings
    }
  };
}

/**
 * What adding part of a game would do (§6.2), without writing anything: the chapter title, copied
 * move count, decisions gained, conflicts with existing decisions, transpositions, moves already in
 * an existing destination chapter, the default policy, the own-side move candidates and warnings.
 * The source tree is replayed and checked like a saved chapter. A null policy previews the
 * proposed defaults.
 */
export function previewAddFromGame(input: AddFromGameInput): AddFromGamePreview {
  const now = clock();
  return transaction(() => planAddFromGame(requireRepertoire(input.repertoireId), input, now))
    .preview;
}

/**
 * Copies the selected material into a new chapter, or merges it into an existing one, with the
 * confirmed policy; reconciles decisions, index and progress like saveChapter; and records a
 * `source` provenance link — all in one transaction. A move accepted where the repertoire already
 * decided another one is added as an accepted alternative; the stored preference is unchanged.
 * The policy must be explicit: a null policy is refused.
 */
export function addFromGame(input: AddFromGameInput): AddFromGameResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    if (input.policy === null) {
      throw new Error("Invalid policy: choose which moves to accept before adding");
    }
    const plan = planAddFromGame(record, input, now);
    const next = bump(record, now);
    chapterRepository.upsert(record.id, plan.chapter, now);
    const { decisionsChanged } = reindex(next, now);
    const link: RepertoireGameLink = {
      id: nanoid(),
      repertoireId: record.id,
      chapterId: plan.chapter.id,
      gameId: input.source.gameId,
      unsaved: input.source.gameId === null,
      gameNodeId: plan.gameNodeId,
      kind: "source",
      headers: plan.linkHeaders,
      capturedPath: plan.capturedPath,
      createdAt: now
    };
    gameLinkRepository.insert(link);
    return {
      repertoire: detail(record.id, now),
      chapter: loadChapter(record.id, plan.chapter.id, now),
      decisionsChanged,
      link
    };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/** PGN tag names for the saved game's header fields (orientationHint is not a tag). */
const PGN_TAGS: Partial<Record<keyof GameHeaders, string>> = {
  event: "Event",
  site: "Site",
  date: "Date",
  round: "Round",
  white: "White",
  black: "Black",
  whiteElo: "WhiteElo",
  blackElo: "BlackElo",
  timeControl: "TimeControl",
  eco: "ECO",
  opening: "Opening",
  utcDate: "UTCDate",
  utcTime: "UTCTime",
  termination: "Termination",
  result: "Result"
};

/** A saved game's headers as PGN tags (empty values dropped). */
function headerTags(headers: GameHeaders): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [field, tag] of Object.entries(PGN_TAGS)) {
    const value = headers[field as keyof GameHeaders];
    if (typeof value === "string" && value) tags[tag] = value;
  }
  return sanitizeHeaders(tags);
}

/**
 * Links a library game to the repertoire as a `model` (attached for study) or a `played` game
 * (started from the repertoire). Idempotent per repertoire, game and kind: an existing link is
 * returned, re-pointed at the given chapter/node/path when those differ. No revision bump (the
 * repertoire's content is unchanged), but listeners are told it was updated.
 */
export function linkGame(input: LinkGameInput): RepertoireGameLink {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    if (
      input.chapterId !== null &&
      chapterRepository.ownerOf(input.chapterId)?.repertoireId !== record.id
    ) {
      throw new Error("Invalid chapterId: not found");
    }
    const headers = libraryGameExists(input.gameId) ? gameRepository.getHeaders(input.gameId) : null;
    if (!headers) throw new Error("Invalid gameId: the game is not in the library");

    const target = {
      chapterId: input.chapterId,
      gameNodeId: input.gameNodeId,
      capturedPath: input.capturedPath
    };
    const existing = gameLinkRepository.find(record.id, input.gameId, input.kind);
    if (existing) {
      if (
        existing.chapterId === target.chapterId &&
        existing.gameNodeId === target.gameNodeId &&
        existing.capturedPath === target.capturedPath
      ) {
        return { link: existing, revision: record.revision };
      }
      gameLinkRepository.updateTarget(existing.id, target);
      return { link: { ...existing, ...target }, revision: record.revision };
    }
    const link: RepertoireGameLink = {
      id: nanoid(),
      repertoireId: record.id,
      gameId: input.gameId,
      kind: input.kind,
      headers: headerTags(headers),
      createdAt: now,
      ...target
    };
    gameLinkRepository.insert(link);
    return { link, revision: record.revision };
  });
  changed({ repertoireId: input.repertoireId, revision: result.revision, kind: "updated" });
  return result.link;
}

/** Provenance links of a repertoire, or of one of its chapters, oldest first. */
export function listGameLinks(input: {
  repertoireId: string;
  chapterId?: string;
}): RepertoireGameLink[] {
  requireRepertoire(input.repertoireId);
  if (
    input.chapterId !== undefined &&
    chapterRepository.ownerOf(input.chapterId)?.repertoireId !== input.repertoireId
  ) {
    throw new Error("Invalid chapterId: not found");
  }
  return gameLinkRepository.list(input.repertoireId, input.chapterId);
}

/** Removes one provenance link (the copied material stays); no revision bump. */
export function removeGameLink(input: { repertoireId: string; linkId: string }): void {
  requireRepertoire(input.repertoireId);
  const link = gameLinkRepository.get(input.linkId);
  if (!link || link.repertoireId !== input.repertoireId) {
    throw new Error("Invalid linkId: not found");
  }
  gameLinkRepository.remove(link.id);
}

/* ------------------------------------------------------------------ practice */

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

function snapshotOf(session: PracticeSessionRecord): PracticeSessionSnapshot {
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
  const card = session.cards[session.cursor];
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
      hintUci: card.hintStage >= 2 ? (policy.preferredUci ?? policy.acceptedUcis[0] ?? null) : null,
      revealed: revealed
        ? {
            ucis: policy.acceptedUcis,
            preferredUci: policy.preferredUci,
            explanation: policy.explanation ?? policy.hint
          }
        : null
    }
  };
}

/** The next unanswered card after `from` (wrapping), or `from` when none is left. */
function nextCursor(cards: readonly PracticeCard[], from: number): number {
  for (let offset = 1; offset <= cards.length; offset += 1) {
    const index = (from + offset) % cards.length;
    if (cards[index].state === "unanswered") return index;
  }
  return Math.max(0, Math.min(from, cards.length - 1));
}

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
 * don't apply and being queued records nothing. Each card freezes its policy so grading never
 * uses a moving set. Depth counts plies from the chapter root including the tested move (§5.3).
 */
export function startPractice(input: StartPracticeInput): PracticeSessionSnapshot {
  const now = clock();
  return transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    if (record.archivedAt !== null) {
      throw new Error("Invalid practice: this repertoire is archived; restore it to practice");
    }
    const chapters = chapterRepository.list(record.id);
    const known = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const scope = input.chapterIds ? new Set(input.chapterIds) : null;
    for (const id of input.chapterIds ?? []) {
      if (!known.has(id)) throw new Error(`Invalid chapterIds: "${id}" is not in this repertoire`);
    }
    const rootPlies = new Map(
      chapters.map((chapter) => [
        chapter.id,
        chapter.tree.find((node) => node.id === REPERTOIRE_ROOT_NODE_ID)?.ply ?? 0
      ])
    );
    const collected = collectDecisions(record.color, chapters);
    const decisions = new Map(
      decisionRepository.list(record.id).map((item) => [item.positionKey, item])
    );
    const progress = new Map(
      progressRepository.list(record.id).map((item) => [item.positionKey, item])
    );

    const candidates: Candidate[] = [];
    for (const entry of collected.values()) {
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

    const unseen = orderQueue(candidates.filter((candidate) => !candidate.practiced));
    let picked: Candidate[];
    if (input.positionKeys) {
      // A targeted queue: the named decisions that are eligible, in the given order, due or not.
      const byKey = new Map(
        candidates.map((candidate) => [candidate.entry.positionKey, candidate])
      );
      picked = [...new Set(input.positionKeys)]
        .map((key) => byKey.get(key))
        .filter((candidate): candidate is Candidate => candidate !== undefined)
        .filter((candidate) => input.mode === "review-due" || !candidate.practiced);
    } else if (input.mode === "learn-new") {
      picked = unseen.slice(0, input.cardLimit ?? DEFAULT_LEARN_LIMIT);
    } else {
      const due = orderQueue(
        candidates.filter(
          (candidate) => candidate.practiced && candidate.dueAt !== null && candidate.dueAt <= now
        ),
        now
      ).slice(0, input.cardLimit ?? DEFAULT_DUE_LIMIT);
      picked = [...due, ...unseen.slice(0, input.newCardLimit ?? DEFAULT_NEW_AFTER_DUE)];
    }

    const lookups = new Map<string, ChapterLookup>();
    const lookupOf = (chapterId: string) => {
      let lookup = lookups.get(chapterId);
      if (!lookup) {
        lookup = buildChapterLookup(known.get(chapterId)!);
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
        explanation: node.comment ?? null,
        progressAt: progress.get(candidate.entry.positionKey)?.lastAttemptAt ?? null
      };
    });

    const session: PracticeSessionRecord = {
      id: nanoid(),
      repertoireId: record.id,
      mode: input.mode,
      scope: {
        repertoireId: record.id,
        ...(input.chapterIds ? { chapterIds: [...input.chapterIds] } : {}),
        ...(input.maxDepthPlies !== undefined ? { maxDepthPlies: input.maxDepthPlies } : {}),
        ...(input.cardLimit !== undefined ? { cardLimit: input.cardLimit } : {}),
        ...(input.newCardLimit !== undefined ? { newCardLimit: input.newCardLimit } : {}),
        ...(input.positionKeys ? { positionKeys: [...input.positionKeys] } : {})
      },
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

function requireSession(sessionId: string): PracticeSessionRecord {
  const session = sessionRepository.get(sessionId);
  if (!session) throw new Error("Invalid sessionId: not found");
  return session;
}

function requireActiveSession(sessionId: string): PracticeSessionRecord {
  const session = requireSession(sessionId);
  if (session.status !== "active")
    throw new Error("Invalid sessionId: this practice session has ended");
  return session;
}

function cardIndex(session: PracticeSessionRecord, queueItemId: string): number {
  const index = session.cards.findIndex((card) => card.queueItemId === queueItemId);
  if (index < 0) throw new Error("Invalid queueItemId: not in this practice session");
  return index;
}

/**
 * A card can still be graded: its repertoire isn't archived, and the decision it was frozen from
 * is unchanged (same accepted set, supported, not paused) and not graded since by another session.
 */
function stillCurrent(repertoireId: string, positionKey: string, policy: FrozenPolicy): boolean {
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

function historyAction(attempt: AttemptRecord): PracticeHistoryAction {
  if (attempt.kind === "attempt") {
    return { kind: "attempt", legal: attempt.legal, correct: attempt.correct };
  }
  return { kind: attempt.kind };
}

/**
 * Applies a card's final outcome to its progress (scheduler v1). Callers first check the card is
 * still current (§8.3: no grade against a moving set). Returns whether it was written.
 */
function applySchedule(
  repertoireId: string,
  card: PracticeCard,
  policy: FrozenPolicy,
  outcome: PracticeOutcome,
  now: number
): boolean {
  const previous = progressRepository.get(repertoireId, card.positionKey);
  const schedule = scheduleAfterOutcome(previous, outcome, now, previous?.lastAttemptAt);
  if (!schedule) return false;
  progressRepository.upsert({
    repertoireId,
    positionKey: card.positionKey,
    ...schedule,
    acceptanceFingerprint: policy.fingerprint,
    suspended: false
  });
  return true;
}

const gradeIsFinal = (card: PracticeCard) =>
  card.state === "answered-correct" || card.state === "answered-wrong" || card.state === "revealed";

function progressChanged(repertoireId: string): void {
  const record = repertoireRepository.get(repertoireId);
  if (record) changed({ repertoireId, revision: record.revision, kind: "progress" });
}

/**
 * Grades a submitted move. Idempotent on `attemptId` (a replay returns the stored result). The
 * first legal answer fixes the grade (with any earlier hint making it assisted); later retries of
 * a wrongly answered card are ungraded reinforcement. Illegal moves change nothing but are kept.
 * A card whose decision is no longer current is skipped ungraded (`stale`). The stored cursor moves
 * on only after a correct answer: a wrongly answered card stays current for its retries.
 */
export function recordAttempt(input: RecordAttemptInput): AttemptResult {
  let scheduled = false;
  let repertoireId = "";
  const result = transaction((): AttemptResult => {
    const prior = attemptRepository.get(input.attemptId);
    if (prior) {
      if (
        prior.sessionId !== input.sessionId ||
        prior.queueItemId !== input.queueItemId ||
        !prior.resultJson
      ) {
        throw new Error("Invalid attemptId: already used for another card");
      }
      return JSON.parse(prior.resultJson) as AttemptResult;
    }
    const session = requireActiveSession(input.sessionId);
    repertoireId = session.repertoireId;
    const index = cardIndex(session, input.queueItemId);
    const card = { ...session.cards[index] };
    const policy = session.policies[card.queueItemId];
    const now = Math.max(clock(), attemptRepository.lastAt(session.id) ?? -Infinity);
    const history = attemptRepository.list(session.id, card.queueItemId);
    const sequence = (history.at(-1)?.sequence ?? 0) + 1;
    const uci = normalizeUci(card.fen, input.uci);
    const legal = fenAfterMove(card.fen, uci) !== null;
    const correct = legal && policy.acceptedUcis.includes(uci);

    let outcome: AttemptResult["outcome"];
    let finalGrade = false;
    let gradeOutcome: PracticeOutcome | null = null;
    if (
      card.state === "answered-correct" ||
      card.state === "revealed" ||
      card.state === "skipped"
    ) {
      outcome = "already-final";
    } else if (!legal) {
      outcome = "illegal";
    } else if (
      card.state === "unanswered" &&
      !stillCurrent(session.repertoireId, card.positionKey, policy)
    ) {
      outcome = "stale";
      card.state = "skipped";
    } else {
      outcome = correct ? "correct" : "outside-repertoire";
      card.attemptsSoFar += 1;
      if (card.state === "unanswered") {
        gradeOutcome = firstAnswerOutcome([
          ...history.map(historyAction),
          { kind: "attempt", legal: true, correct }
        ]);
        finalGrade = true;
        card.state = correct ? "answered-correct" : "answered-wrong";
        scheduled = applySchedule(session.repertoireId, card, policy, gradeOutcome, now);
      }
    }

    // A wrong answer keeps the answer hidden so the card can be retried (§5.3); a correct retry,
    // like any other final state, shows the accepted set.
    const revealed = card.state === "answered-wrong" ? correct : gradeIsFinal(card);
    const result: AttemptResult = {
      outcome,
      acceptedUcis: revealed ? policy.acceptedUcis : [],
      preferredUci: revealed ? policy.preferredUci : null,
      feedback: outcome === "outside-repertoire" ? (policy.wrongMoveFeedback[uci] ?? null) : null,
      card,
      finalGrade
    };
    attemptRepository.insert({
      attemptId: input.attemptId,
      sessionId: session.id,
      queueItemId: card.queueItemId,
      sequence,
      kind: "attempt",
      uci,
      legal,
      correct,
      isFinalGrade: finalGrade,
      outcome: gradeOutcome,
      positionKey: card.positionKey,
      fingerprint: policy.fingerprint,
      resultJson: JSON.stringify(result),
      at: now
    });
    session.cards[index] = card;
    if (outcome === "correct" || outcome === "stale") {
      session.cursor = nextCursor(session.cards, index);
    }
    session.updatedAt = now;
    sessionRepository.save(session);
    return result;
  });
  if (scheduled) progressChanged(repertoireId);
  return result;
}

/**
 * Hint, reveal or skip, persisted before the result is returned. Hints raise the card's hint
 * stage (1: authored hint; 2: the piece of the preferred move; 3: its squares) and make a later
 * correct answer assisted. Reveal fixes an unanswered card's grade as a lapse; skip leaves the
 * schedule unchanged.
 */
export function recordPracticeAction(input: PracticeActionInput): PracticeActionResult {
  let scheduled = false;
  let repertoireId = "";
  const result = transaction((): PracticeActionResult => {
    const session = requireActiveSession(input.sessionId);
    repertoireId = session.repertoireId;
    const index = cardIndex(session, input.queueItemId);
    const card = { ...session.cards[index] };
    const policy = session.policies[card.queueItemId];
    const now = Math.max(clock(), attemptRepository.lastAt(session.id) ?? -Infinity);
    const history = attemptRepository.list(session.id, card.queueItemId);
    const kind = input.action.kind;
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
      card.hintStage = Math.min(card.hintStage + 1, 3) as PracticeCard["hintStage"];
      revealed = {
        ucis: [],
        preferredUci:
          card.hintStage >= 2 ? (policy.preferredUci ?? policy.acceptedUcis[0] ?? null) : null,
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
        scheduled = applySchedule(session.repertoireId, card, policy, outcome, now);
        session.cursor = nextCursor(session.cards, index);
      } else if (card.state === "answered-wrong") {
        persist(false, null);
      }
      revealed = {
        ucis: policy.acceptedUcis,
        preferredUci: policy.preferredUci,
        explanation: policy.explanation ?? policy.hint
      };
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
  if (scheduled) progressChanged(repertoireId);
  return result;
}

/**
 * Reopens a session. When the repertoire changed since the session froze its policies, unanswered
 * cards that are no longer current (see stillCurrent) are dropped as skipped.
 */
export function resumePractice(sessionId: string): PracticeSessionSnapshot {
  const now = clock();
  return transaction(() => {
    const session = requireSession(sessionId);
    if (session.status === "finished") return snapshotOf(session);
    const record = requireRepertoire(session.repertoireId);
    if (record.revision !== session.snapshotRevision) {
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
      chapters: [...new Set(session.cards.map((card) => card.chapterId))],
      missedPositionKeys: [
        ...new Set(
          finals
            .filter((attempt) => attempt.outcome === "wrong" || attempt.outcome === "reveal")
            .map((attempt) => attempt.positionKey)
        )
      ]
    };
  });
}

/** Forgets pending import jobs (tests). */
export function resetImportJobs(): void {
  importJobs.clear();
}
