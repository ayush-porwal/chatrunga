/**
 * Input validation for IPC handlers. The renderer is treated as untrusted:
 * every payload that reaches the file system, the database or an engine
 * process is checked here and rebuilt from known fields only.
 */
import { isAbsolute } from "node:path";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import type { GameHeaders, GameSource, SaveGameInput } from "@chaturanga/shared/types/chess";
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
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "expected an object");
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

/** A positive number, or null/undefined when absent (search bounds such as depth or movetime). */
function asOptionalPositive(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  const number = asFiniteNumber(value, label);
  if (number < 0) fail(label, "must not be negative");
  return number;
}

function asStringArray(value: unknown, label: string, maxItems: number, maxLength = MAX_NAME): string[] {
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
  if (input.name !== undefined) fields.name = asString(input.name, "engine name", MAX_NAME).trim() || "UCI Engine";
  if (input.executablePath !== undefined) fields.executablePath = asAbsolutePath(input.executablePath, "executable path");
  const workingDirectory = asOptionalPath(input.workingDirectory, "working directory");
  if (workingDirectory !== undefined) fields.workingDirectory = workingDirectory;
  const weightsPath = asOptionalPath(input.weightsPath, "weights path");
  if (weightsPath !== undefined) fields.weightsPath = weightsPath;
  // Display-only: a local file or an http(s)/data URL (see renderer `localImageSrc`).
  const imagePath = nullable(input.imagePath, (path) => asString(path, "image path").trim() || null);
  if (imagePath !== undefined) fields.imagePath = imagePath;
  if (input.args !== undefined) fields.args = asEngineArgs(input.args);
  if (input.isDefault !== undefined) fields.isDefault = asBoolean(input.isDefault, "isDefault");
  if (input.isHumanPrediction !== undefined) {
    fields.isHumanPrediction = asBoolean(input.isHumanPrediction, "isHumanPrediction");
  }
  if (input.maiaRating !== undefined && input.maiaRating !== null) fields.maiaRating = asMaiaRating(input.maiaRating);
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
  const side = input.side === "black" ? "black" : "white";
  return {
    engineId: asId(input.engineId, "engine id"),
    searchId: asId(input.searchId, "search id"),
    side,
    fen: asFen(input.fen),
    moves: asUciMoves(input.moves ?? []),
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs"),
    depth: asOptionalPositive(input.depth, "depth"),
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
    multipv: asOptionalPositive(input.multipv, "multipv")
  };
}

export function parseProbeEvalInput(value: unknown): ProbeEvalInput {
  const input = asObject(value, "evaluation probe");
  return {
    engineId: asId(input.engineId, "engine id"),
    fen: asFen(input.fen),
    moves: asUciMoves(input.moves ?? []),
    movetimeMs: Math.min(asOptionalPositive(input.movetimeMs, "movetimeMs") || 400, 60_000)
  };
}

function parseReviewMove(value: unknown, index: number): ReviewMoveInputItem {
  const label = `review move ${index}`;
  const move = asObject(value, label);
  const uci = asString(move.uci, `${label} uci`, 5);
  if (!UCI_MOVE.test(uci)) fail(label, `"${uci}" is not a UCI move`);
  return {
    nodeId: asId(move.nodeId, `${label} node id`),
    ply: asFiniteNumber(move.ply, `${label} ply`),
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
    reviewId: input.reviewId === undefined ? `review-${Date.now()}` : asId(input.reviewId, "review id"),
    engineId: asId(input.engineId, "engine id"),
    predictionEngineIds: optional(input.predictionEngineIds, (ids) =>
      asStringArray(ids, "prediction engine ids", 32, MAX_ID).filter(Boolean)
    ),
    timeControl: nullable(input.timeControl, (tc) => asString(tc, "time control", 64)),
    rootFen: asFen(input.rootFen, "root FEN"),
    moves: input.moves.map(parseReviewMove),
    nodes: asOptionalPositive(input.nodes, "nodes"),
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs"),
    depth: asOptionalPositive(input.depth, "depth"),
    multipv: asOptionalPositive(input.multipv, "multipv")
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
  if (orientation === "white" || orientation === "black" || orientation === null) headers.orientationHint = orientation;
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
    excludeIds: optional(input.excludeIds, (ids) => asStringArray(ids, "excluded puzzle ids", 10_000, MAX_ID))
  };
  if (input.lichess !== undefined && input.lichess !== null) {
    const lichess = asObject(input.lichess, "lichess filters");
    const side = lichess.side === "white" || lichess.side === "black" ? lichess.side : "any";
    result.lichess = {
      ratingMin: asFiniteNumber(lichess.ratingMin, "ratingMin"),
      ratingMax: asFiniteNumber(lichess.ratingMax, "ratingMax"),
      popularityMin: asFiniteNumber(lichess.popularityMin, "popularityMin"),
      lengths: asStringArray(lichess.lengths ?? [], "lengths", 64),
      themes: asStringArray(lichess.themes ?? [], "themes", 256),
      openings: asStringArray(lichess.openings ?? [], "openings", 1024),
      side
    };
  }
  if (input.position !== undefined && input.position !== null) {
    const position = asObject(input.position, "position filters");
    result.position = {
      difficultyMin: asFiniteNumber(position.difficultyMin, "difficultyMin"),
      difficultyMax: asFiniteNumber(position.difficultyMax, "difficultyMax"),
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
  if (value !== "white" && value !== "black" && value !== "random") fail("color", "expected white, black or random");
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
