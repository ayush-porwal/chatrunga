/**
 * Native repertoire backup (design §10): building the versioned JSON document, validating one
 * read from disk before anything is restored, diffing a backup entry against the stored state, and
 * giving a restored copy fresh ids. Pure: the main process owns dialogs, files and transactions.
 *
 * Validation rebuilds every object from its known fields only, so anything else in a document
 * (credentials, API keys, engine paths, cached evaluations) is ignored rather than restored. Chess
 * legality of the trees is checked again in the main process before inserting.
 */
import type { BoardArrow, BoardHighlight, MoveNode } from "../types/chess";
import {
  REPERTOIRE_BACKUP_FORMAT,
  REPERTOIRE_BACKUP_FORMAT_VERSION,
  REPERTOIRE_POSITION_KEY_VERSION,
  REPERTOIRE_ROOT_NODE_ID,
  REPERTOIRE_SCHEDULER_VERSION,
  type BackupDiff,
  type RepertoireBackupDocument,
  type RepertoireBackupEntry,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireDecision,
  type RepertoireEdgeKind,
  type RepertoireGameLink,
  type RepertoireNodeMeta,
  type RepertoireProgress,
  type RepertoireWorkspaceState
} from "../types/repertoire";
import { positionKey } from "./repertoire-position";
import { isOneOf } from "../types/guards";
import { nullPrototypeRecord } from "../types/record";

/** Bounds a backup must stay within, and the versions this app reads (design §11). */
export type BackupLimits = {
  maxRepertoires: number;
  maxChapters: number;
  maxNodes: number;
  maxBytes: number;
  positionKeyVersion: number;
  schedulerVersion: number;
};

export const DEFAULT_BACKUP_LIMITS: BackupLimits = {
  maxRepertoires: 100,
  maxChapters: 1_000,
  maxNodes: 200_000,
  maxBytes: 32 * 1024 * 1024,
  positionKeyVersion: REPERTOIRE_POSITION_KEY_VERSION,
  schedulerVersion: REPERTOIRE_SCHEDULER_VERSION
};

export type { BackupDiff };

const MAX_ID = 200;
const MAX_TEXT = 20_000;
const MAX_TAGS = 64;
const MAX_RECORD_ENTRIES = 256;
const EDGES: readonly RepertoireEdgeKind[] = ["reference", "included", "covered"];
const LINK_KINDS: readonly RepertoireGameLink["kind"][] = ["source", "model", "played"];
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

type Fields = Record<string, unknown>;

function invalid(reason: string): never {
  throw new Error(`Invalid backup: ${reason}`);
}

function isObject(value: unknown): value is Fields {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, where: string): Fields {
  if (!isObject(value)) invalid(`${where} is not an object`);
  return value;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${where} is not a list`);
  return value;
}

function id(value: unknown, where: string): string {
  if (typeof value !== "string" || !value || value.length > MAX_ID || CONTROL_CHARS.test(value)) {
    invalid(`${where} has no valid id`);
  }
  return value;
}

function text(value: unknown, where: string, max = MAX_TEXT): string {
  if (typeof value !== "string") invalid(`${where} is not text`);
  return value.slice(0, max);
}

function nullableText(value: unknown, where: string, max = MAX_TEXT): string | null {
  return value === null || value === undefined ? null : text(value, where, max);
}

function nullableId(value: unknown, where: string): string | null {
  return value === null || value === undefined ? null : id(value, where);
}

function finite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${where} is not a number`);
  return value;
}

function nullableFinite(value: unknown, where: string): number | null {
  return value === null || value === undefined ? null : finite(value, where);
}

function wholeNumber(value: unknown, where: string): number {
  const number = finite(value, where);
  if (!Number.isInteger(number) || number < 0) invalid(`${where} is not a whole number`);
  return number;
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") invalid(`${where} is not true or false`);
  return value;
}

function color(value: unknown, where: string): RepertoireColor {
  if (value !== "white" && value !== "black") invalid(`${where} is not white or black`);
  return value;
}

function stringRecord(value: unknown, where: string): Record<string, string> {
  const entries = Object.entries(object(value, where));
  if (entries.length > MAX_RECORD_ENTRIES) invalid(`${where} has too many entries`);
  const record: Record<string, string> = {};
  for (const [key, entry] of entries) record[key] = text(entry, `${where}.${key}`);
  return record;
}

function stringList(value: unknown, where: string, maxItems: number): string[] {
  const items = array(value, where);
  if (items.length > maxItems) invalid(`${where} has too many items`);
  return items.map((item, index) => text(item, `${where}[${index}]`, MAX_ID));
}

function bytesOf(value: string): number {
  return new TextEncoder().encode(value).length;
}

function mib(bytes: number): string {
  return `${Math.ceil((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}

const formatCount = (count: number) => count.toLocaleString("en-US");

/** True for a key `positionKey` produces in this app's version: its prefix, then a legal EPD. */
function isWellFormedKey(key: string): boolean {
  const prefix = `v${REPERTOIRE_POSITION_KEY_VERSION}:`;
  if (!key.startsWith(prefix)) return false;
  try {
    return positionKey(key.slice(prefix.length)) === key;
  } catch {
    return false;
  }
}

/** "1 decision doesn't … and was left out" / "2 decisions don't … and were left out". */
function dropped(count: number, noun: string, nouns: string, reason: string): string {
  const one = count === 1;
  return `${count} ${one ? noun : nouns} ${one ? "doesn't" : "don't"} ${reason} and ${one ? "was" : "were"} left out`;
}

/* ------------------------------------------------------------------ building */

/** The document for `entries`, stamped with the app and the versions its keys and schedules use. */
export function buildBackupDocument(
  entries: readonly RepertoireBackupEntry[],
  options: {
    app: { name: string; version: string };
    now: number;
    positionKeyVersion: number;
    schedulerVersion: number;
  }
): RepertoireBackupDocument {
  return {
    format: REPERTOIRE_BACKUP_FORMAT,
    formatVersion: REPERTOIRE_BACKUP_FORMAT_VERSION,
    positionKeyVersion: options.positionKeyVersion,
    schedulerVersion: options.schedulerVersion,
    exportedAt: options.now,
    app: { name: options.app.name, version: options.app.version },
    repertoires: [...entries]
  };
}

/**
 * An entry as written to a backup: progress left out unless `includeProgress`, derived due counts
 * zeroed, and no practice draft in the workspace (it names chapters of a live session).
 */
export function stripForExport(
  entry: RepertoireBackupEntry,
  includeProgress: boolean
): RepertoireBackupEntry {
  return {
    repertoire: { ...entry.repertoire, tags: [...entry.repertoire.tags] },
    chapters: entry.chapters.map((chapter) => ({ ...chapter, dueCount: 0 })),
    decisions: entry.decisions.map((decision) => ({ ...decision })),
    progress: includeProgress && entry.progress ? entry.progress.map((row) => ({ ...row })) : null,
    workspace: entry.workspace ? { ...entry.workspace, practiceDraft: null } : null,
    gameLinks: entry.gameLinks.map((link) => ({ ...link }))
  };
}

/* ------------------------------------------------------------------ validation */

function parseArrows(value: unknown): BoardArrow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (arrow): arrow is BoardArrow =>
        isObject(arrow) &&
        typeof arrow.orig === "string" &&
        typeof arrow.dest === "string" &&
        typeof arrow.color === "string"
    )
    .map((arrow) => ({ orig: arrow.orig, dest: arrow.dest, color: arrow.color }));
}

function parseHighlights(value: unknown): BoardHighlight[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (highlight): highlight is BoardHighlight =>
        isObject(highlight) &&
        typeof highlight.square === "string" &&
        typeof highlight.color === "string"
    )
    .map((highlight) => ({ square: highlight.square, color: highlight.color }));
}

function parseNode(value: unknown, where: string): MoveNode {
  const node = object(value, where);
  const nodeId = id(node.id, where);
  const at = `${where} ("${nodeId}")`;
  const children = array(node.children, `${at} children`).map((child, index) =>
    id(child, `${at} child ${index + 1}`)
  );
  const fenAfter = text(node.fenAfter, `${at} fenAfter`, 200);
  return {
    id: nodeId,
    parentId: nullableId(node.parentId, `${at} parent`),
    san: typeof node.san === "string" ? node.san.slice(0, 16) : null,
    uci: nullableText(node.uci, `${at} move`, 5),
    fenBefore: typeof node.fenBefore === "string" ? node.fenBefore.slice(0, 200) : fenAfter,
    fenAfter,
    ply: typeof node.ply === "number" && Number.isInteger(node.ply) ? node.ply : 0,
    nags: Array.isArray(node.nags)
      ? node.nags.filter((nag): nag is string => typeof nag === "string").slice(0, 16)
      : [],
    comment: typeof node.comment === "string" ? node.comment.slice(0, MAX_TEXT) : null,
    clockAfter: typeof node.clockAfter === "string" ? node.clockAfter.slice(0, 32) : null,
    arrows: parseArrows(node.arrows),
    highlights: parseHighlights(node.highlights),
    children
  };
}

/** Root `"root"` without a parent, unique ids, matching parent/child links, all nodes reachable. */
function checkTreeShape(tree: readonly MoveNode[], where: string): void {
  const byId = new Map<string, MoveNode>();
  for (const node of tree) {
    if (byId.has(node.id)) invalid(`${where} lists node "${node.id}" twice`);
    byId.set(node.id, node);
  }
  const root = byId.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) invalid(`${where} has no root node`);
  if (root.parentId !== null) invalid(`${where} has a root node with a parent`);
  const reached = new Set([root.id]);
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (!child) invalid(`${where} node "${node.id}" lists a missing child "${childId}"`);
      if (child.parentId !== node.id) invalid(`${where} node "${childId}" has the wrong parent`);
      if (reached.has(childId)) invalid(`${where} node "${childId}" is reachable twice`);
      reached.add(childId);
      pending.push(child);
    }
  }
  if (reached.size !== tree.length) {
    const orphan = tree.find((node) => !reached.has(node.id))!;
    invalid(`${where} node "${orphan.id}" is not connected to the root`);
  }
}

function parseNodeMeta(
  value: unknown,
  tree: readonly MoveNode[],
  where: string
): Record<string, RepertoireNodeMeta> {
  const ids = new Set(tree.map((node) => node.id));
  const meta: Record<string, RepertoireNodeMeta> = nullPrototypeRecord();
  if (value === undefined || value === null) return meta;
  for (const [nodeId, entry] of Object.entries(object(value, `${where} node metadata`))) {
    if (!ids.has(nodeId)) continue;
    if (!isObject(entry) || !isOneOf(EDGES, entry.edge)) {
      invalid(`${where} node "${nodeId}" has no valid edge kind`);
    }
    const next: RepertoireNodeMeta = { edge: entry.edge };
    if (entry.trainingStart === true) next.trainingStart = true;
    if (entry.trainingStop === true) next.trainingStop = true;
    if (entry.disabled === true) next.disabled = true;
    meta[nodeId] = next;
  }
  return meta;
}

function parseChapter(value: unknown, where: string): RepertoireChapter {
  const chapter = object(value, where);
  const chapterId = id(chapter.id, where);
  const title = text(chapter.title, `${where} title`, 200);
  const at = `chapter "${title || chapterId}"`;
  if (chapter.kind !== "opening" && chapter.kind !== "reference") {
    invalid(`${at} has no valid kind (expected opening or reference)`);
  }
  const nodes = array(chapter.tree, `${at} tree`);
  const tree = nodes.map((node, index) => parseNode(node, `${at} node ${index + 1}`));
  checkTreeShape(tree, at);
  return {
    id: chapterId,
    title,
    sortOrder: Math.trunc(finite(chapter.sortOrder, `${at} sort order`)),
    kind: chapter.kind,
    enabled: bool(chapter.enabled, `${at} enabled`),
    rootFen: text(chapter.rootFen, `${at} root FEN`, 200),
    revision: Math.max(1, wholeNumber(chapter.revision, `${at} revision`)),
    nodeCount: tree.length - 1,
    dueCount: 0,
    headers: chapter.headers === undefined ? {} : stringRecord(chapter.headers, `${at} headers`),
    tree,
    nodeMeta: parseNodeMeta(chapter.nodeMeta, tree, at)
  };
}

function parseDecision(value: unknown, repertoireId: string, where: string): RepertoireDecision {
  const decision = object(value, where);
  const key = text(decision.positionKey, `${where} position key`, 200);
  return {
    repertoireId,
    positionKey: key,
    acceptedUcis: stringList(decision.acceptedUcis, `${where} accepted moves`, 64),
    preferredUci: nullableText(decision.preferredUci, `${where} preferred move`, 5),
    prompt: nullableText(decision.prompt, `${where} prompt`),
    hint: nullableText(decision.hint, `${where} hint`),
    wrongMoveFeedback:
      decision.wrongMoveFeedback === undefined
        ? {}
        : stringRecord(decision.wrongMoveFeedback, `${where} wrong-move feedback`),
    paused: decision.paused === undefined ? false : bool(decision.paused, `${where} paused`)
  };
}

function parseProgress(value: unknown, repertoireId: string, where: string): RepertoireProgress {
  const row = object(value, where);
  return {
    repertoireId,
    positionKey: text(row.positionKey, `${where} position key`, 200),
    stage: wholeNumber(row.stage, `${where} stage`),
    dueAt: nullableFinite(row.dueAt, `${where} due time`),
    lastAttemptAt: nullableFinite(row.lastAttemptAt, `${where} last attempt`),
    lapses: wholeNumber(row.lapses, `${where} lapses`),
    unaidedSuccesses: wholeNumber(row.unaidedSuccesses, `${where} successes`),
    acceptanceFingerprint: text(row.acceptanceFingerprint, `${where} fingerprint`, 2_000),
    schedulerVersion: wholeNumber(row.schedulerVersion, `${where} scheduler version`),
    suspended: row.suspended === undefined ? false : bool(row.suspended, `${where} suspended`)
  };
}

function parseWorkspace(
  value: unknown,
  chapterIds: ReadonlySet<string>,
  where: string
): RepertoireWorkspaceState | null {
  if (value === null || value === undefined) return null;
  const workspace = object(value, where);
  const lastChapterId = nullableId(workspace.lastChapterId, `${where} last chapter`);
  const known = lastChapterId !== null && chapterIds.has(lastChapterId);
  return {
    lastChapterId: known ? lastChapterId : null,
    lastNodeId: known ? nullableId(workspace.lastNodeId, `${where} last node`) : null,
    orientation: color(workspace.orientation, `${where} orientation`),
    practiceDraft: null
  };
}

function parseGameLink(
  value: unknown,
  repertoireId: string,
  chapterIds: ReadonlySet<string>,
  where: string
): RepertoireGameLink {
  const link = object(value, where);
  const kind = link.kind;
  if (!isOneOf(LINK_KINDS, kind)) invalid(`${where} has no valid kind`);
  const chapterId = nullableId(link.chapterId, `${where} chapter`);
  return {
    id: id(link.id, where),
    repertoireId,
    chapterId: chapterId !== null && chapterIds.has(chapterId) ? chapterId : null,
    gameId: nullableId(link.gameId, `${where} game`),
    // Missing in files written before the field: such a link wasn't marked as never saved.
    unsaved: link.unsaved === true,
    gameNodeId: nullableId(link.gameNodeId, `${where} game node`),
    kind,
    headers: link.headers === undefined ? {} : stringRecord(link.headers, `${where} headers`),
    capturedPath: link.capturedPath === undefined ? "" : text(link.capturedPath, `${where} path`),
    createdAt: finite(link.createdAt, `${where} creation time`)
  };
}

function parseEntry(
  value: unknown,
  index: number,
  options: { keepProgress: boolean; schedulerVersion: number },
  warnings: string[]
): RepertoireBackupEntry {
  const entry = object(value, `repertoire ${index + 1}`);
  const meta = object(entry.repertoire, `repertoire ${index + 1}`);
  const repertoireId = id(meta.id, `repertoire ${index + 1}`);
  const name = text(meta.name, `repertoire ${index + 1} name`, 200).trim();
  const label = `repertoire "${name || repertoireId}"`;
  const tags = meta.tags === undefined ? [] : stringList(meta.tags, `${label} tags`, MAX_TAGS);
  const repertoire: RepertoireBackupEntry["repertoire"] = {
    id: repertoireId,
    name,
    color: color(meta.color, `${label} color`),
    description: meta.description === undefined ? "" : text(meta.description, `${label} notes`),
    tags,
    revision: Math.max(1, wholeNumber(meta.revision, `${label} revision`)),
    archivedAt: nullableFinite(meta.archivedAt, `${label} archive time`),
    createdAt: finite(meta.createdAt, `${label} creation time`),
    updatedAt: finite(meta.updatedAt, `${label} update time`)
  };

  const chapters: RepertoireChapter[] = [];
  let damaged = 0;
  array(entry.chapters, `${label} chapters`).forEach((chapter, chapterIndex) => {
    // A chapter that was already unreadable when backed up holds raw data only.
    if (isObject(chapter) && isObject(chapter.damaged)) damaged += 1;
    else chapters.push(parseChapter(chapter, `${label} chapter ${chapterIndex + 1}`));
  });
  if (damaged) {
    warnings.push(
      `${label}: ${damaged} chapter${damaged === 1 ? " was" : "s were"} damaged when backed up and will be left out`
    );
  }
  const chapterIds = new Set<string>();
  for (const chapter of chapters) {
    if (chapterIds.has(chapter.id)) invalid(`${label} lists chapter "${chapter.title}" twice`);
    chapterIds.add(chapter.id);
  }

  // Decisions no chapter reaches are kept: the restore suspends them, as the library did.
  const decisions: RepertoireDecision[] = [];
  const seenDecisions = new Set<string>();
  let malformedDecisions = 0;
  array(entry.decisions, `${label} decisions`).forEach((item, decisionIndex) => {
    const decision = parseDecision(item, repertoireId, `${label} decision ${decisionIndex + 1}`);
    if (!isWellFormedKey(decision.positionKey) || seenDecisions.has(decision.positionKey)) {
      malformedDecisions += 1;
      return;
    }
    seenDecisions.add(decision.positionKey);
    decisions.push(decision);
  });
  if (malformedDecisions) {
    warnings.push(
      `${label}: ${dropped(malformedDecisions, "decision", "decisions", "have a valid, unique position key")}`
    );
  }

  let progress: RepertoireProgress[] | null = null;
  if (entry.progress !== null && entry.progress !== undefined) {
    const rows = array(entry.progress, `${label} progress`).map((item, rowIndex) =>
      parseProgress(item, repertoireId, `${label} progress entry ${rowIndex + 1}`)
    );
    if (options.keepProgress) {
      progress = [];
      const seen = new Set<string>();
      let malformed = 0;
      let newer = 0;
      for (const row of rows) {
        if (row.schedulerVersion > options.schedulerVersion) newer += 1;
        else if (!isWellFormedKey(row.positionKey) || seen.has(row.positionKey)) malformed += 1;
        else {
          seen.add(row.positionKey);
          progress.push(row);
        }
      }
      if (malformed) {
        warnings.push(
          `${label}: ${dropped(malformed, "progress entry", "progress entries", "have a valid, unique position key")}`
        );
      }
      if (newer) {
        warnings.push(
          `${label}: ${newer} progress entr${newer === 1 ? "y was" : "ies were"} scheduled by a newer app and left out`
        );
      }
    }
  }

  const gameLinks = array(entry.gameLinks ?? [], `${label} game links`).map((item, linkIndex) =>
    parseGameLink(item, repertoireId, chapterIds, `${label} game link ${linkIndex + 1}`)
  );

  return {
    repertoire,
    chapters,
    decisions,
    progress,
    workspace: parseWorkspace(entry.workspace, chapterIds, `${label} workspace`),
    gameLinks
  };
}

/**
 * Checks a backup (its JSON text, or the parsed value) before anything is restored: the format
 * name and version, the position-key and scheduler versions, the size limits, and the structure of
 * every repertoire. A leading UTF-8 byte order mark is ignored. Decisions and progress keep their
 * place even when no chapter reaches it (the restore suspends them); only malformed or duplicate
 * keys, and chapters that were damaged when backed up, are dropped with a warning. Throws
 * `Invalid backup: …` with an actionable reason.
 */
export function validateBackupDocument(
  value: unknown,
  limits: BackupLimits = DEFAULT_BACKUP_LIMITS
): { document: RepertoireBackupDocument; warnings: string[] } {
  let parsed = value;
  if (typeof value === "string") {
    const bytes = value.length > limits.maxBytes ? value.length : bytesOf(value);
    if (bytes > limits.maxBytes) {
      invalid(`the file is ${mib(bytes)}; backups up to ${mib(limits.maxBytes)} can be restored`);
    }
    try {
      parsed = JSON.parse(value.startsWith("\uFEFF") ? value.slice(1) : value);
    } catch {
      invalid("the file isn't valid JSON; choose a Chaturanga repertoire backup");
    }
  }
  if (!isObject(parsed) || parsed.format !== REPERTOIRE_BACKUP_FORMAT) {
    invalid("this isn't a Chaturanga repertoire backup");
  }
  if (parsed.formatVersion !== REPERTOIRE_BACKUP_FORMAT_VERSION) {
    invalid(`format version ${String(parsed.formatVersion)} isn't supported by this app`);
  }
  const positionKeyVersion = wholeNumber(parsed.positionKeyVersion, "the position key version");
  const schedulerVersion = wholeNumber(parsed.schedulerVersion, "the scheduler version");
  if (positionKeyVersion > limits.positionKeyVersion) {
    invalid(
      `it uses position key version ${positionKeyVersion}, newer than this app's ${limits.positionKeyVersion}; update Chaturanga to restore it`
    );
  }
  const warnings: string[] = [];
  if (positionKeyVersion < limits.positionKeyVersion) {
    warnings.push(
      `The backup uses position key version ${positionKeyVersion}; decisions and progress keyed by it may not carry over`
    );
  }
  const keepProgress = schedulerVersion <= limits.schedulerVersion;
  if (!keepProgress) {
    warnings.push(
      `Progress was scheduled by a newer app (scheduler version ${schedulerVersion}); it will be left out`
    );
  }

  const app = isObject(parsed.app) ? parsed.app : {};
  const entries = array(parsed.repertoires, "the repertoire list");
  if (entries.length > limits.maxRepertoires) {
    invalid(
      `it has ${formatCount(entries.length)} repertoires; at most ${formatCount(limits.maxRepertoires)} can be restored at once`
    );
  }
  let chapterTotal = 0;
  let nodeTotal = 0;
  for (const entry of entries) {
    const chapters = isObject(entry) && Array.isArray(entry.chapters) ? entry.chapters : [];
    chapterTotal += chapters.length;
    for (const chapter of chapters) {
      if (isObject(chapter) && Array.isArray(chapter.tree)) nodeTotal += chapter.tree.length;
    }
  }
  if (chapterTotal > limits.maxChapters) {
    invalid(
      `it has ${formatCount(chapterTotal)} chapters; at most ${formatCount(limits.maxChapters)} can be restored at once`
    );
  }
  if (nodeTotal > limits.maxNodes) {
    invalid(
      `it has ${formatCount(nodeTotal)} moves; at most ${formatCount(limits.maxNodes)} can be restored at once`
    );
  }

  const repertoires = entries.map((entry, index) =>
    parseEntry(entry, index, { keepProgress, schedulerVersion: limits.schedulerVersion }, warnings)
  );
  const repertoireIds = new Set<string>();
  const chapterIds = new Set<string>();
  for (const entry of repertoires) {
    if (repertoireIds.has(entry.repertoire.id)) {
      invalid(`repertoire "${entry.repertoire.name}" is listed twice`);
    }
    repertoireIds.add(entry.repertoire.id);
    for (const chapter of entry.chapters) {
      if (chapterIds.has(chapter.id)) {
        invalid(`chapter "${chapter.title}" appears in more than one repertoire`);
      }
      chapterIds.add(chapter.id);
    }
  }

  return {
    document: {
      format: REPERTOIRE_BACKUP_FORMAT,
      formatVersion: REPERTOIRE_BACKUP_FORMAT_VERSION,
      positionKeyVersion,
      schedulerVersion,
      exportedAt: finite(parsed.exportedAt, "the export time"),
      app: {
        name: typeof app.name === "string" ? app.name.slice(0, 100) : "",
        version: typeof app.version === "string" ? app.version.slice(0, 50) : ""
      },
      repertoires
    },
    warnings
  };
}

/* ------------------------------------------------------------------ diff and remap */

/** JSON with object keys sorted, so two equal values serialise identically. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The authored content of a chapter that a restore would replace (node order ignored). */
function chapterContent(chapter: RepertoireChapter): string {
  const tree = [...chapter.tree]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((node) => ({
      id: node.id,
      parentId: node.parentId,
      uci: node.uci,
      fenAfter: node.fenAfter,
      nags: node.nags,
      comment: node.comment,
      clockAfter: node.clockAfter ?? null,
      arrows: node.arrows,
      highlights: node.highlights,
      children: node.children
    }));
  return canonical({
    title: chapter.title,
    kind: chapter.kind,
    enabled: chapter.enabled,
    rootFen: chapter.rootFen,
    headers: chapter.headers,
    nodeMeta: { ...chapter.nodeMeta },
    tree
  });
}

/** What a game link says, whatever its id (a replace keeps or renews ids). */
function linkContent(link: RepertoireGameLink): string {
  return canonical({
    kind: link.kind,
    gameId: link.gameId,
    chapterId: link.chapterId,
    gameNodeId: link.gameNodeId,
    capturedPath: link.capturedPath
  });
}

function decisionContent(decision: RepertoireDecision): string {
  return canonical({
    acceptedUcis: [...decision.acceptedUcis].sort(),
    preferredUci: decision.preferredUci,
    prompt: decision.prompt,
    hint: decision.hint,
    wrongMoveFeedback: decision.wrongMoveFeedback,
    paused: decision.paused
  });
}

/**
 * What replacing `existing` with `incoming` would change. Chapters match by id; a chapter changed
 * when its title, kind, enabled flag, root, headers, tree or node metadata differ. A decision
 * changed when it was added, removed or edited. `progressEntries` counts the incoming progress,
 * `progressDiscarded` the existing progress a replace deletes, and `sessionsDiscarded` the
 * existing practice sessions (`context.sessionCount`). Game links compare by what they link
 * (kind, game, chapter, move, path): `linksAdded` and `linksRemoved` count the differences.
 * `metadataChanged` names the repertoire fields that differ.
 */
export function diffBackupEntry(
  existing: RepertoireBackupEntry,
  incoming: RepertoireBackupEntry,
  context: { sessionCount?: number } = {}
): BackupDiff {
  const before = new Map(existing.chapters.map((chapter) => [chapter.id, chapter]));
  const after = new Map(incoming.chapters.map((chapter) => [chapter.id, chapter]));
  let chaptersAdded = 0;
  let chaptersChanged = 0;
  for (const [chapterId, chapter] of after) {
    const previous = before.get(chapterId);
    if (!previous) chaptersAdded += 1;
    else if (chapterContent(previous) !== chapterContent(chapter)) chaptersChanged += 1;
  }
  const chaptersRemoved = [...before.keys()].filter((chapterId) => !after.has(chapterId)).length;

  const oldDecisions = new Map(existing.decisions.map((item) => [item.positionKey, item]));
  const newDecisions = new Map(incoming.decisions.map((item) => [item.positionKey, item]));
  let decisionsChanged = 0;
  for (const key of new Set([...oldDecisions.keys(), ...newDecisions.keys()])) {
    const a = oldDecisions.get(key);
    const b = newDecisions.get(key);
    if (!a || !b || decisionContent(a) !== decisionContent(b)) decisionsChanged += 1;
  }
  const oldLinks = new Set(existing.gameLinks.map(linkContent));
  const newLinks = new Set(incoming.gameLinks.map(linkContent));
  const linksAdded = [...newLinks].filter((link) => !oldLinks.has(link)).length;
  const linksRemoved = [...oldLinks].filter((link) => !newLinks.has(link)).length;
  const a = existing.repertoire;
  const b = incoming.repertoire;
  const metadataChanged = [
    a.name !== b.name && "name",
    a.description !== b.description && "description",
    canonical(a.tags) !== canonical(b.tags) && "tags",
    a.archivedAt !== b.archivedAt && "archivedAt",
    a.color !== b.color && "color"
  ].filter((field): field is string => Boolean(field));
  return {
    chaptersAdded,
    chaptersChanged,
    chaptersRemoved,
    decisionsChanged,
    progressEntries: incoming.progress?.length ?? 0,
    progressDiscarded: existing.progress?.length ?? 0,
    sessionsDiscarded: context.sessionCount ?? 0,
    linksAdded,
    linksRemoved,
    metadataChanged
  };
}

/**
 * The entry under a new repertoire id with fresh chapter ids (`idFor`) and link ids (`linkIdFor`,
 * defaulting to `idFor`). Node ids are chapter-local and stay, so node metadata, the workspace's
 * last node and link nodes still line up.
 */
export function remapBackupEntry(
  entry: RepertoireBackupEntry,
  options: {
    newRepertoireId: string;
    idFor: (chapterId: string) => string;
    linkIdFor?: (linkId: string) => string;
  }
): RepertoireBackupEntry {
  const repertoireId = options.newRepertoireId;
  const chapterIds = new Map(
    entry.chapters.map((chapter) => [chapter.id, options.idFor(chapter.id)])
  );
  const linkIdFor = options.linkIdFor ?? options.idFor;
  const mapChapter = (chapterId: string | null) =>
    chapterId === null ? null : (chapterIds.get(chapterId) ?? null);
  const lastChapterId = entry.workspace ? mapChapter(entry.workspace.lastChapterId) : null;
  return {
    repertoire: { ...entry.repertoire, id: repertoireId, tags: [...entry.repertoire.tags] },
    chapters: entry.chapters.map((chapter) => ({ ...chapter, id: chapterIds.get(chapter.id)! })),
    decisions: entry.decisions.map((decision) => ({ ...decision, repertoireId })),
    progress: entry.progress ? entry.progress.map((row) => ({ ...row, repertoireId })) : null,
    workspace: entry.workspace
      ? {
          ...entry.workspace,
          lastChapterId,
          lastNodeId: lastChapterId ? entry.workspace.lastNodeId : null,
          practiceDraft: null
        }
      : null,
    gameLinks: entry.gameLinks.map((link) => ({
      ...link,
      id: linkIdFor(link.id),
      repertoireId,
      chapterId: mapChapter(link.chapterId)
    }))
  };
}
