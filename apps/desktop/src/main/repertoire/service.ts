/**
 * The repertoire authority (design §7–§10): revision checks, decision reconciliation, the derived
 * position index, progress invalidation, PGN import/export and practice grading. Every mutation
 * runs in one transaction; change events are broadcast only after it commits.
 */
import { app, BrowserWindow, dialog } from "electron";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";
import {
  CHAPTER_NOT_FOUND_ERROR,
  COMPARE_GAME_MAX_PLIES,
  REPERTOIRE_POSITION_KEY_VERSION,
  REPERTOIRE_ROOT_NODE_ID,
  REPERTOIRE_SCHEDULER_VERSION,
  type BackupImportPreview,
  type ExportBackupInput,
  type ExportBackupResult,
  type PreviewBackupImportInput,
  type RepertoireBackupDocument,
  type RepertoireBackupEntry,
  type RestoreBackupInput,
  type RestoreBackupResult,
  type RestoreBackupSelection,
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
  type ImportProgressEvent,
  type ImportResult,
  type PracticeActionInput,
  type PracticeActionResult,
  type PracticeAnswer,
  type PracticeCard,
  type PracticeLeadUpMove,
  type PracticeSessionSnapshot,
  type PracticeSummary,
  type PracticeTotals,
  type PreviewImportInput,
  type RecordAttemptInput,
  type RehearsalStep,
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
  type UpdateChaptersInput,
  type UpdateChaptersResult,
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
  effectiveAcceptedUcis,
  effectivePreferredUci,
  nodeMetaOf,
  type ChapterLookup,
  type CollectedDecision,
  type DecisionOccurrence
} from "@chaturanga/shared/chess/repertoire-index";
import {
  firstAnswerOutcome,
  MAX_STAGE,
  orderQueue,
  scheduleAfterOutcome,
  type PracticeHistoryAction,
  type PracticeOutcome
} from "@chaturanga/shared/chess/repertoire-scheduler";
import { compareGameToRepertoire } from "@chaturanga/shared/chess/repertoire-compare";
import {
  buildBackupDocument,
  DEFAULT_BACKUP_LIMITS,
  diffBackupEntry,
  remapBackupEntry,
  stripForExport,
  validateBackupDocument
} from "@chaturanga/shared/chess/repertoire-backup";
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
import { exportRepertoirePgn, formatPath } from "@chaturanga/shared/chess/repertoire-pgn";
import { databasePath } from "../db";
import { gameRepository } from "../db/repositories";
import { broadcast } from "../ipc/broadcast";
import {
  DEFAULT_IMPORT_LIMITS,
  ImportCancelledError,
  type ImportedGame,
  type ImportLimits,
  type ImportProgress
} from "./import-job";
import { startImportParse, type ImportRun } from "./import-runner";
import { runImportCommit } from "./import-writer";
import {
  bump,
  checkRevision,
  detail,
  memoizedPositionKey,
  reindex,
  reindexChapter,
  reindexPositions,
  requireRepertoire,
  type ImportCommitChapter
} from "./core";
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
  actionableBusyError,
  RepertoireCorruptChapterError,
  transaction,
  workspaceRepository,
  type AttemptKind,
  type AttemptRecord,
  type FrozenPolicy,
  type PracticeSessionRecord,
  type RehearsalState,
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

/**
 * The stored version of a chapter about to be overwritten or removed; undefined when it is
 * damaged, so the caller rebuilds the derived state in full instead of updating it.
 */
function storedChapter(chapterId: string): RepertoireChapter | undefined {
  try {
    return chapterRepository.get(chapterId) ?? undefined;
  } catch (error) {
    if (error instanceof RepertoireCorruptChapterError) return undefined;
    throw error;
  }
}

/** A stored chapter with its current due count. */
function loadChapter(repertoireId: string, chapterId: string, now: number): RepertoireChapter {
  if (chapterRepository.ownerOf(chapterId)?.repertoireId !== repertoireId) {
    throw new Error(CHAPTER_NOT_FOUND_ERROR);
  }
  const chapter = chapterRepository.get(chapterId)!;
  return { ...chapter, dueCount: chapterRepository.dueCount(chapterId, now) };
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

/**
 * Due decisions across active repertoires, the most recent study place, and the practice session
 * to resume (Home card and hub).
 */
export function getDueSummary(): RepertoireDueSummary {
  const now = clock();
  const totals = repertoireRepository.dueTotals(now);
  const place = repertoireRepository.lastStudyPlace();
  const session = sessionRepository.lastActive();
  return {
    ...totals,
    continue: place
      ? {
          repertoireId: place.repertoireId,
          chapterId: place.chapterId,
          nodeId: place.nodeId ?? REPERTOIRE_ROOT_NODE_ID
        }
      : null,
    resume: session
      ? { repertoireId: session.repertoireId, sessionId: session.id, mode: session.mode }
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
 * Saves one chapter (new or existing) and reconciles decisions, index and progress
 * (reindexChapter: nothing for a change the index doesn't read, such as a comment; otherwise only
 * this chapter's rows and the positions it changed). An existing chapter must carry its stored
 * revision: another write (e.g. a decision change rewriting its edges) may have changed it since
 * the draft was loaded.
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
    const before = owner ? storedChapter(chapter.id) : null;
    const next = bump(record, now);
    chapterRepository.upsert(record.id, chapter, now);
    const { decisionsChanged } =
      before === undefined ? reindex(next, now) : reindexChapter(next, before, chapter, now);
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
    // Only chapters the index places the position in can hold it; their keys come from the index.
    // Without new accepted moves no edge changes, so the first chapter holding it is enough.
    const chapterIds = new Set(
      positionIndexRepository
        .occurrences(record.id, input.positionKey)
        .map((occurrence) => occurrence.chapterId)
    );
    const occurrences: Occurrence[] = [];
    for (const chapterId of chapterIds) {
      if (occurrences.length && input.patch.acceptedUcis === undefined) break;
      const stored = chapterRepository.get(chapterId)!;
      const chapter = { ...stored, nodeMeta: { ...stored.nodeMeta } };
      const storedKeys = positionIndexRepository.chapterKeys(chapter.id);
      const seed = new Map<string, string>();
      for (const node of chapter.tree) {
        const key = storedKeys.get(node.id);
        if (key !== undefined) seed.set(node.fenAfter, key);
      }
      const lookup = buildChapterLookup(chapter, memoizedPositionKey(seed));
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
    // A change that rewrote chapter edges rebuilds the whole repertoire. New accepted moves or a
    // cleared preference reconcile the decision's own position only. Anything else (prompt, hint,
    // feedback, pause, another accepted preference) leaves the derived state as it was.
    if (touchedChapters.size) reindex(bumped, now);
    else if (patch.acceptedUcis !== undefined || patch.preferredUci === null) {
      reindexPositions(bumped, [input.positionKey], now);
    }
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
      throw new Error(CHAPTER_NOT_FOUND_ERROR);
    }
    const before = storedChapter(input.chapterId);
    const next = bump(record, now);
    if (before === undefined) {
      chapterRepository.remove(input.chapterId);
      reindex(next, now);
    } else {
      // Before the row goes: removing it drops the chapter's index rows, which the update reads.
      reindexChapter(next, before, null, now);
      chapterRepository.remove(input.chapterId);
    }
    return { repertoire: detail(record.id, now) };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/**
 * Sets practice eligibility and/or kind on several chapters at once (the chapter list's bulk
 * actions): one revision check, one bump and one reconciliation in a single transaction, rather
 * than one chapter save per row. Chapters already in the requested state keep their revision; when
 * none changes, nothing is written and the repertoire keeps its revision too.
 */
export function updateChapters(input: UpdateChaptersInput): UpdateChaptersResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    const stored = new Map(
      chapterRepository.summaries(record.id, now).map((chapter) => [chapter.id, chapter])
    );
    let chaptersChanged = 0;
    for (const chapterId of new Set(input.chapterIds)) {
      const chapter = stored.get(chapterId);
      if (!chapter) throw new Error("Invalid chapterIds: not found");
      const kind = input.patch.kind ?? chapter.kind;
      const enabled = input.patch.enabled ?? chapter.enabled;
      if (kind === chapter.kind && enabled === chapter.enabled) continue;
      chapterRepository.updateSettings(
        chapterId,
        { kind, enabled, revision: chapter.revision + 1 },
        now
      );
      chaptersChanged += 1;
    }
    if (chaptersChanged) reindex(bump(record, now), now);
    return { repertoire: detail(record.id, now), chaptersChanged };
  });
  if (result.chaptersChanged) {
    changed({
      repertoireId: input.repertoireId,
      revision: result.repertoire.revision,
      kind: "updated"
    });
  }
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

type ImportJob = { games: ImportedGame[]; expiresAt: number };
/** Previewed imports waiting for a commit, oldest first. */
const importJobs = new Map<string, ImportJob>();
/** Imports still being parsed (in the import worker), oldest first. */
const runningImports = new Map<string, ImportRun>();
/** The limits previews enforce (replaced in tests). */
let importLimits: ImportLimits = DEFAULT_IMPORT_LIMITS;

/** Worker files the import uses; unset: the bundled ones next to the main entry. */
let importWorkers: { parse?: string; writer?: string } = {};

/** Points the import at other worker files (tests and benchmarks only); nothing restores them. */
export function setImportWorkers(next: { parse?: string; writer?: string } = {}): void {
  importWorkers = next;
}

/** Replaces the import limits (tests only); pass nothing to restore the defaults. */
export function setImportLimits(next?: Partial<ImportLimits>): void {
  importLimits = { ...DEFAULT_IMPORT_LIMITS, ...next };
}

function pruneImportJobs(now: number): void {
  for (const [jobId, job] of importJobs) if (job.expiresAt <= now) importJobs.delete(jobId);
}

/**
 * Keeps room for one more job: running and previewed jobs together stay under MAX_IMPORT_JOBS.
 * The oldest previewed jobs are dropped first; a running parse is never cancelled for room, so
 * with only running parses left the new preview is refused.
 */
function makeRoomForImport(): void {
  while (importJobs.size + runningImports.size >= MAX_IMPORT_JOBS) {
    const [pending] = importJobs.keys();
    if (pending === undefined) {
      throw new Error("Another import is still parsing; wait or cancel it.");
    }
    importJobs.delete(pending);
  }
}

function importProgress(
  jobId: string,
  phase: ImportProgressEvent["phase"],
  progress: Omit<ImportProgress, "phase">,
  error: string | null = null
): void {
  const event: ImportProgressEvent = {
    jobId,
    phase,
    bytesRead: progress.bytesRead,
    totalBytes: progress.totalBytes,
    gamesSeen: progress.gamesSeen,
    nodesSeen: progress.nodesSeen,
    error
  };
  broadcast("repertoires:importProgress", event);
}

/**
 * Parses every game of a PGN text (pasted, or read through the native file picker) in the import
 * worker, into a pending job that expires after 30 minutes. The job id is the caller's `jobId`
 * (generated when omitted); it is registered before this returns its promise, so `cancelImport`
 * works at once, even before the first progress event. Progress goes out as
 * `repertoires:importProgress` events ending with `ready`, `failed` or `cancelled`. Bounded by
 * the import limits (20 MiB, games, moves, depth); the first limit crossed rejects with its
 * actionable message, while a comment over its limit only rejects its game. Running and pending jobs together stay under MAX_IMPORT_JOBS: a
 * new preview drops the oldest pending job, and is refused while only running parses fill them.
 */
export async function previewImport(input: PreviewImportInput): Promise<ImportPreview> {
  const text = input.pgn;
  if (typeof text !== "string" || text.length > MAX_PGN_BYTES) {
    throw new Error("Invalid PGN: expected text up to 20 MiB");
  }
  const jobId = input.jobId ?? nanoid();
  if (runningImports.has(jobId) || importJobs.has(jobId)) {
    throw new Error("Invalid jobId: already in use");
  }
  pruneImportJobs(clock());
  makeRoomForImport();
  let last: Omit<ImportProgress, "phase"> = {
    bytesRead: 0,
    totalBytes: null,
    gamesSeen: 0,
    nodesSeen: 0
  };
  const run = startImportParse(
    { jobId, source: { kind: "text", text }, limits: importLimits },
    (progress) => {
      last = progress;
      importProgress(jobId, progress.phase, progress);
    },
    importWorkers.parse,
    app.isPackaged === true
  );
  runningImports.set(jobId, run);
  let games: ImportedGame[];
  try {
    games = (await run.result).games;
  } catch (error) {
    if (error instanceof ImportCancelledError) {
      importProgress(jobId, "cancelled", last);
    } else {
      importProgress(jobId, "failed", last, error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    if (runningImports.get(jobId) === run) runningImports.delete(jobId);
  }
  const now = clock();
  pruneImportJobs(now);
  importJobs.set(jobId, { games, expiresAt: now + IMPORT_JOB_TTL_MS });
  importProgress(jobId, "ready", {
    ...last,
    bytesRead: last.totalBytes ?? last.bytesRead,
    gamesSeen: games.length,
    nodesSeen: games.reduce((sum, game) => sum + game.nodeCount, 0)
  });
  return {
    jobId,
    games: games.map((game) => ({
      index: game.index,
      proposedTitle: game.proposedTitle,
      rootFen: game.rootFen,
      headers: game.headers,
      nodeCount: game.nodeCount,
      // Only a game with illegal branches offers lines to exclude; the others send no tree.
      tree: game.invalidBranches.length ? game.tree : [],
      warnings: game.warnings,
      invalidBranches: game.invalidBranches
    }))
  };
}

/* Repertoire write gate (design §11): one repertoire write at a time, across every repertoire. */
let writeGate: Promise<unknown> = Promise.resolve();

/**
 * Runs a repertoire write once every write already admitted has finished, and settles with its
 * value. Every repertoire write goes through here (the IPC handlers wrap each one; an import
 * commit holds the gate while the writer worker runs its whole transaction), so a main-thread
 * write waits for the writer asynchronously instead of sleeping in SQLite's busy handler with the
 * main process blocked. Reads never pass the gate. A failed write doesn't block the ones after
 * it; a write that still finds the database locked rejects with the actionable busy error.
 */
export function withRepertoireWriteGate<T>(work: () => T | Promise<T>): Promise<T> {
  const run = async () => {
    try {
      return await work();
    } catch (error) {
      throw actionableBusyError(error);
    }
  };
  const result = writeGate.then(run, run);
  writeGate = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Commits the selected games of a previewed job as new chapters, atomically, in the import writer
 * worker on its own connection (core.ts `commitImportJob`). It holds the write gate until the
 * worker replies, so other repertoire writes wait behind it; `repertoires:changed` goes out only
 * after the commit is stored. The selections are checked here first; a failed commit writes
 * nothing and keeps the job.
 */
export function commitImport(input: ImportCommitInput): Promise<ImportResult> {
  return withRepertoireWriteGate(() => storeImport(input));
}

async function storeImport(input: ImportCommitInput): Promise<ImportResult> {
  const now = clock();
  pruneImportJobs(now);
  const job = importJobs.get(input.jobId);
  if (!job)
    throw new Error("Invalid jobId: the import expired or was cancelled; preview the PGN again");
  // Checked again inside the writer's transaction.
  checkRevision(requireRepertoire(input.repertoireId), input.expectedRevision);
  const selections = input.selections.filter((selection) => selection.include);
  if (!selections.length) throw new Error("Invalid selections: choose at least one game to import");
  if (new Set(selections.map((selection) => selection.gameIndex)).size !== selections.length) {
    throw new Error("Invalid selections: each game can be included only once");
  }
  const gamesByIndex = new Map(job.games.map((game) => [game.index, game]));
  const chapters: ImportCommitChapter[] = selections.map((selection) => {
    const game = gamesByIndex.get(selection.gameIndex);
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
    return {
      title: selection.title,
      proposedTitle: game.proposedTitle,
      kind: selection.kind,
      rootFen: game.rootFen,
      headers: game.headers,
      tree: game.tree,
      excludeNodeIds: selection.excludeNodeIds ?? [],
      positionKeys: game.positionKeys
    };
  });
  const result = await runImportCommit(
    {
      repertoireId: input.repertoireId,
      expectedRevision: input.expectedRevision,
      now,
      maxNodes: importLimits.maxNodes,
      chapters
    },
    databasePath,
    importWorkers.writer,
    app.isPackaged === true
  );
  importJobs.delete(input.jobId);
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/**
 * Cancels an import: a running parse stops (its preview rejects with "The import was cancelled."
 * and a `cancelled` progress event follows), and a previewed job is forgotten. Nothing was written
 * either way; an unknown job id is ignored.
 */
export function cancelImport(jobId: string): void {
  const running = runningImports.get(jobId);
  if (running) {
    runningImports.delete(jobId);
    running.cancel();
  }
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
  }, "read");
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
  return transaction(
    () => planAddFromGame(requireRepertoire(input.repertoireId), input, now),
    "read"
  ).preview;
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
 * returned, re-pointed at the given chapter/node/path when those differ and with its headers
 * copied again from the game when they changed (a played game that has since finished). No
 * revision bump (the repertoire's content is unchanged), but listeners are told it was updated.
 */
export function linkGame(input: LinkGameInput): RepertoireGameLink {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    if (
      input.chapterId !== null &&
      chapterRepository.ownerOf(input.chapterId)?.repertoireId !== record.id
    ) {
      throw new Error(CHAPTER_NOT_FOUND_ERROR);
    }
    const headers = libraryGameExists(input.gameId)
      ? gameRepository.getHeaders(input.gameId)
      : null;
    if (!headers) throw new Error("Invalid gameId: the game is not in the library");
    const tags = headerTags(headers);

    const target = {
      chapterId: input.chapterId,
      gameNodeId: input.gameNodeId,
      capturedPath: input.capturedPath
    };
    const existing = gameLinkRepository.find(record.id, input.gameId, input.kind);
    if (existing) {
      const sameTarget =
        existing.chapterId === target.chapterId &&
        existing.gameNodeId === target.gameNodeId &&
        existing.capturedPath === target.capturedPath;
      const sameHeaders = JSON.stringify(existing.headers) === JSON.stringify(tags);
      if (sameTarget && sameHeaders) return { link: existing, revision: record.revision };
      if (!sameTarget) gameLinkRepository.updateTarget(existing.id, target);
      if (!sameHeaders) gameLinkRepository.updateHeaders(existing.id, tags);
      return { link: { ...existing, ...target, headers: tags }, revision: record.revision };
    }
    const link: RepertoireGameLink = {
      id: nanoid(),
      repertoireId: record.id,
      gameId: input.gameId,
      unsaved: false,
      kind: input.kind,
      headers: tags,
      createdAt: now,
      ...target
    };
    try {
      gameLinkRepository.insert(link);
    } catch (error) {
      // An unreleased build created migration 8 without 'played'; its databases still refuse it.
      if (input.kind === "played" && /CHECK constraint failed/.test(String(error))) {
        throw new Error(
          "Invalid kind: this database predates played links; reset the development database",
          { cause: error }
        );
      }
      throw error;
    }
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
    throw new Error(CHAPTER_NOT_FOUND_ERROR);
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
      revealed: revealed ? answerOf(policy) : null
    }
  };
}

/**
 * A card's answer as the page shows it once the grade is final: the accepted moves, the
 * position's explanation (its comment, else the hint) and the accepted moves' own comments.
 */
function answerOf(policy: FrozenPolicy): PracticeAnswer {
  return {
    ucis: policy.acceptedUcis,
    preferredUci: policy.preferredUci,
    explanation: policy.explanation ?? policy.hint,
    ...(policy.moveComments ? { moveComments: policy.moveComments } : {})
  };
}

/** The comments of the accepted moves played from `nodeId` in its chapter, by UCI. */
function acceptedMoveComments(
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
    if (input.mode === "rehearse-lines") return startRehearsal(input, record, now);
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
        moveComments: acceptedMoveComments(lookup, nodeId, candidate.effective),
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
    if (session.mode === "rehearse-lines") return rehearsalAttempt(session, input);
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
    const answer = revealed ? answerOf(policy) : null;
    const result: AttemptResult = {
      outcome,
      acceptedUcis: answer?.ucis ?? [],
      preferredUci: answer?.preferredUci ?? null,
      ...(answer
        ? {
            explanation: answer.explanation,
            ...(answer.moveComments ? { moveComments: answer.moveComments } : {})
          }
        : {}),
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
    if (session.mode === "rehearse-lines") return rehearsalAction(session, input);
    repertoireId = session.repertoireId;
    const index = cardIndex(session, input.queueItemId);
    const card = { ...session.cards[index] };
    const policy = session.policies[card.queueItemId];
    const now = Math.max(clock(), attemptRepository.lastAt(session.id) ?? -Infinity);
    const history = attemptRepository.list(session.id, card.queueItemId);
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
  if (scheduled) progressChanged(repertoireId);
  return result;
}

/* ------------------------------------------------------------------ practice: rehearse lines */

/** Marker stored in an attempt row's `outcome` for an answer from another line (not a miss). */
const OTHER_LINE = "other-line";

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
function loadRehearsal(session: PracticeSessionRecord): Rehearsal | null {
  const current = currentRehearsal(session);
  if (!current) return null;
  const { state, chapter, color } = current;
  return { state, chapter, context: rehearsalContext(chapter, color, state.maxDepthPlies), color };
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
function finishStale(session: PracticeSessionRecord): void {
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
  const plan = planRoute(context, state.fromNodeId, pending, state.seen, new Set(state.finished));
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
 * or completes the line and starts the next one.
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
  if (replyNode.id === state.lineEnd) return complete(reply);
  const next = pushRehearsalCard(session, rehearsal, replyNode.id, stepIndex + 1);
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
function startRehearsal(
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
  const context = rehearsalContext(chapter, record.color, maxDepthPlies);
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

/**
 * Rehearsal grading (§5.3). Only the current card can be answered. The line's own move is
 * correct: the first legal answer fixes the session grade (never progress), and the line goes on
 * with the next authored reply and decision. Another accepted choice at this position is
 * `other-line`: not a miss, the card stays open. Anything else is outside the repertoire: the card
 * stays current for retries. A changed chapter ends the session (`stale`).
 */
function rehearsalAttempt(
  session: PracticeSessionRecord,
  input: RecordAttemptInput
): AttemptResult {
  const index = cardIndex(session, input.queueItemId);
  const card = { ...session.cards[index] };
  const policy = session.policies[card.queueItemId];
  const now = Math.max(clock(), attemptRepository.lastAt(session.id) ?? -Infinity);
  const history = attemptRepository.list(session.id, card.queueItemId);
  const uci = normalizeUci(card.fen, input.uci);
  const legal = fenAfterMove(card.fen, uci) !== null;
  const correct = legal && uci === policy.acceptedUcis[0];
  const open =
    index === session.cursor && (card.state === "unanswered" || card.state === "answered-wrong");

  let outcome: AttemptResult["outcome"];
  let finalGrade = false;
  let recorded: string | null = null;
  let otherLine: AttemptResult["otherLine"] | null = null;
  let step: RehearsalStep | undefined;
  const rehearsal = open && legal ? loadRehearsal(session) : null;
  if (!open) {
    outcome = "already-final";
  } else if (!legal) {
    outcome = "illegal";
  } else if (!rehearsal) {
    outcome = "stale";
    finishStale(session);
    if (card.state === "unanswered") card.state = "skipped";
  } else if (correct) {
    outcome = "correct";
    card.attemptsSoFar += 1;
    if (card.state === "unanswered") {
      recorded = firstAnswerOutcome([
        ...gradedHistory(history),
        { kind: "attempt", legal: true, correct: true }
      ]);
      finalGrade = true;
      card.state = "answered-correct";
    }
    session.cards[index] = card;
    const child = nextOnRoute(rehearsal.context.lookup, card.nodeId, rehearsal.state.lineEnd)!;
    step = continueLine(session, rehearsal, child.id, card.rehearsal?.stepIndex ?? 0);
  } else if ((otherLine = findOtherLine(session, rehearsal, card, uci))) {
    outcome = "other-line";
    card.attemptsSoFar += 1;
    recorded = OTHER_LINE;
  } else {
    outcome = "outside-repertoire";
    card.attemptsSoFar += 1;
    if (card.state === "unanswered") {
      recorded = firstAnswerOutcome([
        ...gradedHistory(history),
        { kind: "attempt", legal: true, correct: false }
      ]);
      finalGrade = true;
      card.state = "answered-wrong";
    }
  }

  // A stale answer reveals nothing: the line it was checked against is no longer the chapter's.
  const revealed =
    outcome !== "stale" && (card.state === "answered-wrong" ? correct : gradeIsFinal(card));
  const result: AttemptResult = {
    outcome,
    ...(otherLine ? { otherLine } : {}),
    ...(step ? { rehearsal: step } : {}),
    acceptedUcis: revealed ? policy.acceptedUcis : [],
    preferredUci: revealed ? policy.preferredUci : null,
    feedback: outcome === "outside-repertoire" ? (policy.wrongMoveFeedback[uci] ?? null) : null,
    card,
    finalGrade,
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
    isFinalGrade: finalGrade,
    outcome: recorded,
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

/**
 * Rehearsal actions on the current card. Hints work as in the other modes. Reveal misses an
 * unanswered card, then plays the line's move and continues. Skip abandons the current line (not
 * completed) and starts the next one. Follow-other-line, right after an `other-line` answer,
 * switches to that occurrence (same chapter only) and continues from it. A reveal, skip or follow
 * of a card the line has already left (a retry after a lost response) returns the card unchanged.
 */
function rehearsalAction(
  session: PracticeSessionRecord,
  input: PracticeActionInput
): PracticeActionResult {
  const index = cardIndex(session, input.queueItemId);
  const kind = input.action.kind;
  if (index !== session.cursor) {
    // A retry after a lost response: the line already moved on, so the card is returned as it is.
    const settled = session.cards[index];
    const policy = session.policies[settled.queueItemId];
    if (kind === "reveal") {
      return {
        card: settled,
        revealed: {
          ucis: policy.acceptedUcis,
          preferredUci: policy.preferredUci,
          explanation: policy.explanation ?? policy.hint
        }
      };
    }
    if (kind === "skip" || kind === "follow-other-line") return { card: settled };
    throw new Error("Invalid queueItemId: not the current card of this rehearsal");
  }
  const card = { ...session.cards[index] };
  const policy = session.policies[card.queueItemId];
  const now = Math.max(clock(), attemptRepository.lastAt(session.id) ?? -Infinity);
  const history = attemptRepository.list(session.id, card.queueItemId);
  const persist = (
    attemptKind: AttemptKind,
    isFinalGrade: boolean,
    outcome: string | null,
    correct = false
  ) =>
    attemptRepository.insert({
      attemptId: nanoid(),
      sessionId: session.id,
      queueItemId: card.queueItemId,
      sequence: (history.at(-1)?.sequence ?? 0) + 1,
      kind: attemptKind,
      uci: null,
      legal: true,
      correct,
      isFinalGrade,
      outcome,
      positionKey: card.positionKey,
      fingerprint: policy.fingerprint,
      resultJson: null,
      at: now
    });
  const save = (result: PracticeActionResult): PracticeActionResult => {
    session.updatedAt = now;
    sessionRepository.save(session);
    return result;
  };
  const revealed = {
    ucis: policy.acceptedUcis,
    preferredUci: policy.preferredUci,
    explanation: policy.explanation ?? policy.hint
  };

  if (kind === "hint") {
    // A changed chapter ends the rehearsal before a hint is given (or recorded) on its old card.
    if (!currentRehearsal(session)) {
      finishStale(session);
      return save({ card: session.cards[index], sessionEnded: true });
    }
    persist("hint", false, null);
    card.hintStage = Math.min(card.hintStage + 1, 3) as PracticeCard["hintStage"];
    session.cards[index] = card;
    return save({
      card,
      revealed: {
        ucis: [],
        preferredUci: card.hintStage >= 2 ? policy.preferredUci : null,
        explanation: policy.hint
      }
    });
  }

  const open = card.state === "unanswered" || card.state === "answered-wrong";
  const lastAction = history.at(-1);
  if (
    kind === "follow-other-line" &&
    (!open || lastAction?.outcome !== OTHER_LINE || !lastAction.resultJson)
  ) {
    throw new Error("Invalid action: follow-other-line needs an answer from another line first");
  }
  if (!open) return kind === "reveal" ? { card, revealed } : { card };

  const rehearsal = loadRehearsal(session);
  if (!rehearsal) {
    if (kind !== "follow-other-line") persist(kind, false, null);
    finishStale(session);
    const skipped = session.cards[index];
    return save(kind === "reveal" ? { card: skipped, revealed } : { card: skipped });
  }
  const stepIndex = card.rehearsal?.stepIndex ?? 0;

  if (kind === "reveal") {
    if (card.state === "unanswered") {
      persist("reveal", true, firstAnswerOutcome([...gradedHistory(history), { kind: "reveal" }]));
      card.state = "revealed";
    } else {
      persist("reveal", false, null);
    }
    session.cards[index] = card;
    const child = nextOnRoute(rehearsal.context.lookup, card.nodeId, rehearsal.state.lineEnd)!;
    const step = continueLine(session, rehearsal, child.id, stepIndex);
    return save({ card, rehearsal: step, revealed });
  }

  if (kind === "skip") {
    persist("skip", false, card.state === "unanswered" ? "no-change" : null);
    if (card.state === "unanswered") card.state = "skipped";
    session.cards[index] = card;
    finishLine(rehearsal.state, false);
    const next = startNextLine(session, rehearsal);
    return save({ card, rehearsal: { reply: null, next, lineComplete: false, endReason: null } });
  }

  const other = (JSON.parse(lastAction!.resultJson!) as AttemptResult).otherLine;
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
  persist(
    "attempt",
    unanswered,
    unanswered
      ? firstAnswerOutcome([
          ...gradedHistory(history),
          { kind: "attempt", legal: true, correct: true }
        ])
      : null,
    true
  );
  if (unanswered) card.state = "answered-correct";
  session.cards[index] = card;
  // Following starts a new line from that occurrence; a line already finished this session is
  // only replayed when nothing else is left below it (and isn't counted again).
  const plan = planRoute(
    rehearsal.context,
    other.nodeId,
    pendingLines(rehearsal),
    rehearsal.state.seen,
    new Set(rehearsal.state.finished)
  );
  startLine(rehearsal.state, plan.endNodeId);
  const step = continueLine(session, rehearsal, other.nodeId, stepIndex);
  return save({ card, rehearsal: step });
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

/** Forgets pending PGN import and backup restore jobs, cancelling running parses (tests). */
export function resetImportJobs(): void {
  for (const jobId of [...runningImports.keys()]) cancelImport(jobId);
  importJobs.clear();
  backupJobs.clear();
}

/* ------------------------------------------------------------------ native backup (§10) */

type BackupJob = { document: RepertoireBackupDocument; warnings: string[]; expiresAt: number };
const backupJobs = new Map<string, BackupJob>();
const MAX_BACKUP_BYTES = DEFAULT_BACKUP_LIMITS.maxBytes;
const RETAINED_BACKUP_DIR = "repertoire-backups";
/** Retained backups kept per repertoire; older ones are deleted after a successful replace. */
const MAX_RETAINED_BACKUPS = 10;
/** The format name of the practice history kept beside a retained backup (never restored). */
const RETAINED_HISTORY_FORMAT = "chaturanga-repertoire-practice-history";
const BACKUP_FILTERS = [{ name: "Chaturanga backup", extensions: ["json"] }];

function mib(bytes: number): string {
  return `${Math.ceil((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}

/**
 * The app's own version. Unpackaged, Electron may report its own version instead, so the version
 * the package script runs with (apps/desktop/package.json) is used when it is set.
 */
function appVersion(): string {
  if (app.isPackaged) return app.getVersion();
  return process.env.npm_package_version || app.getVersion();
}

/**
 * The stored state of a repertoire as a backup entry, progress included (callers strip it). A
 * damaged chapter is kept as its raw stored data rather than failing the whole backup. Read inside
 * a transaction so chapters, decisions and progress belong to one revision.
 */
function backupEntryOf(record: RepertoireRecord): RepertoireBackupEntry {
  return {
    repertoire: {
      id: record.id,
      name: record.name,
      color: record.color,
      description: record.description,
      tags: [...record.tags],
      revision: record.revision,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    },
    chapters: chapterRepository.listForBackup(record.id),
    decisions: decisionRepository.list(record.id).map(stripFingerprint),
    progress: progressRepository.list(record.id),
    workspace: workspaceRepository.get(record.id),
    gameLinks: gameLinkRepository.list(record.id)
  };
}

/** One warning per damaged chapter of the entry, saying it was written as raw data. */
function damagedChapterWarnings(entry: RepertoireBackupEntry): string[] {
  return entry.chapters.flatMap((chapter) =>
    chapter.damaged
      ? [
          `Repertoire "${entry.repertoire.name}": chapter "${chapter.title}" is damaged (${chapter.damaged.reason}); its stored data was written as is and can't be restored`
        ]
      : []
  );
}

function backupDocument(entries: RepertoireBackupEntry[], now: number): RepertoireBackupDocument {
  return buildBackupDocument(entries, {
    app: { name: app.getName(), version: appVersion() },
    now,
    positionKeyVersion: REPERTOIRE_POSITION_KEY_VERSION,
    schedulerVersion: REPERTOIRE_SCHEDULER_VERSION
  });
}

/** `yyyy-mm-dd` in local time, for the suggested file name. */
function localDate(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Writes `text` to `<path>.tmp`, syncs it to disk and renames it over `path`, so a crash never
 * leaves a half-written file at the destination. The temporary file is removed on failure.
 */
async function writeFileAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Writes a native backup of the chosen repertoires (all of them, archived included, by default)
 * through a save dialog. The snapshot is read in one transaction, so every repertoire is exported
 * at one captured revision; progress is included only when asked. A damaged chapter is written as
 * its raw stored data with a warning. The destination is only ever the path the user picked in the
 * dialog, written atomically. `savedPath` is null when the dialog was cancelled.
 */
export async function exportBackup(
  input: ExportBackupInput,
  owner: BrowserWindow | null = null
): Promise<ExportBackupResult> {
  const now = clock();
  const entries = transaction(() => {
    const ids = input.repertoireIds ?? repertoireRepository.ids();
    return [...new Set(ids)].map((id) => {
      const record = repertoireRepository.get(id);
      if (!record) throw new Error(`Invalid repertoireIds: "${id}" is not in this library`);
      return stripForExport(backupEntryOf(record), input.includeProgress);
    });
  }, "read");
  if (!entries.length) throw new Error("Invalid export: there are no repertoires to back up");
  const warnings = entries.flatMap(damagedChapterWarnings);
  const json = JSON.stringify(backupDocument(entries, now));
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_BACKUP_BYTES) {
    throw new Error(
      `Invalid export: the backup would be ${mib(bytes)}, over the ${mib(MAX_BACKUP_BYTES)} a restore accepts; back up fewer repertoires at once`
    );
  }
  // The restore's own checks (repertoire, chapter and move counts too): a backup that couldn't be
  // restored isn't written.
  const unrestorable = restoreRefusal(json);
  if (unrestorable) {
    throw new Error(
      `Invalid export: the backup couldn't be restored (${unrestorable}); back up fewer repertoires at once`
    );
  }
  const window = owner ?? BrowserWindow.getFocusedWindow();
  const options = {
    defaultPath: `chaturanga-repertoires-${localDate(now)}.json`,
    filters: BACKUP_FILTERS
  };
  const choice = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) {
    return { savedPath: null, repertoireCount: entries.length, bytes, warnings };
  }
  await writeFileAtomically(choice.filePath, json);
  return { savedPath: choice.filePath, repertoireCount: entries.length, bytes, warnings };
}

function pruneBackupJobs(now: number): void {
  for (const [jobId, job] of backupJobs) if (job.expiresAt <= now) backupJobs.delete(jobId);
}

function requireBackupJob(jobId: string, now: number): BackupJob {
  pruneBackupJobs(now);
  const job = backupJobs.get(jobId);
  if (!job) {
    throw new Error(
      "Invalid jobId: the backup preview expired or was cancelled; choose the file again"
    );
  }
  return job;
}

/** Why restore would refuse this backup text (its reason, without "Invalid backup: "), or null. */
function restoreRefusal(text: string): string | null {
  try {
    validateBackupDocument(text);
    return null;
  } catch (error) {
    return String(error instanceof Error ? error.message : error).replace(/^Invalid backup: /, "");
  }
}

/** The backup text from the native open dialog (size checked before reading), or null. */
async function pickBackupFile(owner: BrowserWindow | null): Promise<string | null> {
  const window = owner ?? BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile"],
    filters: BACKUP_FILTERS
  };
  const choice = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const path = choice.canceled ? undefined : choice.filePaths[0];
  if (!path) return null;
  const { size } = await stat(path);
  if (size > MAX_BACKUP_BYTES) {
    throw new Error(
      `Invalid backup: the file is ${mib(size)}; backups up to ${mib(MAX_BACKUP_BYTES)} can be restored`
    );
  }
  return readFile(path, "utf8");
}

/**
 * The preview of a job: each backup repertoire against a repertoire with the same id in this
 * library, if any, with the diff replacing it would make. An existing repertoire with a damaged
 * chapter has no diff and is flagged `damaged` (it can still be replaced or restored as a copy).
 */
function previewOf(jobId: string, job: BackupJob): BackupImportPreview {
  const repertoires = transaction(
    () =>
      job.document.repertoires.map((entry) => {
        const record = repertoireRepository.get(entry.repertoire.id);
        const current = record ? backupEntryOf(record) : null;
        const damaged = Boolean(current?.chapters.some((chapter) => chapter.damaged));
        return {
          sourceId: entry.repertoire.id,
          name: entry.repertoire.name,
          color: entry.repertoire.color,
          chapterCount: entry.chapters.length,
          decisionCount: entry.decisions.length,
          hasProgress: (entry.progress?.length ?? 0) > 0,
          existing: record
            ? { id: record.id, name: record.name, revision: record.revision, color: record.color }
            : null,
          diff:
            record && current && !damaged
              ? diffBackupEntry(current, entry, {
                  sessionCount: sessionRepository.count(record.id)
                })
              : null,
          ...(damaged ? { damaged: true } : {})
        };
      }),
    "read"
  );
  return {
    jobId,
    formatVersion: job.document.formatVersion,
    exportedAt: job.document.exportedAt,
    app: job.document.app,
    repertoires,
    warnings: job.warnings
  };
}

/**
 * Validates a backup (picked through the native open dialog, or given as JSON text) and keeps it
 * as a pending job for 30 minutes (at most three at once; a new one drops the oldest). Returns
 * the preview (see previewOf), or null when the dialog was cancelled.
 */
export async function previewBackupImport(
  input: PreviewBackupImportInput,
  owner: BrowserWindow | null = null
): Promise<BackupImportPreview | null> {
  const text = "pickFile" in input ? await pickBackupFile(owner) : input.json;
  if (text === null) return null;
  const { document, warnings } = validateBackupDocument(text);
  const now = clock();
  pruneBackupJobs(now);
  for (const oldest of backupJobs.keys()) {
    if (backupJobs.size < MAX_IMPORT_JOBS) break;
    backupJobs.delete(oldest);
  }
  const jobId = nanoid();
  const job = { document, warnings, expiresAt: now + IMPORT_JOB_TTL_MS };
  const preview = previewOf(jobId, job);
  backupJobs.set(jobId, job);
  return preview;
}

/**
 * Recomputes a pending job's preview against the library as it is now (revisions, diffs, damage),
 * for a retry after the library changed. Restarts the job's 30 minutes.
 */
export function refreshBackupPreview(jobId: string): BackupImportPreview {
  const now = clock();
  const job = requireBackupJob(jobId, now);
  job.expiresAt = now + IMPORT_JOB_TTL_MS;
  return previewOf(jobId, job);
}

export function cancelBackupImport(jobId: string): void {
  backupJobs.delete(jobId);
}

/**
 * The entry's chapters as they will be stored: every tree replayed from its root (validateTree via
 * sanitizeChapter), metadata pruned. Throws `Invalid backup: chapter "<title>" …` at the first bad
 * chapter, before anything is written.
 */
function restorableChapters(entry: RepertoireBackupEntry): RepertoireChapter[] {
  return entry.chapters.map((chapter) => {
    try {
      return sanitizeChapter(chapter, chapter.revision);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(
        /^Invalid /,
        ""
      );
      throw new Error(`Invalid backup: chapter "${chapter.title}" can't be restored (${reason})`, {
        cause: error
      });
    }
  });
}

/** Inserts an entry's content under `entry.repertoire.id` (the repertoire row must exist). */
function insertBackupContent(
  entry: RepertoireBackupEntry,
  chapters: readonly RepertoireChapter[],
  includeProgress: boolean,
  keepLinkIds: boolean,
  now: number
): void {
  const repertoireId = entry.repertoire.id;
  for (const chapter of chapters) {
    const owner = chapterRepository.ownerOf(chapter.id);
    if (owner && owner.repertoireId !== repertoireId) {
      throw new Error(
        `Invalid backup: chapter "${chapter.title}" belongs to another repertoire in this library; restore it as a new copy`
      );
    }
    chapterRepository.upsert(repertoireId, chapter, now);
  }
  for (const decision of entry.decisions) {
    const acceptedUcis = [...new Set(decision.acceptedUcis.map((uci) => uci.toLowerCase()))];
    const preferredUci = decision.preferredUci?.toLowerCase() ?? null;
    decisionRepository.upsert(
      {
        repertoireId,
        positionKey: decision.positionKey,
        acceptedUcis,
        preferredUci: preferredUci && acceptedUcis.includes(preferredUci) ? preferredUci : null,
        prompt: cleanText(decision.prompt, MAX_POLICY_TEXT),
        hint: cleanText(decision.hint, MAX_POLICY_TEXT),
        wrongMoveFeedback: Object.fromEntries(
          Object.entries(decision.wrongMoveFeedback)
            .slice(0, 64)
            .map(([uci, text]) => [uci.toLowerCase(), text.slice(0, MAX_POLICY_TEXT)])
        ),
        paused: decision.paused,
        acceptanceFingerprint: ""
      },
      now
    );
  }
  if (includeProgress && entry.progress) {
    for (const progress of entry.progress) {
      progressRepository.upsert({
        ...progress,
        repertoireId,
        stage: Math.min(progress.stage, MAX_STAGE)
      });
    }
  }
  if (entry.workspace) {
    const known = chapters.some((chapter) => chapter.id === entry.workspace!.lastChapterId);
    workspaceRepository.save(
      repertoireId,
      {
        lastChapterId: known ? entry.workspace.lastChapterId : null,
        lastNodeId: known ? entry.workspace.lastNodeId : null,
        orientation: entry.workspace.orientation,
        practiceDraft: null
      },
      now
    );
  }
  for (const link of entry.gameLinks) {
    gameLinkRepository.insert({
      ...link,
      id: keepLinkIds && !gameLinkRepository.get(link.id) ? link.id : nanoid(),
      repertoireId,
      gameId: link.gameId && libraryGameExists(link.gameId) ? link.gameId : null,
      headers: sanitizeHeaders(link.headers),
      capturedPath: link.capturedPath.slice(0, MAX_POLICY_TEXT)
    });
  }
}

/** A file-name-safe form of a repertoire id. */
function safeFileId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "repertoire";
}

function retainedBackupDirectory(): string {
  return join(app.getPath("userData"), RETAINED_BACKUP_DIR);
}

/** Syncs a directory entry to disk (best effort: Windows can't open a directory for this). */
function syncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch {
    // The file itself is already synced; only its directory entry may lag.
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** A replaced repertoire's own backup, prepared before anything is written or deleted. */
type RetainedCopy = { record: RepertoireRecord; text: string; history: string };

/**
 * The repertoire's own backup (progress included) as Restore from backup reads it, and its raw
 * practice session and attempt rows as a separate forensic history document (never restored, so
 * it can't make the backup too large to restore). Refused, before anything is deleted, when the
 * backup itself would fail the restore's checks: a replace must leave a copy that can be restored.
 */
function prepareRetainedCopy(record: RepertoireRecord, now: number): RetainedCopy {
  const { entry, history } = transaction(
    () => ({
      entry: stripForExport(backupEntryOf(record), true),
      history: {
        format: RETAINED_HISTORY_FORMAT,
        repertoireId: record.id,
        exportedAt: now,
        sessions: sessionRepository.rawRows(record.id),
        attempts: attemptRepository.rawRowsForRepertoire(record.id)
      }
    }),
    "read"
  );
  const text = JSON.stringify(backupDocument([entry], now));
  const refusal = restoreRefusal(text);
  if (refusal) {
    throw new Error(
      `Invalid selections: "${record.name}" can't be replaced because its own backup couldn't be restored (${refusal}); restore the backup as a new copy`
    );
  }
  return { record, text, history: JSON.stringify(history) };
}

/** The forensic history file kept beside a retained backup. */
function historyPathOf(backupPath: string): string {
  return backupPath.replace(/\.json$/, ".history.json");
}

/**
 * Writes a prepared copy to `<userData>/repertoire-backups/` and returns the backup's path; its
 * history goes beside it (`<name>.history.json`). The backup is created exclusively (a random
 * suffix on a name collision), then both files and their directory are synced, so they are on
 * disk before the replace deletes anything.
 */
function retainBackup({ record, text, history }: RetainedCopy, now: number): string {
  const directory = retainedBackupDirectory();
  mkdirSync(directory, { recursive: true });
  const base = `${safeFileId(record.id)}-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
  let path = join(directory, `${base}.json`);
  let descriptor: number | null = null;
  for (let attempt = 0; descriptor === null; attempt += 1) {
    try {
      descriptor = openSync(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 5) throw error;
      path = join(directory, `${base}-${nanoid(8)}.json`);
    }
  }
  try {
    writeFileSync(descriptor, text, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const historyDescriptor = openSync(historyPathOf(path), "w");
  try {
    writeFileSync(historyDescriptor, history, "utf8");
    fsyncSync(historyDescriptor);
  } finally {
    closeSync(historyDescriptor);
  }
  syncDirectory(directory);
  return path;
}

const RETAINED_NAME =
  /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-[A-Za-z0-9_-]+)?\.json$/;

/**
 * Deletes all but the newest MAX_RETAINED_BACKUPS retained backups of a repertoire (best effort:
 * a file that can't be listed or deleted is left).
 */
function pruneRetainedBackups(repertoireId: string): void {
  const directory = retainedBackupDirectory();
  const fileId = safeFileId(repertoireId);
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  const retained = names
    .map((name) => ({ name, match: RETAINED_NAME.exec(name) }))
    .filter((item) => item.match?.[1] === fileId)
    .sort((a, b) => {
      const stamp = b.match![2].localeCompare(a.match![2]);
      return stamp || b.name.localeCompare(a.name);
    });
  for (const { name } of retained.slice(MAX_RETAINED_BACKUPS)) {
    try {
      unlinkSync(join(directory, name));
      rmSync(historyPathOf(join(directory, name)), { force: true });
    } catch {
      // Left for the next replace to try again.
    }
  }
}

type RestoredRepertoire = RestoreBackupResult["restored"][number] & { revision: number };

function restoreNewCopy(
  entry: RepertoireBackupEntry,
  chapters: readonly RepertoireChapter[],
  selection: RestoreBackupSelection,
  now: number
): RestoredRepertoire {
  const chapterIds = new Map(chapters.map((chapter) => [chapter.id, nanoid()]));
  const copy = remapBackupEntry(entry, {
    newRepertoireId: nanoid(),
    idFor: (chapterId) => chapterIds.get(chapterId) ?? nanoid(),
    linkIdFor: () => nanoid()
  });
  const name = selection.newName?.trim()
    ? cleanName(selection.newName)
    : cleanName(`${entry.repertoire.name || "Repertoire"} (restored)`);
  repertoireRepository.insert({
    id: copy.repertoire.id,
    name,
    color: copy.repertoire.color,
    description: cleanText(copy.repertoire.description, MAX_DESCRIPTION) ?? "",
    tags: cleanTags(copy.repertoire.tags),
    revision: 1,
    archivedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const copiedChapters = chapters.map((chapter) => ({
    ...chapter,
    id: chapterIds.get(chapter.id)!,
    revision: 1
  }));
  insertBackupContent(copy, copiedChapters, selection.includeProgress, false, now);
  reindex(requireRepertoire(copy.repertoire.id), now);
  return {
    sourceId: entry.repertoire.id,
    repertoireId: copy.repertoire.id,
    mode: "new-copy",
    retainedBackupPath: null,
    revision: 1
  };
}

/**
 * The repertoire a replace overwrites, after the checks that refuse it: it must exist, be at the
 * revision the user saw, have the backup's color, and have no practice session in progress.
 */
function checkReplace(
  entry: RepertoireBackupEntry,
  selection: RestoreBackupSelection
): RepertoireRecord {
  const existing = repertoireRepository.get(entry.repertoire.id);
  if (!existing) {
    throw new Error(
      `Invalid selections: "${entry.repertoire.name}" has no repertoire in this library to replace; restore it as a new copy`
    );
  }
  if (selection.expectedRevision === undefined) {
    throw new Error("Invalid expectedRevision: required to replace a repertoire");
  }
  checkRevision(existing, selection.expectedRevision);
  if (existing.color !== entry.repertoire.color) {
    throw new Error(
      `Invalid backup: "${existing.name}" is a ${existing.color} repertoire in this library; restore it as a new copy`
    );
  }
  if (sessionRepository.count(existing.id, "active") > 0) {
    throw new Error(
      `Invalid selections: "${existing.name}" has a practice session in progress; end it first`
    );
  }
  return existing;
}

function restoreReplace(
  entry: RepertoireBackupEntry,
  chapters: readonly RepertoireChapter[],
  selection: RestoreBackupSelection,
  retainedBackupPath: string,
  now: number
): RestoredRepertoire {
  const existing = checkReplace(entry, selection);
  // Deleting the row cascades to chapters, decisions, index, progress, sessions, workspace, links.
  repertoireRepository.remove(existing.id);
  const revision = Math.max(existing.revision, entry.repertoire.revision) + 1;
  repertoireRepository.insert({
    id: existing.id,
    name: cleanName(entry.repertoire.name || existing.name),
    color: entry.repertoire.color,
    description: cleanText(entry.repertoire.description, MAX_DESCRIPTION) ?? "",
    tags: cleanTags(entry.repertoire.tags),
    revision,
    archivedAt: entry.repertoire.archivedAt,
    createdAt: entry.repertoire.createdAt,
    updatedAt: now
  });
  insertBackupContent(entry, chapters, selection.includeProgress, true, now);
  reindex(requireRepertoire(existing.id), now);
  return {
    sourceId: entry.repertoire.id,
    repertoireId: existing.id,
    mode: "replace",
    retainedBackupPath,
    revision
  };
}

/**
 * Restores the selected repertoires of a previewed backup in one transaction, so a failure leaves
 * nothing half-restored. `new-copy` inserts the content under fresh ids at revision 1. `replace`
 * is refused unless checkReplace passes; before the transaction begins, the existing repertoire's
 * own backup (with its practice history) is written and synced to
 * `<userData>/repertoire-backups/`, then its content, progress and practice sessions are swapped
 * for the backup's under the same id at a revision above both. Afterwards only the newest ten
 * retained backups of each replaced repertoire are kept. Progress is restored only with
 * `includeProgress`. A link keeps its game only if this library has it. The index and effective
 * decisions are rebuilt (decisions nothing reaches are suspended); change events follow the
 * commit. Runs on the main thread (see the stack plan's known limitations).
 */
export function restoreBackup(input: RestoreBackupInput): RestoreBackupResult {
  const now = clock();
  const job = requireBackupJob(input.jobId, now);
  if (!input.selections.length) {
    throw new Error("Invalid selections: choose at least one repertoire to restore");
  }
  if (new Set(input.selections.map((item) => item.sourceId)).size !== input.selections.length) {
    throw new Error("Invalid selections: each repertoire can be restored only once");
  }
  const planned = input.selections.map((selection) => {
    const entry = job.document.repertoires.find(
      (item) => item.repertoire.id === selection.sourceId
    );
    if (!entry) {
      throw new Error(`Invalid selections: "${selection.sourceId}" is not in this backup`);
    }
    return { selection, entry, chapters: restorableChapters(entry) };
  });
  // Every replace is checked, and its own backup prepared (and checked restorable), before any
  // backup is retained; all are retained before BEGIN.
  const copies = planned
    .filter(({ selection }) => selection.mode === "replace")
    .map(({ selection, entry }) => prepareRetainedCopy(checkReplace(entry, selection), now));
  const retained = new Map<string, string>();
  for (const copy of copies) retained.set(copy.record.id, retainBackup(copy, now));
  const restored = transaction(() =>
    planned.map(({ selection, entry, chapters }) =>
      selection.mode === "replace"
        ? restoreReplace(entry, chapters, selection, retained.get(entry.repertoire.id)!, now)
        : restoreNewCopy(entry, chapters, selection, now)
    )
  );
  backupJobs.delete(input.jobId);
  for (const item of restored) {
    if (item.mode === "replace") pruneRetainedBackups(item.repertoireId);
    changed({
      repertoireId: item.repertoireId,
      revision: item.revision,
      kind: item.mode === "replace" ? "updated" : "created"
    });
  }
  return {
    restored: restored.map(({ sourceId, repertoireId, mode, retainedBackupPath }) => ({
      sourceId,
      repertoireId,
      mode,
      retainedBackupPath
    }))
  };
}
