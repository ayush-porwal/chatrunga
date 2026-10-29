/**
 * Input validation for the repertoire IPC handlers (see validate.ts): every payload is checked
 * and rebuilt from known fields only.
 */
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  AddFromGameDestination,
  AddFromGameInput,
  AddFromGameScope,
  ArchiveRepertoireInput,
  ChapterKind,
  CompareGameInput,
  CreateRepertoireInput,
  DuplicateRepertoireInput,
  ExportBackupInput,
  ExportInput,
  ImportCommitInput,
  LinkGameInput,
  PracticeActionInput,
  PracticeMode,
  PreviewBackupImportInput,
  PreviewImportInput,
  RecordAttemptInput,
  RemoveChapterInput,
  RemoveRepertoireInput,
  RepertoireColor,
  RepertoireListFilters,
  RepertoireNodeMeta,
  PractisedElsewhereInput,
  RestoreBackupInput,
  SaveChapterInput,
  SaveWorkspaceInput,
  StartPracticeInput,
  UpdateChaptersInput,
  UpdateDecisionInput,
  UpdateRepertoireMetadataInput
} from "@chaturanga/shared/types/repertoire";
import { COMPARE_GAME_MAX_PLIES } from "@chaturanga/shared/types/repertoire";
import { isOneOf } from "@chaturanga/shared/types/guards";
import {
  MAX_OPENING_NAME,
  type ChapterOpening,
  type OpeningOfInput
} from "@chaturanga/shared/types/repertoire-practice";
import {
  MAX_NAME,
  MAX_HEADER,
  MAX_PGN_BYTES,
  UCI_MOVE,
  CONTROL_CHARS,
  fail,
  asObject,
  asString,
  asId,
  optional,
  nullable,
  asBoolean,
  asFiniteNumber,
  asWholeNumber,
  asStringArray,
  asFen,
  asUciMoves,
  asIntegerInRange
} from "./fields";
/* ------------------------------------------------------------------ repertoires */

const MAX_REPERTOIRE_TEXT = 5_000;
const MAX_POLICY_TEXT = 2_000;
const MAX_CHAPTER_NODES = 100_000;
const MAX_IMPORT_GAMES = 1_000;
const MAX_POSITION_KEY = 200;
/** Targeted practice ("Refresh this decision") names at most this many decisions. */
const MAX_TARGETED_KEYS = 200;
/** Repertoires one Practice tab set queues at most. */
const MAX_SET_REPERTOIRES = 500;

function asRevision(value: unknown): number {
  return asWholeNumber(value, "expectedRevision");
}

function asRepertoireColor(value: unknown, label = "color"): RepertoireColor {
  if (value !== "white" && value !== "black") fail(label, "expected white or black");
  return value;
}

function asChapterKind(value: unknown): ChapterKind {
  if (value !== "opening" && value !== "reference")
    fail("chapter kind", "expected opening or reference");
  return value;
}

function asUci(value: unknown, label: string): string {
  const uci = asString(value, label, 5);
  if (!UCI_MOVE.test(uci)) fail(label, `"${uci}" is not a UCI move`);
  return uci;
}

function asIdArray(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value)) fail(label, "expected an array");
  if (value.length > maxItems) fail(label, "too many items");
  return value.map((item, index) => asId(item, `${label}[${index}]`));
}

function asTextRecord(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength: number
): Record<string, string> {
  const entries = Object.entries(asObject(value, label));
  if (entries.length > maxItems) fail(label, "too many entries");
  return Object.fromEntries(
    entries.map(([key, text]) => [key, asString(text, `${label}.${key}`, maxLength)])
  );
}

export function parseRepertoireListFilters(value: unknown): RepertoireListFilters {
  if (value === undefined || value === null) return {};
  const input = asObject(value, "repertoire filters");
  const filters: RepertoireListFilters = {};
  if (input.color !== undefined) {
    filters.color = input.color === "all" ? "all" : asRepertoireColor(input.color);
  }
  if (input.query !== undefined) filters.query = asString(input.query, "query", MAX_NAME);
  if (input.archived !== undefined) filters.archived = asBoolean(input.archived, "archived");
  return filters;
}

export function parseCreateRepertoireInput(value: unknown): CreateRepertoireInput {
  const input = asObject(value, "repertoire");
  return {
    name: asString(input.name, "name", MAX_NAME),
    color: asRepertoireColor(input.color),
    description: optional(input.description, (text) =>
      asString(text, "description", MAX_REPERTOIRE_TEXT)
    ),
    tags: optional(input.tags, (tags) => asStringArray(tags, "tags", 32, 50)),
    rootFen: optional(input.rootFen, (fen) => asFen(fen, "rootFen")),
    firstChapterTitle: optional(input.firstChapterTitle, (title) =>
      asString(title, "firstChapterTitle", MAX_NAME)
    )
  };
}

export function parseUpdateRepertoireMetadataInput(value: unknown): UpdateRepertoireMetadataInput {
  const input = asObject(value, "repertoire update");
  const patch = asObject(input.patch, "repertoire patch");
  return {
    id: asId(input.id, "repertoireId"),
    expectedRevision: asRevision(input.expectedRevision),
    patch: {
      name: optional(patch.name, (name) => asString(name, "name", MAX_NAME)),
      description: optional(patch.description, (text) =>
        asString(text, "description", MAX_REPERTOIRE_TEXT)
      ),
      tags: optional(patch.tags, (tags) => asStringArray(tags, "tags", 32, 50))
    }
  };
}

export function parseChapterRef(value: unknown): { repertoireId: string; chapterId: string } {
  const input = asObject(value, "chapter");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    chapterId: asId(input.chapterId, "chapterId")
  };
}

export function parseDecisionRef(value: unknown): { repertoireId: string; positionKey: string } {
  const input = asObject(value, "decision");
  const positionKey = asString(input.positionKey, "positionKey", 200).trim();
  if (!positionKey || CONTROL_CHARS.test(positionKey))
    fail("positionKey", "expected a position key");
  return { repertoireId: asId(input.repertoireId, "repertoireId"), positionKey };
}

/** "Include in practice"'s question: positions of a chapter, at most 10,000 keys. */
export function parsePractisedElsewhereInput(value: unknown): PractisedElsewhereInput {
  const input = asObject(value, "practised elsewhere");
  const positionKeys = asStringArray(input.positionKeys, "positionKeys", 10_000, 200).map((key) =>
    key.trim()
  );
  if (positionKeys.some((key) => !key || CONTROL_CHARS.test(key))) {
    fail("positionKeys", "expected position keys");
  }
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    chapterId: asId(input.chapterId, "chapterId"),
    positionKeys
  };
}

/**
 * Shallow shape check, like parseSaveGameInput: the tree must be an array of at most 100,000
 * nodes; the repertoire service replays and checks every node before anything is stored.
 */
export function parseSaveChapterInput(value: unknown): SaveChapterInput {
  const input = asObject(value, "chapter save");
  const chapter = asObject(input.chapter, "chapter");
  if (!Array.isArray(chapter.tree)) fail("chapter tree", "expected an array");
  if (chapter.tree.length > MAX_CHAPTER_NODES) fail("chapter tree", "too many nodes");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    expectedRevision: asRevision(input.expectedRevision),
    chapter: {
      id: asId(chapter.id, "chapterId"),
      title: asString(chapter.title, "chapter title", MAX_NAME),
      sortOrder: asFiniteNumber(chapter.sortOrder, "chapter sortOrder"),
      kind: asChapterKind(chapter.kind),
      enabled: asBoolean(chapter.enabled, "chapter enabled"),
      rootFen: asFen(chapter.rootFen, "chapter rootFen"),
      revision: typeof chapter.revision === "number" ? chapter.revision : 0,
      nodeCount: Math.max(chapter.tree.length - 1, 0),
      dueCount: 0,
      headers: asTextRecord(chapter.headers ?? {}, "chapter headers", 64, MAX_HEADER),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service replays and checks every node (chapter-validation.ts) before saving
      tree: chapter.tree as MoveNode[],
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked against the tree with it (chapter-validation.ts)
      nodeMeta: asObject(chapter.nodeMeta ?? {}, "chapter nodeMeta") as Record<
        string,
        RepertoireNodeMeta
      >,
      ...(chapter.opening !== undefined ? { opening: asChapterOpening(chapter.opening) } : {})
    }
  };
}

/* Practice home additions (docs/repertoire-games-and-practice.md §2, §4). */

const PRACTICE_MODES: readonly PracticeMode[] = [
  "review-due",
  "learn-new",
  "rehearse-lines",
  "practice-early",
  "weak"
];

function asPracticeMode(value: unknown): PracticeMode {
  if (!isOneOf(PRACTICE_MODES, value))
    fail("practice mode", `expected ${PRACTICE_MODES.join(", ")}`);
  return value;
}

/** A chapter's opening (null: none); the service cleans the name and ECO again. */
function asChapterOpening(value: unknown): ChapterOpening | null {
  if (value === null) return null;
  const opening = asObject(value, "opening");
  return {
    name: asString(opening.name, "opening name", MAX_OPENING_NAME),
    eco: nullable(opening.eco, (eco) => asString(eco, "opening eco", 3)) ?? null,
    edited: asBoolean(opening.edited, "opening edited")
  };
}

/** `openingOf`'s line: a position and the moves played from it (at most a game's opening). */
export function parseOpeningOfInput(value: unknown): OpeningOfInput {
  const input = asObject(value, "opening line");
  return { rootFen: asFen(input.rootFen, "rootFen"), moves: asUciMoves(input.moves) };
}

export function parseUpdateDecisionInput(value: unknown): UpdateDecisionInput {
  const input = asObject(value, "decision update");
  const patch = asObject(input.patch, "decision patch");
  const positionKey = asString(input.positionKey, "positionKey", 200).trim();
  if (!positionKey || CONTROL_CHARS.test(positionKey))
    fail("positionKey", "expected a position key");
  const text = (field: unknown, label: string) =>
    nullable(field, (item) => asString(item, label, MAX_POLICY_TEXT));
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    positionKey,
    expectedRevision: asRevision(input.expectedRevision),
    patch: {
      acceptedUcis: optional(patch.acceptedUcis, (ucis) => {
        if (!Array.isArray(ucis) || ucis.length > 64)
          fail("acceptedUcis", "expected a short array");
        return ucis.map((uci, index) => asUci(uci, `acceptedUcis[${index}]`));
      }),
      preferredUci: nullable(patch.preferredUci, (uci) => asUci(uci, "preferredUci")),
      prompt: text(patch.prompt, "prompt"),
      hint: text(patch.hint, "hint"),
      wrongMoveFeedback: optional(patch.wrongMoveFeedback, (feedback) => {
        const record = asTextRecord(feedback, "wrongMoveFeedback", 64, MAX_POLICY_TEXT);
        for (const uci of Object.keys(record)) asUci(uci, "wrongMoveFeedback move");
        return record;
      }),
      paused: optional(patch.paused, (paused) => asBoolean(paused, "paused"))
    }
  };
}

export function parseRemoveChapterInput(value: unknown): RemoveChapterInput {
  const input = asObject(value, "chapter removal");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    chapterId: asId(input.chapterId, "chapterId"),
    expectedRevision: asRevision(input.expectedRevision)
  };
}

export function parseUpdateChaptersInput(value: unknown): UpdateChaptersInput {
  const input = asObject(value, "chapters update");
  const patch = asObject(input.patch, "chapters patch");
  const parsed: UpdateChaptersInput = {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    chapterIds: asIdArray(input.chapterIds, "chapterIds", MAX_IMPORT_GAMES),
    expectedRevision: asRevision(input.expectedRevision),
    patch: {
      enabled: optional(patch.enabled, (enabled) => asBoolean(enabled, "enabled")),
      kind: optional(patch.kind, asChapterKind)
    }
  };
  if (parsed.patch.enabled === undefined && parsed.patch.kind === undefined) {
    fail("chapters patch", "expected enabled or kind");
  }
  return parsed;
}

export function parseDuplicateRepertoireInput(value: unknown): DuplicateRepertoireInput {
  const input = asObject(value, "repertoire copy");
  return {
    id: asId(input.id, "repertoireId"),
    name: optional(input.name, (name) => asString(name, "name", MAX_NAME))
  };
}

export function parseArchiveRepertoireInput(value: unknown): ArchiveRepertoireInput {
  const input = asObject(value, "repertoire archive");
  return {
    id: asId(input.id, "repertoireId"),
    archived: asBoolean(input.archived, "archived"),
    expectedRevision: asRevision(input.expectedRevision)
  };
}

export function parseRemoveRepertoireInput(value: unknown): RemoveRepertoireInput {
  const input = asObject(value, "repertoire removal");
  return {
    id: asId(input.id, "repertoireId"),
    expectedRevision: asRevision(input.expectedRevision)
  };
}

export function parsePreviewImportInput(value: unknown): PreviewImportInput {
  const input = asObject(value, "PGN import");
  // The import's own size-limit message, not a generic "too long" (design §11).
  if (typeof input.pgn === "string" && input.pgn.length > MAX_PGN_BYTES) {
    throw new Error("This PGN is larger than 20 MiB; split it and import it in parts.");
  }
  const pgn = asString(input.pgn, "PGN", MAX_PGN_BYTES);
  const jobId = optional(input.jobId, (id) => asId(id, "jobId"));
  return jobId === undefined ? { pgn } : { pgn, jobId };
}

export function parseImportCommitInput(value: unknown): ImportCommitInput {
  const input = asObject(value, "import commit");
  if (!Array.isArray(input.selections) || input.selections.length > MAX_IMPORT_GAMES) {
    fail("selections", "expected an array of games");
  }
  const included = new Set<number>();
  return {
    jobId: asId(input.jobId, "jobId"),
    repertoireId: asId(input.repertoireId, "repertoireId"),
    expectedRevision: asRevision(input.expectedRevision),
    selections: input.selections.map((item, index) => {
      const selection = asObject(item, `selections[${index}]`);
      const gameIndex = asWholeNumber(selection.gameIndex, "gameIndex");
      const include = asBoolean(selection.include, "include");
      if (include && included.has(gameIndex)) fail("selections", "a game is included twice");
      if (include) included.add(gameIndex);
      return {
        gameIndex,
        title: asString(selection.title ?? "", "title", MAX_NAME),
        kind: asChapterKind(selection.kind),
        include,
        excludeNodeIds: optional(selection.excludeNodeIds, (ids) =>
          asIdArray(ids, "excludeNodeIds", MAX_CHAPTER_NODES)
        ),
        ...(selection.opening !== undefined ? { opening: asChapterOpening(selection.opening) } : {})
      };
    })
  };
}

export function parseExportInput(value: unknown): ExportInput {
  const input = asObject(value, "export");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    chapterIds: optional(input.chapterIds, (ids) => asIdArray(ids, "chapterIds", MAX_IMPORT_GAMES))
  };
}

/** Repertoires one backup holds (design §11). */
const MAX_BACKUP_REPERTOIRES = 100;
/** A backup's JSON text, in UTF-16 code units (never fewer than its UTF-8 bytes / 3). */
const MAX_BACKUP_JSON = 32 * 1024 * 1024;

export function parseExportBackupInput(value: unknown): ExportBackupInput {
  const input = asObject(value, "backup export");
  return {
    repertoireIds: optional(input.repertoireIds, (ids) =>
      asIdArray(ids, "repertoireIds", MAX_BACKUP_REPERTOIRES)
    ),
    includeProgress: asBoolean(input.includeProgress, "includeProgress")
  };
}

/** Either the native file picker (`pickFile: true`) or JSON text; never a filesystem path. */
export function parsePreviewBackupImportInput(value: unknown): PreviewBackupImportInput {
  const input = asObject(value, "backup import");
  if (input.pickFile !== undefined) {
    if (input.pickFile !== true) fail("pickFile", "expected true");
    return { pickFile: true };
  }
  if (typeof input.json !== "string") fail("backup import", "expected pickFile or json");
  if (input.json.length > MAX_BACKUP_JSON) fail("backup", "the text is larger than 32 MiB");
  return { json: input.json };
}

export function parseRestoreBackupInput(value: unknown): RestoreBackupInput {
  const input = asObject(value, "backup restore");
  if (!Array.isArray(input.selections) || input.selections.length > MAX_BACKUP_REPERTOIRES) {
    fail("selections", "expected an array of repertoires");
  }
  return {
    jobId: asId(input.jobId, "jobId"),
    selections: input.selections.map((item, index) => {
      const selection = asObject(item, `selections[${index}]`);
      if (selection.mode !== "new-copy" && selection.mode !== "replace") {
        fail(`selections[${index}].mode`, "expected new-copy or replace");
      }
      return {
        sourceId: asId(selection.sourceId, "sourceId"),
        mode: selection.mode,
        includeProgress: asBoolean(selection.includeProgress, "includeProgress"),
        newName: optional(selection.newName, (name) => asString(name, "newName", MAX_NAME)),
        expectedRevision: optional(selection.expectedRevision, asRevision)
      };
    })
  };
}

export function parseStartPracticeInput(value: unknown): StartPracticeInput {
  const input = asObject(value, "practice");
  const result: StartPracticeInput = {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    mode: asPracticeMode(input.mode)
  };
  const chapterIds = optional(input.chapterIds, (ids) =>
    asIdArray(ids, "chapterIds", MAX_IMPORT_GAMES)
  );
  if (chapterIds) result.chapterIds = chapterIds;
  const depth = optional(input.maxDepthPlies, (plies) =>
    asIntegerInRange(plies, "maxDepthPlies", 1, 512)
  );
  if (depth !== undefined) result.maxDepthPlies = depth;
  const cardLimit = optional(input.cardLimit, (limit) =>
    asIntegerInRange(limit, "cardLimit", 1, 500)
  );
  if (cardLimit !== undefined) result.cardLimit = cardLimit;
  const newCardLimit = optional(input.newCardLimit, (limit) =>
    asIntegerInRange(limit, "newCardLimit", 0, 500)
  );
  if (newCardLimit !== undefined) result.newCardLimit = newCardLimit;
  const positionKeys = optional(input.positionKeys, (keys) =>
    asStringArray(keys, "positionKeys", MAX_TARGETED_KEYS, MAX_POSITION_KEY)
  );
  if (positionKeys) {
    positionKeys.forEach((key, index) => {
      if (!key.trim() || CONTROL_CHARS.test(key)) {
        fail(`positionKeys[${index}]`, "expected a position key");
      }
    });
    result.positionKeys = positionKeys;
  }
  // The chapter is required only when a rehearsal starts (a saved draft may not have one yet).
  const rehearse = optional(input.rehearse, (value) => {
    const fields = asObject(value, "rehearse");
    const fromNodeId = optional(fields.fromNodeId, (id) => asId(id, "rehearse.fromNodeId"));
    return {
      chapterId: asId(fields.chapterId, "rehearse.chapterId"),
      ...(fromNodeId !== undefined ? { fromNodeId } : {})
    };
  });
  if (rehearse) result.rehearse = rehearse;
  // A Practice tab set: the repertoires it queues together.
  const repertoireIds = optional(input.repertoireIds, (ids) =>
    asIdArray(ids, "repertoireIds", MAX_SET_REPERTOIRES)
  );
  if (repertoireIds) result.repertoireIds = repertoireIds;
  const ungraded = optional(input.ungraded, (flag) => asBoolean(flag, "ungraded"));
  if (ungraded) {
    if (!result.positionKeys?.length || result.mode === "rehearse-lines") {
      fail("ungraded", "only a targeted queue (positionKeys) can be ungraded practice");
    }
    result.ungraded = true;
  }
  return result;
}

export function parseCompareGameInput(value: unknown): CompareGameInput {
  const input = asObject(value, "game comparison");
  const moves = asUciMoves(input.moves, "moves");
  if (moves.length > COMPARE_GAME_MAX_PLIES) {
    fail("moves", `more than ${COMPARE_GAME_MAX_PLIES} plies`);
  }
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    color: asRepertoireColor(input.color),
    rootFen: asFen(input.rootFen, "rootFen"),
    moves
  };
}

function parseAddFromGameScope(value: unknown): AddFromGameScope {
  const scope = asObject(value, "scope");
  switch (scope.kind) {
    case "path":
      return { kind: "path", toNodeId: asId(scope.toNodeId, "scope toNodeId") };
    case "subtree":
      if (scope.root !== "original" && scope.root !== "standalone") {
        fail("scope root", "expected original or standalone");
      }
      return {
        kind: "subtree",
        fromNodeId: asId(scope.fromNodeId, "scope fromNodeId"),
        root: scope.root
      };
    case "whole-game":
      return { kind: "whole-game" };
    default:
      return fail("scope", "expected path, subtree or whole-game");
  }
}

function parseAddFromGameDestination(value: unknown): AddFromGameDestination {
  const destination = asObject(value, "destination");
  switch (destination.kind) {
    case "new-chapter":
      return {
        kind: "new-chapter",
        title: asString(destination.title ?? "", "destination title", MAX_NAME),
        chapterKind: asChapterKind(destination.chapterKind)
      };
    case "existing-chapter":
      return { kind: "existing-chapter", chapterId: asId(destination.chapterId, "chapterId") };
    default:
      return fail("destination", "expected new-chapter or existing-chapter");
  }
}

/**
 * Shallow shape check, like parseSaveGameInput: the source tree must be an array of at most
 * 100,000 nodes and its headers a string map of at most 200 tags; the policy is null (use the
 * proposed defaults) or two id lists. The repertoire service replays and checks every node before
 * anything is copied.
 */
export function parseAddFromGameInput(value: unknown): AddFromGameInput {
  const input = asObject(value, "add from game");
  const source = asObject(input.source, "source");
  if (!Array.isArray(source.tree)) fail("source tree", "expected an array");
  if (source.tree.length > MAX_CHAPTER_NODES) fail("source tree", "too many nodes");
  const policy = input.policy === null ? null : asObject(input.policy, "policy");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    expectedRevision: asRevision(input.expectedRevision),
    destination: parseAddFromGameDestination(input.destination),
    source: {
      gameId: nullable(source.gameId, (id) => asId(id, "source gameId")) ?? null,
      headers: asTextRecord(source.headers ?? {}, "source headers", 200, MAX_HEADER),
      rootFen: asFen(source.rootFen, "source rootFen"),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service replays and checks every node before anything is copied
      tree: source.tree as MoveNode[],
      nodeId: nullable(source.nodeId, (id) => asId(id, "source nodeId")) ?? null
    },
    scope: parseAddFromGameScope(input.scope),
    policy: policy && {
      includedNodeIds: asIdArray(policy.includedNodeIds, "includedNodeIds", MAX_CHAPTER_NODES),
      coveredNodeIds: asIdArray(policy.coveredNodeIds, "coveredNodeIds", MAX_CHAPTER_NODES)
    }
  };
}

export function parseGameLinkQuery(value: unknown): { repertoireId: string; chapterId?: string } {
  const input = asObject(value, "game links");
  const query: { repertoireId: string; chapterId?: string } = {
    repertoireId: asId(input.repertoireId, "repertoireId")
  };
  const chapterId = optional(input.chapterId, (id) => asId(id, "chapterId"));
  if (chapterId !== undefined) query.chapterId = chapterId;
  return query;
}

export function parseRemoveGameLink(value: unknown): { repertoireId: string; linkId: string } {
  const input = asObject(value, "game link");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    linkId: asId(input.linkId, "linkId")
  };
}

/** Longest SAN path a game link stores (the handoff or attachment point). */
const MAX_CAPTURED_PATH = 2000;

export function parseLinkGameInput(value: unknown): LinkGameInput {
  const input = asObject(value, "game link");
  if (input.kind !== "model" && input.kind !== "played") fail("kind", "expected model or played");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    chapterId: nullable(input.chapterId, (id) => asId(id, "chapterId")) ?? null,
    gameId: asId(input.gameId, "gameId"),
    gameNodeId: nullable(input.gameNodeId, (id) => asId(id, "gameNodeId")) ?? null,
    kind: input.kind,
    capturedPath: asString(input.capturedPath, "capturedPath", MAX_CAPTURED_PATH)
  };
}

export function parsePracticeActionInput(value: unknown): PracticeActionInput {
  const input = asObject(value, "practice action");
  const action = asObject(input.action, "practice action");
  if (
    action.kind !== "hint" &&
    action.kind !== "reveal" &&
    action.kind !== "skip" &&
    action.kind !== "follow-other-line"
  ) {
    fail("practice action", "expected hint, reveal, skip or follow-other-line");
  }
  return {
    sessionId: asId(input.sessionId, "sessionId"),
    queueItemId: asId(input.queueItemId, "queueItemId"),
    action: { kind: action.kind }
  };
}

export function parseRecordAttemptInput(value: unknown): RecordAttemptInput {
  const input = asObject(value, "attempt");
  return {
    sessionId: asId(input.sessionId, "sessionId"),
    queueItemId: asId(input.queueItemId, "queueItemId"),
    attemptId: asId(input.attemptId, "attemptId"),
    uci: asUci(input.uci, "uci")
  };
}

export function parseSaveWorkspaceInput(value: unknown): SaveWorkspaceInput {
  const input = asObject(value, "workspace save");
  const workspace = asObject(input.workspace, "workspace");
  return {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    workspace: {
      lastChapterId: nullable(workspace.lastChapterId, (id) => asId(id, "lastChapterId")) ?? null,
      lastNodeId: nullable(workspace.lastNodeId, (id) => asId(id, "lastNodeId")) ?? null,
      orientation: asRepertoireColor(workspace.orientation, "orientation"),
      practiceDraft: nullable(workspace.practiceDraft, parseStartPracticeInput) ?? null
    },
    ...(input.practiceSetup === true ? { practiceSetup: true } : {})
  };
}
