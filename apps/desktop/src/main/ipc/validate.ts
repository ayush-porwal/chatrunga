/**
 * Input validation for IPC handlers. The renderer is treated as untrusted:
 * every payload that reaches the file system, the database or an engine
 * process is checked here and rebuilt from known fields only.
 */
import { parseSettingValue } from "./settings-values";
import { isAbsolute } from "node:path";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import type {
  Color,
  GameHeaders,
  GameListFilter,
  GameListQuery,
  GameSource,
  MoveNode,
  SaveGameInput
} from "@chaturanga/shared/types/chess";
import { GAME_SEARCH_MAX_LENGTH } from "@chaturanga/shared/types/chess";
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
  PreviewBackupImportInput,
  PreviewImportInput,
  RecordAttemptInput,
  RemoveChapterInput,
  RemoveRepertoireInput,
  RepertoireColor,
  RepertoireListFilters,
  RepertoireNodeMeta,
  RestoreBackupInput,
  SaveChapterInput,
  SaveWorkspaceInput,
  StartPracticeInput,
  UpdateDecisionInput,
  UpdateRepertoireMetadataInput
} from "@chaturanga/shared/types/repertoire";
import { COMPARE_GAME_MAX_PLIES } from "@chaturanga/shared/types/repertoire";
import type { PuzzleSampleInput } from "@chaturanga/shared/types/database";
import type {
  CreateEngineInput,
  EngineGoClock,
  MaiaRating,
  ProbeEvalInput,
  ReviewGameInput,
  ReviewMoveInputItem,
  StartEngineGameInput,
  StartLiveAnalysisInput,
  UpdateEngineInput
} from "@chaturanga/shared/types/engine";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import type { DialogFileFilter } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  LichessAiChallengeInput,
  LichessChallengeInput,
  LichessSeekInput
} from "@chaturanga/shared/types/lichess";

const MAX_ID = 200;
const MAX_PATH = 4096;
const MAX_NAME = 200;
/** PGN tag values (a long Event or Opening name) — generous, but bounded. */
const MAX_HEADER = 2_000;
const MAX_ARGS = 64;
const MAX_MOVES = 2000;
const MAX_PGN_BYTES = 20 * 1024 * 1024;
const MAIA_RATINGS: readonly MaiaRating[] = [1100, 1300, 1500, 1700, 1900];
const GAME_SOURCES: readonly GameSource[] = [
  "new",
  "pgn-import",
  "engine-game",
  "analysis",
  "puzzle",
  "lichess"
];
/** UCI long algebraic move (castling may be king-takes-rook in Chess960 form). */
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

type Fields = Record<string, unknown>;

function fail(label: string, reason: string): never {
  throw new Error(`Invalid ${label}: ${reason}`);
}

export function asObject(value: unknown, label: string): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(label, "expected an object");
  return value as Fields;
}

export function asString(value: unknown, label: string, maxLength: number = MAX_PATH): string {
  if (typeof value !== "string") fail(label, "expected a string");
  if (value.length > maxLength) fail(label, "too long");
  return value;
}

/** A single-line, non-empty identifier (database row ids, engine ids, source ids). */
export function asId(value: unknown, label = "id"): string {
  const id = asString(value, label, MAX_ID).trim();
  if (!id || CONTROL_CHARS.test(id)) fail(label, "expected a non-empty identifier");
  return id;
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parse(value);
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(label, "expected a boolean");
  return value;
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(label, "expected a number");
  return value;
}

/**
 * A search bound (depth, movetime, nodes, MultiPV): null when absent, else a number from 0 up to
 * `max` (a whole number when `integer`). Keeps a request from asking an engine to search forever.
 */
function asOptionalPositive(
  value: unknown,
  label: string,
  max: number = SEARCH_LIMITS.moveTimeMs,
  integer = false
): number | null {
  if (value === undefined || value === null) return null;
  const number = asFiniteNumber(value, label);
  if (number < 0) fail(label, "must not be negative");
  if (number > max) fail(label, `must be at most ${max}`);
  if (integer && !Number.isInteger(number)) fail(label, "must be a whole number");
  return number;
}

/** Upper bounds for engine search requests. */
const SEARCH_LIMITS = { moveTimeMs: 3_600_000, depth: 200, multipv: 5, nodes: 1e12 } as const;

function asWholeNumber(value: unknown, label: string): number {
  const number = asFiniteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) fail(label, "must be a whole number");
  return number;
}

/** A rating / popularity / difficulty filter bound. */
function asFilterNumber(value: unknown, label: string): number {
  const number = asFiniteNumber(value, label);
  if (number < -10_000 || number > 10_000) fail(label, "is out of range");
  return number;
}

function asStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength = MAX_NAME
): string[] {
  if (!Array.isArray(value)) fail(label, "expected an array");
  if (value.length > maxItems) fail(label, "too many items");
  return value.map((item, index) => asString(item, `${label}[${index}]`, maxLength));
}

/** Absolute path to a file the main process will spawn or read. */
export function asAbsolutePath(value: unknown, label: string): string {
  const path = asString(value, label).trim();
  if (!path || path.includes("\0")) fail(label, "expected a file path");
  if (!isAbsolute(path)) fail(label, "must be an absolute path");
  return path;
}

function asOptionalPath(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  return asAbsolutePath(value, label);
}

/** A FEN the chess library accepts — engines may crash on malformed positions. */
export function asFen(value: unknown, label = "FEN"): string {
  const fen = asString(value, label, 128).trim();
  if (CONTROL_CHARS.test(fen)) fail(label, "contains control characters");
  try {
    positionFromFen(fen);
  } catch {
    fail(label, "not a legal position");
  }
  return fen;
}

export function asUciMoves(value: unknown, label = "moves"): string[] {
  const moves = asStringArray(value, label, MAX_MOVES, 5);
  for (const move of moves) if (!UCI_MOVE.test(move)) fail(label, `"${move}" is not a UCI move`);
  return moves;
}

function asEngineArgs(value: unknown): string[] {
  const args = asStringArray(value, "engine args", MAX_ARGS, MAX_PATH);
  if (args.some((arg) => arg.includes("\0"))) fail("engine args", "contains a NUL byte");
  return args;
}

function asMaiaRating(value: unknown): MaiaRating {
  if (!MAIA_RATINGS.includes(value as MaiaRating)) fail("Maia rating", "unsupported rating");
  return value as MaiaRating;
}

/** Fields shared by engine create / update, all optional. */
function parseEngineFields(input: Fields): UpdateEngineInput {
  const fields: UpdateEngineInput = {};
  if (input.name !== undefined)
    fields.name = asString(input.name, "engine name", MAX_NAME).trim() || "UCI Engine";
  if (input.executablePath !== undefined)
    fields.executablePath = asAbsolutePath(input.executablePath, "executable path");
  const workingDirectory = asOptionalPath(input.workingDirectory, "working directory");
  if (workingDirectory !== undefined) fields.workingDirectory = workingDirectory;
  const weightsPath = asOptionalPath(input.weightsPath, "weights path");
  if (weightsPath !== undefined) fields.weightsPath = weightsPath;
  // Display-only: a local file or an http(s)/data URL (see renderer `localImageSrc`).
  const imagePath = nullable(
    input.imagePath,
    (path) => asString(path, "image path").trim() || null
  );
  if (imagePath !== undefined) fields.imagePath = imagePath;
  if (input.args !== undefined) fields.args = asEngineArgs(input.args);
  if (input.isDefault !== undefined) fields.isDefault = asBoolean(input.isDefault, "isDefault");
  if (input.isHumanPrediction !== undefined) {
    fields.isHumanPrediction = asBoolean(input.isHumanPrediction, "isHumanPrediction");
  }
  if (input.maiaRating !== undefined && input.maiaRating !== null)
    fields.maiaRating = asMaiaRating(input.maiaRating);
  return fields;
}

export function parseEngineInput(value: unknown): CreateEngineInput {
  const input = asObject(value, "engine");
  if (input.executablePath === undefined) fail("engine", "executable path is required");
  const fields = parseEngineFields(input);
  return {
    ...fields,
    name: fields.name ?? "UCI Engine",
    executablePath: fields.executablePath!,
    workingDirectory: fields.workingDirectory ?? null,
    weightsPath: fields.weightsPath ?? null,
    imagePath: fields.imagePath ?? null,
    args: fields.args ?? []
  };
}

export function parseEnginePatch(value: unknown): UpdateEngineInput {
  return parseEngineFields(asObject(value, "engine update"));
}

function parseClock(value: unknown): EngineGoClock | null {
  if (value === undefined || value === null) return null;
  const clock = asObject(value, "clock");
  return {
    wtime: asFiniteNumber(clock.wtime, "clock.wtime"),
    btime: asFiniteNumber(clock.btime, "clock.btime"),
    winc: asFiniteNumber(clock.winc, "clock.winc"),
    binc: asFiniteNumber(clock.binc, "clock.binc")
  };
}

export function parseStartGameInput(value: unknown): StartEngineGameInput {
  const input = asObject(value, "engine game");
  if (input.side !== "white" && input.side !== "black")
    fail("engine side", "expected white or black");
  const side: Color = input.side;
  return {
    engineId: asId(input.engineId, "engine id"),
    searchId: asId(input.searchId, "search id"),
    gameKey: optional(input.gameKey, (key) => asId(key, "game key")),
    side,
    fen: asFen(input.fen),
    moves: asUciMoves(input.moves ?? []),
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs"),
    depth: asOptionalPositive(input.depth, "depth", SEARCH_LIMITS.depth, true),
    clock: parseClock(input.clock)
  };
}

export function parseStartAnalysisInput(value: unknown): StartLiveAnalysisInput {
  const input = asObject(value, "analysis");
  return {
    engineId: asId(input.engineId, "engine id"),
    searchId: asId(input.searchId, "search id"),
    fen: asFen(input.fen),
    moves: asUciMoves(input.moves ?? []),
    multipv: asOptionalPositive(input.multipv, "multipv", SEARCH_LIMITS.multipv, true),
    depth: asOptionalPositive(input.depth, "depth", SEARCH_LIMITS.depth, true),
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs", SEARCH_LIMITS.moveTimeMs)
  };
}

export function parseProbeEvalInput(value: unknown): ProbeEvalInput {
  const input = asObject(value, "evaluation probe");
  return {
    engineId: asId(input.engineId, "engine id"),
    fen: asFen(input.fen),
    moves: asUciMoves(input.moves ?? []),
    // Clamped rather than refused: a probe never needs more than a minute.
    movetimeMs: Math.min(
      asOptionalPositive(input.movetimeMs, "movetimeMs", Number.MAX_VALUE) || 400,
      60_000
    )
  };
}

function parseReviewMove(value: unknown, index: number): ReviewMoveInputItem {
  const label = `review move ${index}`;
  const move = asObject(value, label);
  const uci = asString(move.uci, `${label} uci`, 5);
  if (!UCI_MOVE.test(uci)) fail(label, `"${uci}" is not a UCI move`);
  return {
    nodeId: asId(move.nodeId, `${label} node id`),
    ply: asWholeNumber(move.ply, `${label} ply`),
    san: asString(move.san, `${label} san`, 16),
    uci,
    fenBefore: asFen(move.fenBefore, `${label} fenBefore`),
    fenAfter: asFen(move.fenAfter, `${label} fenAfter`),
    clockAfter: nullable(move.clockAfter, (clock) => asString(clock, `${label} clock`, 32))
  };
}

/** `reviewId` falls back to a generated id; everything else must be well-formed. */
export function parseReviewGameInput(value: unknown): ReviewGameInput {
  const input = asObject(value, "review");
  if (!Array.isArray(input.moves)) fail("review", "moves must be an array");
  if (input.moves.length > MAX_MOVES) fail("review", "too many moves");
  return {
    reviewId:
      input.reviewId === undefined ? `review-${Date.now()}` : asId(input.reviewId, "review id"),
    gameId: nullable(input.gameId, (id) => asId(id, "game id")),
    engineId: asId(input.engineId, "engine id"),
    predictionEngineIds: optional(input.predictionEngineIds, (ids) =>
      asStringArray(ids, "prediction engine ids", 32, MAX_ID).filter(Boolean)
    ),
    timeControl: nullable(input.timeControl, (tc) => asString(tc, "time control", 64)),
    rootFen: asFen(input.rootFen, "root FEN"),
    moves: input.moves.map(parseReviewMove),
    nodes: asOptionalPositive(input.nodes, "nodes", SEARCH_LIMITS.nodes, true),
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs"),
    depth: asOptionalPositive(input.depth, "depth", SEARCH_LIMITS.depth, true),
    multipv: asOptionalPositive(input.multipv, "multipv", SEARCH_LIMITS.multipv, true)
  };
}

const GAME_LIST_FILTERS: readonly GameListFilter[] = ["all", "reviewed", "lichess", "other"];

/** A library page request (the repository clamps the limit). */
export function parseGameListQuery(value: unknown): GameListQuery {
  const input = value === undefined ? {} : asObject(value, "game list query");
  const cursor = nullable(input.cursor, (raw) => {
    const fields = asObject(raw, "game list cursor");
    return { updatedAt: asFiniteNumber(fields.updatedAt, "cursor time"), id: asId(fields.id, "cursor id") };
  });
  if (input.filter !== undefined && !GAME_LIST_FILTERS.includes(input.filter as GameListFilter)) {
    fail("game list filter", "unknown filter");
  }
  return {
    cursor: cursor ?? null,
    limit: optional(input.limit, (limit) => asWholeNumber(limit, "page size")),
    search: optional(input.search, (search) => asString(search, "search", GAME_SEARCH_MAX_LENGTH)),
    filter: (input.filter as GameListFilter | undefined) ?? "all",
    excludeId: nullable(input.excludeId, (id) => asId(id, "game id")) ?? null
  };
}

/**
 * Shallow shape check for autosaves: the move tree and review are stored as
 * JSON and re-validated by the renderer when loaded, so only the fields the
 * repository reads directly are checked.
 */
export function parseSaveGameInput(value: unknown): SaveGameInput {
  const input = asObject(value, "game");
  if (!GAME_SOURCES.includes(input.source as GameSource)) fail("game", "unknown source");
  if (!Array.isArray(input.moveTree)) fail("game", "moveTree must be an array");
  const headers = parseGameHeaders(input.headers ?? {});
  if (input.review !== undefined && input.review !== null) asObject(input.review, "game review");
  asString(input.pgn, "PGN", MAX_PGN_BYTES);
  asString(input.rootFen, "root FEN", 128);
  asString(input.currentFen, "current FEN", 128);
  return {
    ...(input as SaveGameInput),
    id: nullable(input.id, (id) => asId(id, "game id")),
    headers,
    currentNodeId: nullable(input.currentNodeId, (id) => asId(id, "node id"))
  };
}

const HEADER_KEYS = [
  "event",
  "site",
  "date",
  "round",
  "white",
  "black",
  "whiteElo",
  "blackElo",
  "timeControl",
  "eco",
  "opening",
  "utcDate",
  "utcTime",
  "termination",
  "result"
] as const satisfies readonly (keyof GameHeaders)[];

/** Only the known headers, each a short string or null (they are stored as JSON). */
function parseGameHeaders(value: unknown): GameHeaders {
  const input = asObject(value, "game headers");
  const headers: GameHeaders = {};
  for (const key of HEADER_KEYS) {
    const parsed = nullable(input[key], (item) => asString(item, `${key} header`, MAX_HEADER));
    if (parsed !== undefined) headers[key] = parsed;
  }
  const orientation = input.orientationHint;
  if (orientation === "white" || orientation === "black" || orientation === null)
    headers.orientationHint = orientation;
  else if (orientation !== undefined) fail("orientation header", "expected white or black");
  return headers;
}

export function parsePgnText(value: unknown): string {
  return asString(asObject(value, "PGN import").pgn, "PGN", MAX_PGN_BYTES);
}

const SETTING_KEYS = new Set(Object.keys(defaultSettings));

export function parseSettingKey(value: unknown): keyof AppSettings {
  if (typeof value !== "string" || !SETTING_KEYS.has(value)) fail("setting", "unknown key");
  return value as keyof AppSettings;
}

/** Several settings at once (known keys only; at least one). */
export function parseSettingsPatch(value: unknown): Partial<Record<keyof AppSettings, unknown>> {
  const input = asObject(value, "settings");
  const keys = Object.keys(input);
  if (!keys.length || keys.length > SETTING_KEYS.size) fail("settings", "expected a few settings");
  const patch: Partial<Record<keyof AppSettings, unknown>> = {};
  for (const key of keys) {
    const settingKey = parseSettingKey(key);
    patch[settingKey] = parseSettingValue(settingKey, input[key]);
  }
  return patch;
}

export function parseDialogFilters(value: unknown): DialogFileFilter[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 16) fail("file filters", "expected a short array");
  return value.map((item, index) => {
    const filter = asObject(item, `file filter ${index}`);
    return {
      name: asString(filter.name, "file filter name", MAX_NAME),
      extensions: asStringArray(filter.extensions, "file filter extensions", 32, 16)
    };
  });
}

/** A bare file name for the save dialog's default (no directories). */
export function parseDefaultFileName(value: unknown): string {
  const name = asString(value, "file name", MAX_NAME).replace(/[\\/]/g, "_").trim();
  return name || "chaturanga-game.pgn";
}

export function parsePuzzleSampleInput(value: unknown): PuzzleSampleInput {
  const input = asObject(value, "puzzle filters");
  const result: PuzzleSampleInput = {
    databaseId: asId(input.databaseId, "database id"),
    excludeIds: optional(input.excludeIds, (ids) =>
      asStringArray(ids, "excluded puzzle ids", 10_000, MAX_ID)
    )
  };
  if (input.lichess !== undefined && input.lichess !== null) {
    const lichess = asObject(input.lichess, "lichess filters");
    const side = lichess.side === "white" || lichess.side === "black" ? lichess.side : "any";
    result.lichess = {
      ratingMin: asFilterNumber(lichess.ratingMin, "ratingMin"),
      ratingMax: asFilterNumber(lichess.ratingMax, "ratingMax"),
      popularityMin: asFilterNumber(lichess.popularityMin, "popularityMin"),
      lengths: asStringArray(lichess.lengths ?? [], "lengths", 64),
      themes: asStringArray(lichess.themes ?? [], "themes", 256),
      openings: asStringArray(lichess.openings ?? [], "openings", 1024),
      side
    };
  }
  if (input.position !== undefined && input.position !== null) {
    const position = asObject(input.position, "position filters");
    result.position = {
      difficultyMin: asFilterNumber(position.difficultyMin, "difficultyMin"),
      difficultyMax: asFilterNumber(position.difficultyMax, "difficultyMax"),
      tags: asStringArray(position.tags ?? [], "tags", 64)
    };
  }
  return result;
}

/** Lichess game and challenge ids: 8 characters (12 for a player's full game id). */
const LICHESS_ID = /^[A-Za-z0-9]{8,12}$/;
/** Lichess usernames: 2–30 letters, digits, `_` or `-` (older accounts may start or end with `_`). */
const LICHESS_USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

function asNumberInRange(value: unknown, label: string, min: number, max: number): number {
  const number = asFiniteNumber(value, label);
  if (number < min || number > max) fail(label, `must be between ${min} and ${max}`);
  return number;
}

function asIntegerInRange(value: unknown, label: string, min: number, max: number): number {
  const number = asNumberInRange(value, label, min, max);
  if (!Number.isInteger(number)) fail(label, "expected a whole number");
  return number;
}

function asChallengeColor(value: unknown): "white" | "black" | "random" {
  if (value !== "white" && value !== "black" && value !== "random")
    fail("color", "expected white, black or random");
  return value;
}

/** Path segments of Lichess URLs: ids are checked strictly, never passed through. */
export function asLichessId(value: unknown, label = "Lichess id"): string {
  const id = asString(value, label, 12);
  if (!LICHESS_ID.test(id)) fail(label, "not a Lichess id");
  return id;
}

export function asLichessUci(value: unknown): string {
  const uci = asString(value, "move", 5);
  if (!UCI_MOVE.test(uci)) fail("move", `"${uci}" is not a UCI move`);
  return uci;
}

export function parseLichessSeekInput(value: unknown): LichessSeekInput {
  const input = asObject(value, "seek");
  let ratingRange: [number, number] | null = null;
  if (input.ratingRange !== undefined && input.ratingRange !== null) {
    if (!Array.isArray(input.ratingRange) || input.ratingRange.length !== 2) {
      fail("rating range", "expected [min, max]");
    }
    const min = asIntegerInRange(input.ratingRange[0], "rating range min", 0, 4000);
    const max = asIntegerInRange(input.ratingRange[1], "rating range max", 0, 4000);
    if (min > max) fail("rating range", "min is above max");
    ratingRange = [min, max];
  }
  return {
    // Lichess seeks take fractional minutes (e.g. 1.5) up to 3 hours.
    minutes: asNumberInRange(input.minutes, "minutes", 0, 180),
    incrementSec: asIntegerInRange(input.incrementSec, "increment", 0, 180),
    rated: asBoolean(input.rated, "rated"),
    ratingRange
  };
}

/** Challenge clocks are whole seconds: up to 3 hours, increment up to 60 s. */
function parseChallengeClock(input: Fields): { minutes: number; incrementSec: number } {
  const minutes = asNumberInRange(input.minutes, "minutes", 0, 180);
  if (!Number.isInteger(minutes * 60)) fail("minutes", "must be whole seconds");
  return { minutes, incrementSec: asIntegerInRange(input.incrementSec, "increment", 0, 60) };
}

export function parseLichessChallengeInput(value: unknown): LichessChallengeInput {
  const input = asObject(value, "challenge");
  const username = asString(input.username, "username", 30).trim();
  if (!LICHESS_USERNAME.test(username)) fail("username", "not a Lichess username");
  return {
    username,
    ...parseChallengeClock(input),
    rated: asBoolean(input.rated, "rated"),
    color: asChallengeColor(input.color)
  };
}

export function parseLichessAiChallengeInput(value: unknown): LichessAiChallengeInput {
  const input = asObject(value, "AI challenge");
  return {
    level: asIntegerInRange(input.level, "AI level", 1, 8),
    ...parseChallengeClock(input),
    color: asChallengeColor(input.color)
  };
}

export function parseLichessDisconnectInput(value: unknown): { removeGames: boolean } {
  const input = asObject(value, "disconnect options");
  return { removeGames: asBoolean(input.removeGames, "removeGames") };
}

/* ------------------------------------------------------------------ repertoires */

const MAX_REPERTOIRE_TEXT = 5_000;
const MAX_POLICY_TEXT = 2_000;
const MAX_CHAPTER_NODES = 100_000;
const MAX_IMPORT_GAMES = 1_000;
const MAX_POSITION_KEY = 200;
/** Targeted practice ("Refresh this decision") names at most this many decisions. */
const MAX_TARGETED_KEYS = 200;

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
      tree: chapter.tree as MoveNode[],
      nodeMeta: asObject(chapter.nodeMeta ?? {}, "chapter nodeMeta") as Record<
        string,
        RepertoireNodeMeta
      >
    }
  };
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
        )
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
  if (
    input.mode !== "review-due" &&
    input.mode !== "learn-new" &&
    input.mode !== "rehearse-lines"
  ) {
    fail("practice mode", "expected review-due, learn-new or rehearse-lines");
  }
  const result: StartPracticeInput = {
    repertoireId: asId(input.repertoireId, "repertoireId"),
    mode: input.mode
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
