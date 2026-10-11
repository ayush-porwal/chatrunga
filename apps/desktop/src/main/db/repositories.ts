import { nanoid } from "nanoid";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { withCurrentAssessments } from "@chaturanga/shared/chess/move-assessment";
import { openingBook } from "../engine/opening-book";
import { getDb } from "./index";
import { gameFingerprint } from "./game-fingerprint";
import {
  reviewListingFields,
  reviewRowId,
  toSavedReviewInfo,
  type GameReviewRow
} from "./review-rows";
import {
  defaultSettings,
  hydratePieceSettings,
  normalizeAppearanceSettings,
  normalizeOnboardingSettings,
  normalizePlaySettings,
  normalizePracticeSettings,
  normalizeSoundSettings,
  normalizeRatingSettings,
  normalizeReviewEngineSettings,
  normalizeUpdateSettings,
  settingKeys,
  type AppSettings,
  type LegacySettingKey
} from "@chaturanga/shared/types/settings";
import { resolveGameReviewRating } from "@chaturanga/shared/chess/review-rating";
import type {
  CreateEngineInput,
  EngineConfig,
  GameReview,
  MaiaRating,
  UpdateEngineInput
} from "@chaturanga/shared/types/engine";
import { PUZZLE_CONTINUATION_EVENT } from "@chaturanga/shared/types/chess";
import type {
  GameHeaders,
  GameLibraryFacets,
  GameListPage,
  GameListQuery,
  GameSource,
  GameSummary,
  MoveNode,
  SavedGame,
  SaveGameInput
} from "@chaturanga/shared/types/chess";
import { MAIA_RATINGS, maiaRatingFromText } from "../engine/review-analysis";
import { allRows, queriesOn, rollbackIfOpen, sqliteErrcode } from "./rows";
import { parseStoredJson } from "../stored-json";
import { parseMoveTree, rebuiltCursor, remapReviewToTree, storedHeaders } from "./stored-game";
import { isOneOf } from "@chaturanga/shared/types/guards";
import {
  emptyTabCounts,
  isGameSource,
  libraryTabOf,
  sourcesOfTab
} from "@chaturanga/shared/types/library";

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
  source: GameSource;
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
  /** 1 / 0 once saved with it; null for games saved before it was kept. */
  analysis_board: number | null;
  created_at: number;
  updated_at: number;
};

type GameSummaryRow = Pick<
  GameRow,
  "id" | "source" | "white" | "black" | "event" | "result" | "date" | "current_fen" | "updated_at"
> & { review_count?: number | null; last_reviewed_at?: number | null };

/** Library pages: `limit` when absent, and the most one page may hold. */
const GAME_PAGE_DEFAULT = 50;
const GAME_PAGE_MAX = 200;

const GAME_SUMMARY_COLUMNS = `id, source, white, black, event, result, date, current_fen, updated_at`;

/** The columns a library search looks in (as the review picker's search box says). */
const SEARCH_COLUMNS = ["white", "black", "event", "date", "result"] as const;

/**
 * SQLite's lower() folds ASCII only; the search folds case as JavaScript does (so "ÅSE" finds
 * "åse"), through this function, registered once per connection.
 */
const LOWER_FN = "chaturanga_lower";
const lowerRegistered = new WeakSet<DatabaseSync>();

function searchDb(): DatabaseSync {
  const db = getDb();
  if (!lowerRegistered.has(db)) {
    db.function(LOWER_FN, { deterministic: true }, (value) =>
      typeof value === "string" ? value.toLowerCase() : null
    );
    lowerRegistered.add(db);
  }
  return db;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return GAME_PAGE_DEFAULT;
  return Math.min(GAME_PAGE_MAX, Math.max(1, Math.floor(limit)));
}

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

const now = () => Date.now();

function parseArgs(args: string | null): string[] {
  if (!args) return [];
  try {
    const parsed: unknown = JSON.parse(args);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const { all, get, run } = queriesOn(getDb);

/**
 * Runs `work` as one transaction: all of its writes land, or none do. Every caller writes, so it
 * takes the write lock up front (IMMEDIATE): a deferred read-then-write transaction would fail
 * with SQLITE_BUSY at once (no busy wait) if the import writer's connection wrote in between. A
 * BEGIN that finds the lock held past the busy timeout throws its BUSY error unchanged.
 */
export function transaction<T>(work: () => T): T {
  const db = getDb();
  if (db.isTransaction) return work();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    // Rethrown unchanged: a BUSY here is what retryOnceIfBusy retries on.
    rollbackIfOpen(db);
    throw error;
  }
}

/** Pause before retrying a write that found the database busy. */
const BUSY_RETRY_DELAY_MS = 300;

/**
 * Runs a write; if SQLite reports BUSY (another connection, such as the repertoire import writer,
 * held the write lock past the busy timeout), waits `delayMs` without blocking and tries once more
 * before rejecting. For writes the user would otherwise lose, like a game save.
 */
export async function retryOnceIfBusy<T>(
  work: () => T,
  delayMs: number = BUSY_RETRY_DELAY_MS
): Promise<T> {
  try {
    return work();
  } catch (error) {
    const code = sqliteErrcode(error);
    if (code === undefined || (code & 0xff) !== 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return work();
  }
}

/**
 * Saves a game the user would otherwise lose (`games:save`), with one retry when the database is
 * busy (see retryOnceIfBusy). A new game gets its id once, so a retry can't add it twice, and
 * `suppressed` (a game deleted moments ago) is checked before every attempt, so a retry that
 * waited while the game was deleted doesn't bring it back.
 */
export function saveGameRetrying(
  input: SaveGameInput,
  suppressed: (gameId: string) => Error | null,
  delayMs: number = BUSY_RETRY_DELAY_MS
): Promise<SavedGame> {
  const withId = { ...input, id: input.id || nanoid() };
  return retryOnceIfBusy(() => {
    const refusal = suppressed(withId.id);
    if (refusal) throw refusal;
    return gameRepository.save(withId);
  }, delayMs);
}

/** Explicit rating column, else a `maia-1500`-style engine name / weights file. */
function inferMaiaRating(row: EngineRow): MaiaRating | undefined {
  if (isOneOf(MAIA_RATINGS, row.maia_rating)) return row.maia_rating;
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
    source: row.source,
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
 * A stored analysis as the renderer can use it: placed on the game's tree (rebuilt trees remap),
 * with its moves assessed under the current policy (an older review is re-assessed from its stored
 * evaluations and says so; the row itself is left as it was), or null when it can't be read or
 * doesn't fit the game.
 */
function parseStoredReview(
  json: string,
  row: GameRow,
  moveTree: readonly MoveNode[],
  rebuilt: boolean
): GameReview | null {
  let review: GameReview | null = null;
  try {
    const parsed = parseStoredJson<GameReview | null>(json);
    // Reviews saved before real Maia policy was parsed have no schemaVersion;
    // mark them v1 so consumers ignore their (uniform) Maia probabilities.
    if (parsed && Array.isArray(parsed.moves))
      review = { ...parsed, schemaVersion: parsed.schemaVersion ?? 1 };
  } catch {
    review = null;
  }
  const placed = review && rebuilt ? remapReviewToTree(review, moveTree) : review;
  if (!placed) return null;
  try {
    return withCurrentAssessments(placed, {
      openingBook: openingBook(),
      playerRating: placed.rating?.rating ?? settingsRatingFor(row)
    });
  } catch {
    // Damaged moves are left unassessed one by one; anything worse still opens the review, unmarked.
    return placed;
  }
}

/**
 * The rating a review saved before reviews recorded theirs is re-assessed for: the game's own
 * rating for the reviewed side, else the Settings rating for its mode (chess/review-rating.ts).
 */
function settingsRatingFor(row: GameRow): number {
  const settings = settingsRepository.getAll();
  return resolveGameReviewRating({
    headers: storedHeaders(row.headers_json) ?? { event: row.event, site: row.site },
    source: row.source,
    side: settings.reviewPlayerColor,
    ratings: settings.playerRatings
  }).rating;
}

function toSavedGame(row: GameRow): SavedGame {
  const { moveTree, rebuilt } = parseMoveTree(row);

  // Every analysis, newest first; the newest one loads with the game, the others on demand.
  const listed = all<ReviewListingRow>(
    `SELECT ${REVIEW_LISTING_COLUMNS} FROM game_reviews WHERE game_id = ? ORDER BY created_at DESC, review_id`,
    row.id
  );
  const newest = listed[0]
    ? get<{ review_json: string }>(
        "SELECT review_json FROM game_reviews WHERE review_id = ?",
        listed[0].review_id
      )
    : undefined;
  const review = newest ? parseStoredReview(newest.review_json, row, moveTree, rebuilt) : null;

  return {
    ...toGameSummary(row),
    currentNodeId: rebuilt ? rebuiltCursor(moveTree, row.current_fen) : row.current_node_id,
    headers: storedHeaders(row.headers_json),
    site: row.site,
    round: row.round,
    initialFen: row.initial_fen,
    pgn: row.pgn,
    moveTree,
    review,
    reviews: listed.map(toSavedReviewInfo),
    reviewCount: listed.length,
    lastReviewedAt: listed[0]?.created_at ?? null,
    ...(row.analysis_board === null ? {} : { analysisBoard: row.analysis_board === 1 })
  };
}

/** An optional path in a patch: absent keeps `current`, empty clears it, otherwise trimmed. */
function patchedPath(value: string | null | undefined, current: string | null): string | null {
  if (value === undefined) return current;
  return value ? value.trim() : null;
}

/** The engine's stored fields with the patch applied: fields the patch leaves out keep their value. */
function patchedEngine(existing: EngineConfig, patch: UpdateEngineInput) {
  return {
    name: patch.name ?? existing.name,
    executablePath: patch.executablePath ?? existing.executablePath,
    workingDirectory:
      patch.workingDirectory === undefined ? existing.workingDirectory : patch.workingDirectory,
    weightsPath: patchedPath(patch.weightsPath, existing.weightsPath),
    imagePath: patchedPath(patch.imagePath, existing.imagePath),
    args: patch.args ?? existing.args,
    isDefault: patch.isDefault ?? existing.isDefault,
    isHumanPrediction: patch.isHumanPrediction ?? existing.isHumanPrediction,
    maiaRating: patch.maiaRating ?? existing.maiaRating ?? null
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
    const next = patchedEngine(existing, patch);
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
        next.name,
        next.executablePath,
        next.workingDirectory,
        next.weightsPath,
        next.imagePath,
        JSON.stringify(next.args),
        next.isDefault ? 1 : 0,
        next.isHumanPrediction ? 1 : 0,
        next.maiaRating,
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
  const fingerprint = gameFingerprint({
    headers: input.headers,
    rootFen: input.rootFen,
    moveTree: input.moveTree
  });

  const requestedNode = input.moveTree.find((node) => node.id === input.currentNodeId);
  const currentNodeId =
    requestedNode?.id ??
    input.moveTree.find((node) => node.fenAfter === input.currentFen)?.id ??
    input.moveTree.find((node) => node.parentId === null)?.id ??
    "root";

  // The game and its review land together: a busy failure in between leaves neither.
  transaction(() => {
    run(
      `INSERT INTO games (
        id, source, white, black, event, site, round, result, date,
        initial_fen, pgn, current_fen, current_node_id, headers_json, move_tree_json, fingerprint,
        analysis_board, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        analysis_board = COALESCE(excluded.analysis_board, games.analysis_board),
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
      input.analysisBoard === undefined ? null : Number(input.analysisBoard),
      createdAt,
      timestamp
    );
    if (input.review) saveReview(id, input.review);
  });

  const saved = gameRepository.get(id);
  if (!saved) throw new Error("Failed to save game");
  return saved;
}

/**
 * Analyses the user deleted in this session. The renderer's autosave is debounced, so a save of
 * the game can still carry one just deleted (a comment arrived for it a moment before); the upsert
 * would bring it back. Review ids are never reused, so remembering them is enough.
 */
const deletedReviewIds = new Set<string>();

/**
 * The analysis on the board, saved under its own id: a new one is added (re-analysing keeps the
 * earlier ones), and one already saved is updated (its AI commentary grows as moves are viewed).
 */
function saveReview(gameId: string, review: GameReview): void {
  const reviewId = reviewRowId(review, gameId);
  if (deletedReviewIds.has(reviewId)) return;
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
  /**
   * One page of library summaries, newest first then by id (games_recent_idx; no PGN, tree or
   * review read). The filter and search run in SQL before the LIMIT, so a rare match deep in the
   * library is on the first page; the page after starts strictly after the cursor (keyset), so
   * games saved in the same millisecond are neither repeated nor skipped.
   */
  listPage(query: GameListQuery = {}): GameListPage {
    const limit = clampLimit(query.limit);
    // Puzzle sessions are never library games (see the cleanup in db/index.ts).
    const where = ["source != 'puzzle'"];
    const params: SQLInputValue[] = [];
    if (query.cursor) {
      // Same as (updated_at < ? OR (updated_at = ? AND id > ?)), written so the index range applies.
      where.push("updated_at <= ? AND (updated_at < ? OR id > ?)");
      params.push(query.cursor.updatedAt, query.cursor.updatedAt, query.cursor.id);
    }
    if (query.excludeId) {
      where.push("id != ?");
      params.push(query.excludeId);
    }
    if (query.tab) {
      const sources = sourcesOfTab(query.tab);
      where.push(`source IN (${sources.map(() => "?").join(", ")})`);
      params.push(...sources);
    }
    if (query.reviewed)
      where.push("EXISTS (SELECT 1 FROM game_reviews r WHERE r.game_id = games.id)");
    const needle = query.search?.trim().toLowerCase() ?? "";
    if (needle) {
      where.push(
        `(${SEARCH_COLUMNS.map((column) => `instr(${LOWER_FN}(${column}), ?) > 0`).join(" OR ")})`
      );
      params.push(...SEARCH_COLUMNS.map(() => needle));
    }
    // One row past the page says whether there is a next one.
    const rows = allRows<GameSummaryRow>(
      (needle ? searchDb() : getDb()).prepare(
        `SELECT ${GAME_SUMMARY_COLUMNS}, ${REVIEW_COUNTS_SQL}
        FROM games WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id ASC LIMIT ?`
      ),
      ...params,
      limit + 1
    );
    const items = rows.slice(0, limit).map(toGameSummary);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null
    };
  },

  /**
   * Which source tabs the library has games for, with their counts and how many of those have a
   * saved analysis (every library game counted, `excludeId` too), and whether it holds any game
   * other than `excludeId`.
   */
  facets(excludeId: string | null = null): GameLibraryFacets {
    const hasGames = get<{ has_games: number }>(
      "SELECT EXISTS (SELECT 1 FROM games WHERE source != 'puzzle' AND (?1 IS NULL OR id != ?1)) AS has_games",
      excludeId
    );
    const rows = all<{ source: string; games: number; reviewed: number }>(
      `SELECT source, COUNT(*) AS games,
        SUM(EXISTS (SELECT 1 FROM game_reviews r WHERE r.game_id = games.id)) AS reviewed
      FROM games WHERE source != 'puzzle' GROUP BY source`
    );
    const tabs = emptyTabCounts();
    for (const row of rows) {
      // A source this build doesn't know (a newer build's) has no tab.
      if (!isGameSource(row.source)) continue;
      const count = tabs[libraryTabOf(row.source)];
      count.games += Number(row.games);
      count.reviewed += Number(row.reviewed);
    }
    return { hasGames: Boolean(hasGames?.has_games), tabs };
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
    return parseStoredReview(stored.review_json, row, moveTree, rebuilt);
  },

  /**
   * Deletes one analysis of a game (its AI commentary goes with it); the game and its other
   * analyses stay. Returns whether there was one to delete.
   */
  removeReview(gameId: string, reviewId: string): boolean {
    const { changes } = getDb()
      .prepare("DELETE FROM game_reviews WHERE game_id = ? AND review_id = ?")
      .run(gameId, reviewId);
    deletedReviewIds.add(reviewId);
    return Number(changes) > 0;
  },

  /** Deletes every analysis of a game, never the game itself. Returns how many were deleted. */
  removeReviews(gameId: string): number {
    const ids = transaction(() => {
      const listed = all<{ review_id: string }>(
        "SELECT review_id FROM game_reviews WHERE game_id = ?",
        gameId
      );
      run("DELETE FROM game_reviews WHERE game_id = ?", gameId);
      return listed.map((row) => row.review_id);
    });
    for (const id of ids) deletedReviewIds.add(id);
    return ids.length;
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
    return (
      get<{ total: number }>("SELECT COUNT(*) AS total FROM games WHERE source != 'puzzle'")
        ?.total ?? 0
    );
  },

  /** Ids of the games from one source (e.g. Lichess imports). */
  idsBySource(source: GameSource): string[] {
    return all<{ id: string }>("SELECT id FROM games WHERE source = ?", source).map(
      (row) => row.id
    );
  },

  /**
   * A game's headers without reading its tree or reviews: the stored set, or (older rows) the
   * summary columns. Null when the game is gone.
   */
  getHeaders(id: string): GameHeaders | null {
    const row = get<
      Pick<
        GameRow,
        "event" | "site" | "date" | "round" | "white" | "black" | "result" | "headers_json"
      >
    >(
      "SELECT event, site, date, round, white, black, result, headers_json FROM games WHERE id = ?",
      id
    );
    if (!row) return null;
    return (
      storedHeaders(row.headers_json) ?? {
        event: row.event,
        site: row.site,
        date: row.date,
        round: row.round,
        white: row.white,
        black: row.black,
        result: row.result
      }
    );
  },

  get(id: string): SavedGame | null {
    const row = get<GameRow>("SELECT * FROM games WHERE id = ?", id);
    return row ? toSavedGame(row) : null;
  },

  /**
   * The newest engine game still in progress: no result, not a puzzle played on, "You" on exactly
   * one side (so the engine's side is known), and at least one main-line move (read newest first,
   * a few rows at a time, until one has a move).
   */
  latestUnfinishedEngineGame(): SavedGame | null {
    const batch = 20;
    for (let offset = 0; ; offset += batch) {
      const rows = all<GameRow>(
        `SELECT * FROM games
        WHERE source = 'engine-game' AND (result IS NULL OR result IN ('*', ''))
          AND (event IS NULL OR event != ?)
          AND (lower(trim(COALESCE(white, ''))) = 'you') + (lower(trim(COALESCE(black, ''))) = 'you') = 1
        ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
        PUZZLE_CONTINUATION_EVENT,
        batch,
        offset
      );
      for (const row of rows) {
        let game: SavedGame;
        try {
          game = toSavedGame(row);
        } catch {
          // A damaged game can't be rejoined; the next one may be.
          continue;
        }
        const root = game.moveTree.find((node) => node.parentId === null);
        if (root?.children.length) return game;
      }
      if (rows.length < batch) return null;
    }
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
    return normalizeSoundSettings(
      normalizePlaySettings(
        normalizeRatingSettings(
          normalizePracticeSettings(
            normalizeOnboardingSettings(
              normalizeUpdateSettings(
                normalizeAppearanceSettings(
                  normalizeReviewEngineSettings(hydratePieceSettings(merged))
                )
              )
            )
          )
        )
      )
    );
  },

  /** Keys that have a stored row (whatever their value). */
  storedKeys(): string[] {
    return all<Pick<SettingRow, "key">>("SELECT key FROM settings").map((row) => row.key);
  },

  /** The raw persisted value (before defaults/normalization), or undefined when never set. */
  getStored(key: keyof AppSettings | LegacySettingKey): unknown {
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
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const key of settingKeys(patch)) this.set(key, patch[key]);
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
