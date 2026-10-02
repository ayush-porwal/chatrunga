import { nanoid } from "nanoid";
import type { SQLInputValue } from "node:sqlite";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { getDb } from "./index";
import { gameFingerprint } from "./game-fingerprint";
import { reviewListingFields, reviewRowId, toSavedReviewInfo, type GameReviewRow } from "./review-rows";
import {
  defaultSettings,
  hydratePieceSettings,
  normalizeAppearanceSettings,
  normalizeOnboardingSettings,
  normalizeReviewEngineSettings,
  normalizeUpdateSettings,
  type AppSettings
} from "@chaturanga/shared/types/settings";
import type {
  CreateEngineInput,
  EngineConfig,
  GameReview,
  MaiaRating,
  UpdateEngineInput
} from "@chaturanga/shared/types/engine";
import type {
  GameHeaders,
  GameSource,
  GameSummary,
  MoveNode,
  SavedGame,
  SaveGameInput
} from "@chaturanga/shared/types/chess";
import type {
  ExternalDatabaseFormat,
  ExternalDatabaseKind,
  ExternalDatabaseSource,
  InstalledDatabase
} from "@chaturanga/shared/types/database";
import { MAIA_RATINGS, maiaRatingFromText } from "../engine/review-analysis";

type EngineRow = {
  id: string;
  name: string;
  executable_path: string;
  working_directory: string | null;
  weights_path: string | null;
  image_path: string | null;
  args: string | null;
  protocol: string;
  is_default: number;
  is_human_prediction: number | null;
  maia_rating: number | null;
  created_at: number;
  updated_at: number;
};

type GameRow = {
  id: string;
  source: string;
  white: string | null;
  black: string | null;
  event: string | null;
  site: string | null;
  round: string | null;
  result: string | null;
  date: string | null;
  initial_fen: string | null;
  pgn: string;
  current_fen: string;
  current_node_id: string | null;
  headers_json: string | null;
  move_tree_json: string;
  review_json: string | null;
  created_at: number;
  updated_at: number;
};

type GameSummaryRow = Pick<
  GameRow,
  "id" | "source" | "white" | "black" | "event" | "result" | "date" | "current_fen" | "updated_at"
> & { review_count?: number | null; last_reviewed_at?: number | null };

/** A game's analyses as listed (newest first), without their JSON. */
type ReviewListingRow = Omit<GameReviewRow, "game_id" | "review_json">;

const REVIEW_LISTING_COLUMNS =
  "review_id, created_at, engine_name, move_time_ms, depth, maia_levels_json, move_count, commentary_count";

/** Per-game analysis count and newest date, for summaries. */
const REVIEW_COUNTS_SQL = `(SELECT COUNT(*) FROM game_reviews r WHERE r.game_id = games.id) AS review_count,
  (SELECT MAX(r.created_at) FROM game_reviews r WHERE r.game_id = games.id) AS last_reviewed_at`;

type SettingRow = {
  key: string;
  value: string;
};

type ExternalDatabaseRow = {
  id: string;
  source_id: string;
  name: string;
  provider: string;
  kind: string;
  format: string;
  file_path: string;
  file_size_bytes: number;
  record_count: number | null;
  source_url: string;
  page_url: string;
  license: string;
  downloaded_at: number;
  updated_at: number;
};

const now = () => Date.now();

function parseArgs(args: string | null): string[] {
  if (!args) return [];
  try {
    const parsed = JSON.parse(args);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

function get<T>(sql: string, ...params: SQLInputValue[]): T | null {
  return (getDb().prepare(sql).get(...params) as T | undefined) ?? null;
}

/** Runs `work` as one transaction: all of its writes land, or none do. */
function transaction<T>(work: () => T): T {
  const db = getDb();
  if (db.isTransaction) return work();
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function run(sql: string, ...params: SQLInputValue[]): void {
  getDb().prepare(sql).run(...params);
}

/** Explicit rating column, else a `maia-1500`-style engine name / weights file. */
function inferMaiaRating(row: EngineRow): MaiaRating | undefined {
  if (MAIA_RATINGS.includes(row.maia_rating as MaiaRating)) return row.maia_rating as MaiaRating;
  return maiaRatingFromText(`${row.name} ${row.weights_path ?? ""}`);
}

function toEngine(row: EngineRow): EngineConfig {
  return {
    id: row.id,
    name: row.name,
    executablePath: row.executable_path,
    workingDirectory: row.working_directory,
    weightsPath: row.weights_path ?? null,
    imagePath: row.image_path ?? null,
    args: parseArgs(row.args),
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: Boolean(row.is_default),
    isHumanPrediction: Boolean(row.is_human_prediction),
    maiaRating: inferMaiaRating(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toGameSummary(row: GameSummaryRow): GameSummary {
  return {
    id: row.id,
    source: row.source as GameSummary["source"],
    white: row.white,
    black: row.black,
    event: row.event,
    result: row.result,
    date: row.date,
    currentFen: row.current_fen,
    updatedAt: row.updated_at,
    reviewCount: row.review_count ?? 0,
    lastReviewedAt: row.last_reviewed_at ?? null
  };
}

/**
 * The stored move tree. A damaged one is rebuilt from the row's PGN; if that fails too, opening
 * the game fails, rather than showing an empty board that autosave would then write over the
 * stored PGN (the only copy left of the moves).
 */
function parseMoveTree(row: GameRow): { moveTree: MoveNode[]; rebuilt: boolean } {
  try {
    const parsed: unknown = JSON.parse(row.move_tree_json);
    if (Array.isArray(parsed) && isConsistentTree(parsed)) return { moveTree: parsed, rebuilt: false };
  } catch {
    // Fall through to the PGN.
  }
  try {
    // Strict: a PGN with a move that can't be played would rebuild only part of the game.
    return { moveTree: importPgnText(row.pgn, { strict: true }).game.moveTree, rebuilt: true };
  } catch {
    throw new Error("This saved game is damaged and can't be opened.");
  }
}

/**
 * A review saved with a tree that had to be rebuilt: its moves point at the old node ids, so they
 * are moved onto the rebuilt main line by ply (the position after each move must match). A review
 * that doesn't fit the rebuilt game is dropped rather than shown against the wrong moves.
 */
export function remapReviewToTree(review: GameReview, moveTree: readonly MoveNode[]): GameReview | null {
  // By the node's own ply (absolute: a game from a set-up position starts past 0), not the index.
  const byPly = new Map(mainlineOf(moveTree).map((node) => [node.ply, node]));
  const moves = [];
  for (const move of review.moves as unknown[]) {
    // A damaged entry drops the review (it can't be placed), never the game.
    if (!move || typeof move !== "object") return null;
    const { ply, fenAfter } = move as Partial<GameReview["moves"][number]>;
    if (!Number.isInteger(ply) || typeof fenAfter !== "string") return null;
    const target = byPly.get(ply as number);
    if (!target || target.fenAfter !== fenAfter) return null;
    moves.push({ ...(move as GameReview["moves"][number]), nodeId: target.id });
  }
  return { ...review, moves };
}

/** Root, then the first child at every step. */
function mainlineOf(moveTree: readonly MoveNode[]): MoveNode[] {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const line: MoveNode[] = [];
  let node = moveTree.find((item) => item.parentId === null);
  while (node) {
    line.push(node);
    node = node.children[0] ? byId.get(node.children[0]) : undefined;
  }
  return line;
}

/**
 * The cursor in a tree rebuilt from the PGN: the old node id is gone, and which occurrence of a
 * repeated position it was can't be told from a damaged tree. The main-line node showing the saved
 * position (its last occurrence), else the end of the main line.
 */
export function rebuiltCursor(moveTree: readonly MoveNode[], currentFen: string): string | null {
  const line = mainlineOf(moveTree);
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index].fenAfter === currentFen) return line[index].id;
  }
  return line.at(-1)?.id ?? null;
}

/** The root's id in every tree the app builds (createEmptyGame, importPgnText). */
const ROOT_NODE_ID = "root";

const isString = (value: unknown): value is string => typeof value === "string";
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** Every field a move node needs, with its type. Only the root has no move (san/uci null). */
const SQUARE = /^[a-h][1-8]$/;
const ANNOTATION_COLORS: readonly unknown[] = ["green", "red", "yellow", "blue"];

function isArrow(value: unknown): boolean {
  const arrow = value as Record<string, unknown> | null;
  return Boolean(
    arrow && typeof arrow === "object" && SQUARE.test(String(arrow.orig)) && SQUARE.test(String(arrow.dest)) && ANNOTATION_COLORS.includes(arrow.color)
  );
}

function isHighlight(value: unknown): boolean {
  const highlight = value as Record<string, unknown> | null;
  return Boolean(highlight && typeof highlight === "object" && SQUARE.test(String(highlight.square)) && ANNOTATION_COLORS.includes(highlight.color));
}

/** A position the board can show (the board and move list read it as soon as the node is selected). */
function isPlayableFen(fen: unknown, checked: Map<string, boolean>): boolean {
  if (typeof fen !== "string") return false;
  let ok = checked.get(fen);
  if (ok === undefined) {
    try {
      positionFromFen(fen);
      ok = true;
    } catch {
      ok = false;
    }
    checked.set(fen, ok);
  }
  return ok;
}

function isMoveNodeLike(value: unknown, fens: Map<string, boolean> = new Map()): value is MoveNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<keyof MoveNode, unknown>;
  const root = node.id === ROOT_NODE_ID;
  return (
    isString(node.id) &&
    (root ? node.parentId === null : isString(node.parentId)) &&
    (root ? isStringOrNull(node.san) && isStringOrNull(node.uci) : isString(node.san) && isString(node.uci)) &&
    isPlayableFen(node.fenBefore, fens) &&
    isPlayableFen(node.fenAfter, fens) &&
    Number.isInteger(node.ply) &&
    Array.isArray(node.nags) &&
    node.nags.every(isString) &&
    isStringOrNull(node.comment) &&
    (node.clockAfter === undefined || isStringOrNull(node.clockAfter)) &&
    Array.isArray(node.arrows) &&
    node.arrows.every(isArrow) &&
    Array.isArray(node.highlights) &&
    node.highlights.every(isHighlight) &&
    Array.isArray(node.children) &&
    node.children.every(isString)
  );
}

/**
 * A tree the app can use as it is: well-formed nodes with unique ids, the canonical root, and every
 * node reached from it exactly once by following children whose parent links point back — so no
 * duplicate child, cycle or stray node, and walks up through parents always end at the root.
 */
export function isConsistentTree(nodes: readonly unknown[]): nodes is MoveNode[] {
  // FENs repeat (each node's fenBefore is its parent's fenAfter): each is parsed once.
  const fens = new Map<string, boolean>();
  if (!nodes.every((node) => isMoveNodeLike(node, fens))) return false;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get(ROOT_NODE_ID);
  if (!root || byId.size !== nodes.length) return false;
  const reached = new Set([root.id]);
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (!child || child.parentId !== node.id || reached.has(childId)) return false;
      reached.add(childId);
      pending.push(child);
    }
  }
  return reached.size === nodes.length;
}

/**
 * Stored headers the renderer can use: every value a string or null (orientationHint a colour).
 * Anything else drops the whole set, and opening falls back to the headers in the row's PGN.
 */
function isHeaders(value: unknown): value is GameHeaders {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    key === "orientationHint" ? item === null || item === "white" || item === "black" : isStringOrNull(item)
  );
}

/**
 * A stored analysis as the renderer can use it: placed on the game's tree (rebuilt trees remap),
 * or null when it can't be read or doesn't fit the game.
 */
function parseStoredReview(json: string, moveTree: readonly MoveNode[], rebuilt: boolean): GameReview | null {
  let review: GameReview | null = null;
  try {
    const parsed = JSON.parse(json) as GameReview;
    // Reviews saved before real Maia policy was parsed have no schemaVersion;
    // mark them v1 so consumers ignore their (uniform) Maia probabilities.
    if (parsed && Array.isArray(parsed.moves)) review = { ...parsed, schemaVersion: parsed.schemaVersion ?? 1 };
  } catch {
    review = null;
  }
  return review && rebuilt ? remapReviewToTree(review, moveTree) : review;
}

function toSavedGame(row: GameRow): SavedGame {
  const { moveTree, rebuilt } = parseMoveTree(row);

  // Every analysis, newest first; the newest one loads with the game, the others on demand.
  const listed = all<ReviewListingRow>(
    `SELECT ${REVIEW_LISTING_COLUMNS} FROM game_reviews WHERE game_id = ? ORDER BY created_at DESC, review_id`,
    row.id
  );
  const newest = listed[0]
    ? get<{ review_json: string }>("SELECT review_json FROM game_reviews WHERE review_id = ?", listed[0].review_id)
    : undefined;
  const review = newest ? parseStoredReview(newest.review_json, moveTree, rebuilt) : null;

  let headers: GameHeaders | null = null;
  if (row.headers_json) {
    try {
      const parsed: unknown = JSON.parse(row.headers_json);
      if (isHeaders(parsed)) headers = parsed;
    } catch {
      headers = null;
    }
  }

  return {
    ...toGameSummary(row),
    currentNodeId: rebuilt ? rebuiltCursor(moveTree, row.current_fen) : row.current_node_id,
    headers,
    site: row.site,
    round: row.round,
    initialFen: row.initial_fen,
    pgn: row.pgn,
    moveTree,
    review,
    reviews: listed.map(toSavedReviewInfo),
    reviewCount: listed.length,
    lastReviewedAt: listed[0]?.created_at ?? null
  };
}

function toInstalledDatabase(row: ExternalDatabaseRow): InstalledDatabase {
  return {
    id: row.id,
    sourceId: row.source_id,
    name: row.name,
    provider: row.provider,
    kind: row.kind as ExternalDatabaseKind,
    format: row.format as ExternalDatabaseFormat,
    filePath: row.file_path,
    fileSizeBytes: row.file_size_bytes,
    recordCount: row.record_count,
    sourceUrl: row.source_url,
    pageUrl: row.page_url,
    license: row.license,
    downloadedAt: row.downloaded_at,
    updatedAt: row.updated_at
  };
}

export const engineRepository = {
  list(): EngineConfig[] {
    return all<EngineRow>("SELECT * FROM engines ORDER BY updated_at DESC").map(toEngine);
  },

  get(id: string): EngineConfig | null {
    const row = get<EngineRow>("SELECT * FROM engines WHERE id = ?", id);
    return row ? toEngine(row) : null;
  },

  create(input: CreateEngineInput): EngineConfig {
    const timestamp = now();
    const row = {
      id: nanoid(),
      name: input.name.trim() || "UCI Engine",
      executablePath: input.executablePath,
      workingDirectory: input.workingDirectory || null,
      weightsPath: input.weightsPath?.trim() || null,
      imagePath: input.imagePath?.trim() || null,
      args: JSON.stringify(input.args ?? []),
      protocol: "uci",
      isDefault: input.isDefault ?? this.list().length === 0,
      isHumanPrediction: input.isHumanPrediction ?? false,
      maiaRating: input.maiaRating ?? null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // One default engine at a time: moving the flag is a single change (see migration 3).
    transaction(() => {
      if (row.isDefault) this.clearDefault();
      run(
        `INSERT INTO engines (
          id, name, executable_path, working_directory, weights_path, image_path, args, protocol,
          is_default, is_enabled, is_human_prediction, maia_rating, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.name,
        row.executablePath,
        row.workingDirectory,
        row.weightsPath,
        row.imagePath,
        row.args,
        row.protocol,
        row.isDefault ? 1 : 0,
        1, // is_enabled: unused legacy NOT NULL column
        row.isHumanPrediction ? 1 : 0,
        row.maiaRating,
        row.createdAt,
        row.updatedAt
      );
    });
    return this.get(row.id)!;
  },

  update(id: string, patch: UpdateEngineInput): EngineConfig {
    const existing = this.get(id);
    if (!existing) throw new Error("Engine not found");
    transaction(() => {
      if (patch.isDefault) this.clearDefault();

      run(
        `UPDATE engines SET
          name = ?,
          executable_path = ?,
          working_directory = ?,
          weights_path = ?,
          image_path = ?,
          args = ?,
          is_default = ?,
          is_human_prediction = ?,
          maia_rating = ?,
          updated_at = ?
        WHERE id = ?`,
        patch.name === undefined ? existing.name : patch.name,
        patch.executablePath === undefined ? existing.executablePath : patch.executablePath,
        patch.workingDirectory === undefined ? existing.workingDirectory : patch.workingDirectory,
        patch.weightsPath === undefined
          ? existing.weightsPath
          : patch.weightsPath
            ? patch.weightsPath.trim()
            : null,
        patch.imagePath === undefined
          ? existing.imagePath
          : patch.imagePath
            ? patch.imagePath.trim()
            : null,
        patch.args === undefined ? JSON.stringify(existing.args) : JSON.stringify(patch.args),
        (patch.isDefault === undefined ? existing.isDefault : patch.isDefault) ? 1 : 0,
        (patch.isHumanPrediction === undefined
          ? existing.isHumanPrediction
          : patch.isHumanPrediction)
          ? 1
          : 0,
        patch.maiaRating === undefined ? existing.maiaRating ?? null : patch.maiaRating,
        now(),
        id
      );
    });

    const updated = this.get(id);
    if (!updated) throw new Error("Engine not found after update");
    return updated;
  },

  remove(id: string): void {
    run("DELETE FROM engines WHERE id = ?", id);
  },

  clearDefault(): void {
    run("UPDATE engines SET is_default = 0");
  }
};

function upsertGame(input: SaveGameInput, timestamp: number): SavedGame {
  const id = input.id || nanoid();
  const existing = get<{ created_at: number }>("SELECT created_at FROM games WHERE id = ?", id);
  const createdAt = existing?.created_at ?? timestamp;
  const fingerprint = gameFingerprint({ headers: input.headers, rootFen: input.rootFen, moveTree: input.moveTree });

  const requestedNode = input.moveTree.find((node) => node.id === input.currentNodeId);
  const currentNodeId =
    requestedNode?.id ??
    input.moveTree.find((node) => node.fenAfter === input.currentFen)?.id ??
    input.moveTree.find((node) => node.parentId === null)?.id ??
    "root";

  run(
    `INSERT INTO games (
      id, source, white, black, event, site, round, result, date,
      initial_fen, pgn, current_fen, current_node_id, headers_json, move_tree_json, fingerprint,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source = excluded.source,
      white = excluded.white,
      black = excluded.black,
      event = excluded.event,
      site = excluded.site,
      round = excluded.round,
      result = excluded.result,
      date = excluded.date,
      initial_fen = excluded.initial_fen,
      pgn = excluded.pgn,
      current_fen = excluded.current_fen,
      current_node_id = excluded.current_node_id,
      headers_json = excluded.headers_json,
      move_tree_json = excluded.move_tree_json,
      fingerprint = excluded.fingerprint,
      updated_at = excluded.updated_at`,
    id,
    input.source,
    input.headers.white ?? null,
    input.headers.black ?? null,
    input.headers.event ?? null,
    input.headers.site ?? null,
    input.headers.round ?? null,
    input.headers.result ?? "*",
    input.headers.date ?? null,
    input.rootFen,
    input.pgn,
    input.currentFen,
    currentNodeId,
    JSON.stringify(input.headers),
    JSON.stringify(input.moveTree),
    fingerprint,
    createdAt,
    timestamp
  );
  if (input.review) saveReview(id, input.review);

  const saved = gameRepository.get(id);
  if (!saved) throw new Error("Failed to save game");
  return saved;
}

/**
 * The analysis on the board, saved under its own id: a new one is added (re-analysing keeps the
 * earlier ones), and one already saved is updated (its AI commentary grows as moves are viewed).
 */
function saveReview(gameId: string, review: GameReview): void {
  const reviewId = reviewRowId(review, gameId);
  const fields = reviewListingFields(review);
  run(
    `INSERT INTO game_reviews (
      review_id, game_id, created_at, engine_name, move_time_ms, depth, maia_levels_json, move_count, commentary_count, review_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(review_id) DO UPDATE SET
      engine_name = excluded.engine_name,
      move_time_ms = excluded.move_time_ms,
      depth = excluded.depth,
      maia_levels_json = excluded.maia_levels_json,
      move_count = excluded.move_count,
      commentary_count = excluded.commentary_count,
      review_json = excluded.review_json
    WHERE game_reviews.game_id = excluded.game_id`,
    reviewId,
    gameId,
    fields.created_at,
    fields.engine_name,
    fields.move_time_ms,
    fields.depth,
    fields.maia_levels_json,
    fields.move_count,
    fields.commentary_count,
    JSON.stringify({ ...review, reviewId })
  );
}

export const gameRepository = {
  /** Library summaries, newest first (served by games_recent_idx; no PGN, tree or review read). */
  list(): GameSummary[] {
    // Puzzle sessions are never library games (see the cleanup in db/index.ts).
    return all<GameSummaryRow>(
      `SELECT id, source, white, black, event, result, date, current_fen, updated_at, ${REVIEW_COUNTS_SQL}
      FROM games WHERE source != 'puzzle' ORDER BY updated_at DESC, id`
    ).map(toGameSummary);
  },

  /** One saved analysis of a game, placed on its tree (null when it's gone or doesn't fit). */
  getReview(gameId: string, reviewId: string): GameReview | null {
    const row = get<GameRow>("SELECT * FROM games WHERE id = ?", gameId);
    const stored = get<{ review_json: string }>(
      "SELECT review_json FROM game_reviews WHERE game_id = ? AND review_id = ?",
      gameId,
      reviewId
    );
    if (!row || !stored) return null;
    const { moveTree, rebuilt } = parseMoveTree(row);
    return parseStoredReview(stored.review_json, moveTree, rebuilt);
  },

  /** A library game that is the same game (see gameFingerprint), if any. */
  findIdByFingerprint(fingerprint: string): string | null {
    return (
      get<{ id: string }>(
        "SELECT id FROM games WHERE fingerprint = ? AND source != 'puzzle' ORDER BY updated_at DESC LIMIT 1",
        fingerprint
      )?.id ?? null
    );
  },

  count(): number {
    return get<{ total: number }>("SELECT COUNT(*) AS total FROM games WHERE source != 'puzzle'")?.total ?? 0;
  },

  /** Ids of the games from one source (e.g. Lichess imports). */
  idsBySource(source: GameSource): string[] {
    return all<{ id: string }>("SELECT id FROM games WHERE source = ?", source).map((row) => row.id);
  },

  get(id: string): SavedGame | null {
    const row = get<GameRow>("SELECT * FROM games WHERE id = ?", id);
    return row ? toSavedGame(row) : null;
  },

  save(input: SaveGameInput): SavedGame {
    return upsertGame(input, now());
  },

  /**
   * An imported game (Lichess), dated when it was played rather than now, so the library (sorted
   * by `updated_at`) lists imports by play date.
   */
  saveImported(input: SaveGameInput, playedAt: number): SavedGame {
    return upsertGame(input, playedAt);
  },

  /** The game imported from `site` (e.g. a Lichess game URL), if any. */
  findIdBySite(site: string): string | null {
    return get<{ id: string }>("SELECT id FROM games WHERE site = ? LIMIT 1", site)?.id ?? null;
  },

  /** Deletes every game from one source (e.g. Lichess imports on disconnect); returns the count. */
  removeBySource(source: GameSource): number {
    return Number(getDb().prepare("DELETE FROM games WHERE source = ?").run(source).changes);
  },

  /**
   * Permanently removes the game and everything saved with it: its row (PGN, move tree, headers)
   * and, through the foreign key, every analysis of it in game_reviews.
   */
  remove(id: string): void {
    run("DELETE FROM games WHERE id = ?", id);
  }
};

export const settingsRepository = {
  getAll(): AppSettings {
    const rows = all<SettingRow>("SELECT key, value FROM settings");
    const values: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        values[row.key] = JSON.parse(row.value);
      } catch {
        values[row.key] = row.value;
      }
    }
    const merged = { ...defaultSettings, ...values } as AppSettings;
    return normalizeOnboardingSettings(
      normalizeUpdateSettings(normalizeAppearanceSettings(normalizeReviewEngineSettings(hydratePieceSettings(merged))))
    );
  },

  /** Keys that have a stored row (whatever their value). */
  storedKeys(): string[] {
    return all<Pick<SettingRow, "key">>("SELECT key FROM settings").map((row) => row.key);
  },

  /** The raw persisted value (before defaults/normalization), or undefined when never set. */
  getStored(key: keyof AppSettings): unknown {
    const row = get<SettingRow>("SELECT key, value FROM settings WHERE key = ?", key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },

  /** Several settings in one transaction: all of them are stored, or none (a theme and its colors). */
  setMany(patch: Partial<Record<keyof AppSettings, unknown>>): void {
    const db = getDb();
    db.exec("BEGIN");
    try {
      for (const [key, value] of Object.entries(patch)) this.set(key as keyof AppSettings, value);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  set(key: keyof AppSettings, value: unknown): void {
    run(
      `INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      now()
    );
  }
};

export const externalDatabaseRepository = {
  list(): InstalledDatabase[] {
    return all<ExternalDatabaseRow>(
      "SELECT * FROM external_databases ORDER BY downloaded_at DESC"
    ).map(toInstalledDatabase);
  },

  get(id: string): InstalledDatabase | null {
    const row = get<ExternalDatabaseRow>("SELECT * FROM external_databases WHERE id = ?", id);
    return row ? toInstalledDatabase(row) : null;
  },

  getBySource(sourceId: string): InstalledDatabase | null {
    const row = get<ExternalDatabaseRow>(
      "SELECT * FROM external_databases WHERE source_id = ?",
      sourceId
    );
    return row ? toInstalledDatabase(row) : null;
  },

  saveDownloaded(input: {
    source: ExternalDatabaseSource;
    filePath: string;
    fileSizeBytes: number;
    recordCount?: number | null;
  }): InstalledDatabase {
    const timestamp = now();
    const existing = this.getBySource(input.source.id);
    const id = existing?.id ?? nanoid();
    const downloadedAt = existing?.downloadedAt ?? timestamp;
    run(
      `INSERT INTO external_databases (
        id, source_id, name, provider, kind, format, file_path, file_size_bytes, record_count,
        source_url, page_url, license, downloaded_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        name = excluded.name,
        provider = excluded.provider,
        kind = excluded.kind,
        format = excluded.format,
        file_path = excluded.file_path,
        file_size_bytes = excluded.file_size_bytes,
        record_count = excluded.record_count,
        source_url = excluded.source_url,
        page_url = excluded.page_url,
        license = excluded.license,
        updated_at = excluded.updated_at`,
      id,
      input.source.id,
      input.source.name,
      input.source.provider,
      input.source.kind,
      input.source.format,
      input.filePath,
      input.fileSizeBytes,
      input.recordCount ?? input.source.expectedRecords ?? null,
      input.source.url,
      input.source.pageUrl,
      input.source.license,
      downloadedAt,
      timestamp
    );
    const saved = this.get(id) ?? this.getBySource(input.source.id);
    if (!saved) throw new Error("Failed to save database metadata");
    return saved;
  },

  remove(id: string): void {
    run("DELETE FROM external_databases WHERE id = ?", id);
  },

  /** The file moved (see dataset-location.ts). */
  updateFilePath(id: string, filePath: string): void {
    run("UPDATE external_databases SET file_path = ? WHERE id = ?", filePath, id);
  }
};
