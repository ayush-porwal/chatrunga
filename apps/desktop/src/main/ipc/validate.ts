/**
 * Input validation for IPC handlers. The renderer is treated as untrusted:
 * every payload that reaches the file system, the database or an engine
 * process is checked here and rebuilt from known fields only.
 */
import { parseSettingWrite } from "./settings-values";
import { canonicalImagePath } from "../image-access";
import type {
  Color,
  GameHeaders,
  GameListQuery,
  MoveNode,
  SaveGameInput
} from "@chaturanga/shared/types/chess";
import { GAME_SEARCH_MAX_LENGTH } from "@chaturanga/shared/types/chess";
import { isGameSource, LIBRARY_TABS } from "@chaturanga/shared/types/library";
import {
  CHESSCOM_IMPORT_WINDOWS,
  CHESSCOM_USERNAME,
  type ChesscomConnectInput
} from "@chaturanga/shared/types/chesscom";
import type { PuzzleOfTheDayInput, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import type { RecordPuzzleAttemptInput } from "@chaturanga/shared/types/puzzle-rating";
import type {
  AnalysePositionsInput,
  CreateEngineInput,
  EngineGoClock,
  GameReview,
  ProbeEvalInput,
  ReviewGameInput,
  ReviewMoveInputItem,
  StartEngineGameInput,
  StartLiveAnalysisInput,
  UpdateEngineInput
} from "@chaturanga/shared/types/engine";
import { defaultSettings, isSettingKey, type AppSettings } from "@chaturanga/shared/types/settings";
import type { DialogFileFilter } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  LichessAiChallengeInput,
  LichessChallengeInput,
  LichessSeekInput,
  LichessSpeed
} from "@chaturanga/shared/types/lichess";
import type { ReviewRatingContext } from "@chaturanga/shared/chess/review-rating";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { clampMaia3Rating, nearestMaia3Rating } from "@chaturanga/shared/engine/maia3";
import {
  MAX_ID,
  MAX_PATH,
  MAX_NAME,
  MAX_HEADER,
  MAX_MOVES,
  MAX_PGN_BYTES,
  UCI_MOVE,
  type Fields,
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
  asAbsolutePath,
  asFen,
  asUciMoves,
  asNumberInRange,
  asIntegerInRange
} from "./fields";

const MAX_ARGS = 64;

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

/** A rating / popularity / difficulty filter bound. */
function asFilterNumber(value: unknown, label: string): number {
  const number = asFiniteNumber(value, label);
  if (number < -10_000 || number > 10_000) fail(label, "is out of range");
  return number;
}

function asOptionalPath(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  return asAbsolutePath(value, label);
}

/**
 * An engine picture: a file on this computer (copied into the app's data when the engine is saved,
 * see engine-images.ts), given as a path or a `file:` URL. Web and `data:` addresses are refused:
 * the packaged app's CSP never loads remote pictures, and nothing in the app writes `data:` ones.
 */
function asOptionalImagePath(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  const path = canonicalImagePath(asString(value, "engine image"));
  // A URL scheme (two letters or more: `C:` is a Windows drive).
  if (/^[a-z][a-z\d+.-]+:/i.test(path))
    fail("engine image", "choose a picture file on this computer (web addresses aren't supported)");
  return asAbsolutePath(path, "engine image");
}

function asEngineArgs(value: unknown): string[] {
  const args = asStringArray(value, "engine args", MAX_ARGS, MAX_PATH);
  if (args.some((arg) => arg.includes("\0"))) fail("engine args", "contains a NUL byte");
  return args;
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
  const imagePath = asOptionalImagePath(input.imagePath);
  if (imagePath !== undefined) fields.imagePath = imagePath;
  if (input.args !== undefined) fields.args = asEngineArgs(input.args);
  if (input.isDefault !== undefined) fields.isDefault = asBoolean(input.isDefault, "isDefault");
  if (input.isHumanPrediction !== undefined) {
    fields.isHumanPrediction = asBoolean(input.isHumanPrediction, "isHumanPrediction");
  }
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

/**
 * A game against Maia: Maia's rating snapped to its 600–2600 grid (what Play offers), the user's
 * clamped into that range but kept to the point (Maia reads any rating). Null when absent: a game
 * against the Maia row without ratings plays Maia at the default rating (maia/game-move.ts).
 */
function parseMaiaOpponent(value: unknown): StartEngineGameInput["maia"] {
  if (value === undefined || value === null) return null;
  const maia = asObject(value, "maia");
  return {
    rating: nearestMaia3Rating(asFiniteNumber(maia.rating, "maia.rating")),
    opponentRating: clampMaia3Rating(asFiniteNumber(maia.opponentRating, "maia.opponentRating"))
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
    clock: parseClock(input.clock),
    maia: parseMaiaOpponent(input.maia)
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
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs", SEARCH_LIMITS.moveTimeMs),
    fresh: optional(input.fresh, (fresh) => asBoolean(fresh, "fresh")) ?? false
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

const LICHESS_SPEEDS: readonly LichessSpeed[] = [
  "ultraBullet",
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence"
];

/** A game's own rating: a whole number a player could have (see chess/review-rating.ts). */
function asGameRating(value: unknown, label: string): number | null {
  if (value === null) return null;
  const rating = asWholeNumber(value, label);
  if (rating < 1 || rating > 4000) fail(label, "is out of range");
  return rating;
}

/** What main resolves a review's rating from: the reviewed side, the game's ratings and speed. */
function parseReviewRatingContext(value: unknown): ReviewRatingContext {
  const input = asObject(value, "review rating");
  const { side, speed } = input;
  return {
    side: side === "white" || side === "black" ? side : fail("review rating", "unknown side"),
    whiteElo: asGameRating(input.whiteElo ?? null, "white rating"),
    blackElo: asGameRating(input.blackElo ?? null, "black rating"),
    speed:
      speed === null || speed === undefined
        ? null
        : isOneOf(LICHESS_SPEEDS, speed)
          ? speed
          : fail("review rating", "unknown speed")
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
    // Omitted: the `reviewUseMaia` setting decides.
    useMaia: optional(input.useMaia, (use) => asBoolean(use, "useMaia")),
    timeControl: nullable(input.timeControl, (tc) => asString(tc, "time control", 64)),
    rating: nullable(input.rating, parseReviewRatingContext),
    rootFen: asFen(input.rootFen, "root FEN"),
    moves: input.moves.map(parseReviewMove),
    nodes: asOptionalPositive(input.nodes, "nodes", SEARCH_LIMITS.nodes, true),
    moveTimeMs: asOptionalPositive(input.moveTimeMs, "moveTimeMs"),
    depth: asOptionalPositive(input.depth, "depth", SEARCH_LIMITS.depth, true),
    multipv: asOptionalPositive(input.multipv, "multipv", SEARCH_LIMITS.multipv, true)
  };
}

/** A few positions at most: the puzzle explanation searches the start, and the wrong move's before and after. */
const MAX_ANALYSE_POSITIONS = 4;

export function parseAnalysePositionsInput(value: unknown): AnalysePositionsInput {
  const input = asObject(value, "position analysis");
  if (!Array.isArray(input.positions) || !input.positions.length)
    fail("position analysis", "positions must be a non-empty array");
  if (input.positions.length > MAX_ANALYSE_POSITIONS)
    fail("position analysis", "too many positions");
  // Clamped rather than refused, like a probe: one explanation never needs a minute per position.
  const moveTimeMs = Math.min(asOptionalPositive(input.moveTimeMs, "moveTimeMs") || 1000, 60_000);
  return {
    requestId: asId(input.requestId, "request id"),
    engineId: asId(input.engineId, "engine id"),
    moveTimeMs,
    positions: input.positions.map((raw: unknown, index: number) => {
      const position = asObject(raw, `position ${index}`);
      return {
        fen: asFen(position.fen, `position ${index} FEN`),
        multipv:
          asOptionalPositive(
            position.multipv,
            `position ${index} multipv`,
            SEARCH_LIMITS.multipv,
            true
          ) || 1
      };
    })
  };
}

/** A library page request (the repository clamps the limit). */
export function parseGameListQuery(value: unknown): GameListQuery {
  const input = value === undefined ? {} : asObject(value, "game list query");
  const cursor = nullable(input.cursor, (raw) => {
    const fields = asObject(raw, "game list cursor");
    return {
      updatedAt: asFiniteNumber(fields.updatedAt, "cursor time"),
      id: asId(fields.id, "cursor id")
    };
  });
  const tab = input.tab ?? null;
  if (tab !== null && !isOneOf(LIBRARY_TABS, tab)) fail("game list source", "unknown source");
  return {
    cursor: cursor ?? null,
    limit: optional(input.limit, (limit) => asWholeNumber(limit, "page size")),
    search: optional(input.search, (search) => asString(search, "search", GAME_SEARCH_MAX_LENGTH)),
    tab,
    reviewed: optional(input.reviewed, (reviewed) => asBoolean(reviewed, "reviewed")) ?? false,
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
  const source = input.source;
  if (!isGameSource(source)) fail("game", "unknown source");
  if (!Array.isArray(input.moveTree)) fail("game", "moveTree must be an array");
  const headers = parseGameHeaders(input.headers ?? {});
  if (input.review !== undefined && input.review !== null) asObject(input.review, "game review");
  return {
    id: nullable(input.id, (id) => asId(id, "game id")),
    source,
    headers,
    pgn: asString(input.pgn, "PGN", MAX_PGN_BYTES),
    rootFen: asString(input.rootFen, "root FEN", 128),
    currentFen: asString(input.currentFen, "current FEN", 128),
    currentNodeId: nullable(input.currentNodeId, (id) => asId(id, "node id")),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored as JSON and checked node by node when the game is loaded (repositories.ts), not on every autosave
    moveTree: input.moveTree as MoveNode[],
    ...(input.analysisBoard === undefined
      ? {}
      : { analysisBoard: asBoolean(input.analysisBoard, "analysisBoard") }),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored as JSON and checked when loaded, like the tree
    review: input.review as GameReview | null | undefined
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
  "result",
  "engineId"
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
  if (typeof value !== "string" || !isSettingKey(value)) fail("setting", "unknown key");
  return value;
}

/** Several settings at once (known keys only; at least one). */
export function parseSettingsPatch(value: unknown): Partial<Record<keyof AppSettings, unknown>> {
  const input = asObject(value, "settings");
  const keys = Object.keys(input);
  if (!keys.length || keys.length > SETTING_KEYS.size) fail("settings", "expected a few settings");
  const patch: Partial<Record<keyof AppSettings, unknown>> = {};
  for (const key of keys) {
    Object.assign(patch, parseSettingWrite(parseSettingKey(key), input[key]));
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
  const ids = optional(input.ids, (ids) => asStringArray(ids, "puzzle ids", 1000, MAX_ID));
  if (ids) result.ids = ids;
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

/** A calendar day, "YYYY-MM-DD", that exists (no 2026-02-30). */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parsePuzzleOfTheDayInput(value: unknown): PuzzleOfTheDayInput {
  const input = asObject(value, "puzzle of the day");
  const date = asString(input.date, "date", 10);
  const match = CALENDAR_DATE.exec(date);
  const [year, month, day] = match ? match.slice(1).map(Number) : [0, 0, 0];
  // Date.UTC rolls an impossible day over (2026-02-30 → March 2): a real day reads back the same.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    !match ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail("date", "expected a calendar day (YYYY-MM-DD)");
  }
  return { date };
}

/** A timestamp in ms (any time from 1970 to well past this century). */
function asTimestamp(value: unknown, label: string): number {
  return asIntegerInRange(value, label, 0, 8.64e15);
}

/** A decided puzzle attempt to record (and maybe rate). */
export function parseRecordPuzzleAttemptInput(value: unknown): RecordPuzzleAttemptInput {
  const input = asObject(value, "puzzle attempt");
  const outcome = input.outcome;
  if (outcome !== "solved" && outcome !== "failed")
    fail("puzzle outcome", "expected solved or failed");
  // Lichess puzzle ratings and deviations: anything a real puzzle has, with room to spare.
  const rating =
    nullable(input.puzzleRating, (rating) => asNumberInRange(rating, "puzzle rating", 0, 5000)) ??
    null;
  const deviation =
    nullable(input.puzzleRatingDeviation, (deviation) =>
      asNumberInRange(deviation, "puzzle rating deviation", 0, 1000)
    ) ?? null;
  return {
    attemptId: asId(input.attemptId, "attempt id"),
    puzzleId: asId(input.puzzleId, "puzzle id"),
    databaseId: asId(input.databaseId, "database id"),
    sourceId: asId(input.sourceId, "database source"),
    outcome,
    puzzleRating: rating,
    puzzleRatingDeviation: deviation,
    themes: asStringArray(input.themes ?? [], "puzzle themes", 64, 64),
    wrongMoveCount: asIntegerInRange(input.wrongMoveCount, "wrong move count", 0, MAX_MOVES),
    solutionViewed: asBoolean(input.solutionViewed, "solution viewed"),
    startedAt: asTimestamp(input.startedAt, "started at"),
    decidedAt: asTimestamp(input.decidedAt, "decided at"),
    completedAt: nullable(input.completedAt, (at) => asTimestamp(at, "completed at")) ?? null
  };
}

/** How many entries a puzzle statistics list returns (1–`max`, else `fallback`). */
export function parseListLimit(value: unknown, fallback: number, max: number): number {
  return value === undefined || value === null
    ? fallback
    : asIntegerInRange(value, "limit", 1, max);
}

/** Lichess game and challenge ids: 8 characters (12 for a player's full game id). */
const LICHESS_ID = /^[A-Za-z0-9]{8,12}$/;
/** Lichess usernames: 2–30 letters, digits, `_` or `-` (older accounts may start or end with `_`). */
const LICHESS_USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

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
  return {
    // Lichess seeks take fractional minutes (e.g. 1.5) up to 3 hours.
    minutes: asNumberInRange(input.minutes, "minutes", 0, 180),
    incrementSec: asIntegerInRange(input.incrementSec, "increment", 0, 180),
    rated: asBoolean(input.rated, "rated")
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

/** Disconnecting an account (Lichess, Chess.com): whether its imported games go too. */
export function parseDisconnectInput(value: unknown): { removeGames: boolean } {
  const input = asObject(value, "disconnect options");
  return { removeGames: asBoolean(input.removeGames, "removeGames") };
}

/* ------------------------------------------------------------------ chess.com */

export function parseChesscomConnectInput(value: unknown): ChesscomConnectInput {
  const input = asObject(value, "chess.com account");
  const username = asString(input.username, "chess.com username", 100).trim();
  if (!CHESSCOM_USERNAME.test(username))
    fail("chess.com username", "letters, digits, _ and - only");
  const firstImport = input.firstImport;
  if (!isOneOf(CHESSCOM_IMPORT_WINDOWS, firstImport))
    fail("first import", "expected 3months, year or all");
  return { username, firstImport };
}
