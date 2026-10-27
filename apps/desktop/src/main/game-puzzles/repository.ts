/**
 * Puzzles from the user's games (migration 15, docs/puzzles-from-games.md): the puzzles and their
 * spaced-repetition progress, the generation queue's rows (one per game), and the queue's own
 * settings (paused, the dialog's last-used choices). Stored JSON is checked as it is read back: a
 * damaged puzzle is left out, a damaged queue row's settings fall back to the defaults.
 */
import { nanoid } from "nanoid";
import type { SQLInputValue } from "node:sqlite";
import type { GeneratedPuzzle, PuzzleScanEntry } from "@chaturanga/shared/chess/puzzle-generator";
import { userSideOfGame } from "@chaturanga/shared/chess/puzzle-generator";
import { orderQueue, scheduleAfterOutcome } from "@chaturanga/shared/chess/repertoire-scheduler";
import { gameRatingMode } from "@chaturanga/shared/chess/review-rating";
import { MAIA3_RATING_RANGE } from "@chaturanga/shared/engine/maia3";
import type { Color, GameHeaders, GameSource } from "@chaturanga/shared/types/chess";
import type { EngineScore } from "@chaturanga/shared/types/engine";
import {
  DEFAULT_GAME_PUZZLE_SETTINGS,
  GAME_PUZZLE_DEPTH_PRESETS,
  GAME_PUZZLE_KINDS,
  GAME_PUZZLE_OUTCOMES,
  GAME_PUZZLE_SOURCES,
  type GamePuzzle,
  type GamePuzzleAttemptInput,
  type GamePuzzleDepthPreset,
  type GamePuzzleFilter,
  type GamePuzzleGameResult,
  type GamePuzzleKind,
  type GamePuzzleList,
  type GamePuzzleProgress,
  type GamePuzzleQuery,
  type GamePuzzleQueueSource,
  type GamePuzzleSettings,
  type GamePuzzleSource,
  type GamePuzzleSourceSummary,
  type GamePuzzleSummary
} from "@chaturanga/shared/types/game-puzzles";
import { isOneOf, isRecord } from "@chaturanga/shared/types/guards";
import { REPERTOIRE_SCHEDULER_VERSION } from "@chaturanga/shared/types/repertoire";
import { getDb } from "../db";
import { mainlineUcis } from "../db/game-fingerprint";
import { settingsRepository, transaction } from "../db/repositories";
import { queriesOn } from "../db/rows";
import { parseMoveTree, storedHeaders } from "../db/stored-game";
import { parseGamePuzzleSettings } from "../ipc/validate-game-puzzles";

const { all, get, run } = queriesOn(getDb);

const PAUSED_KEY = "main.gamePuzzles.paused";
const LAST_SETTINGS_KEY = "main.gamePuzzles.lastSettings";

/** Where "My games" come from, as the games table names it. */
const GAME_SOURCE: Record<GamePuzzleSource, GameSource> = {
  lichess: "lichess",
  chesscom: "chesscom",
  imported: "pgn-import"
};
const MY_GAME_SOURCES = GAME_PUZZLE_SOURCES.map((source) => GAME_SOURCE[source]);
const COLORS: readonly Color[] = ["white", "black"];

/** A game's "My games" source; null for games that aren't the user's (engine games, analysis…). */
function puzzleSourceOf(source: string): GamePuzzleSource | null {
  return GAME_PUZZLE_SOURCES.find((key) => GAME_SOURCE[key] === source) ?? null;
}

/** What a queued game is searched for: the kinds and the depth preset. */
export type QueuedSettings = { kinds: GamePuzzleKind[]; depth: GamePuzzleDepthPreset };

export type QueueEntry = {
  gameId: string;
  source: GamePuzzleQueueSource;
  settings: QueuedSettings;
  /** The finished review's evaluations (the review hook), else null: the generator scans. */
  scan: (PuzzleScanEntry | null)[] | null;
};

/** A game as the generator reads it. */
export type GenerationGame = {
  source: GameSource;
  white: string | null;
  black: string | null;
  date: string | null;
  headers: GameHeaders;
  rootFen: string;
  moves: string[];
};

type PuzzleRow = {
  id: string;
  game_id: string;
  ply: number;
  kind: string;
  tags_json: string;
  solver_side: string;
  start_fen: string;
  setup_move: string | null;
  solution_json: string;
  played_move: string;
  win_before: number;
  win_after: number;
  difficulty: number | null;
  difficulty_capped: number;
  user_chance: number | null;
  chance_rating: number | null;
  themes_json: string;
  /** Progress (null: never attempted). */
  stage: number | null;
  due_at: number | null;
  lapses: number | null;
  last_attempt_at: number | null;
  last_outcome: string | null;
  attempts: number | null;
  /** The game. */
  source: string;
  white: string | null;
  black: string | null;
  date: string | null;
};

type ProgressRow = Pick<
  PuzzleRow,
  "stage" | "due_at" | "lapses" | "last_attempt_at" | "last_outcome" | "attempts"
>;

type QueueRow = {
  game_id: string;
  source: string;
  settings_json: string;
  scan_json: string | null;
};

type GameRow = {
  id: string;
  source: string;
  white: string | null;
  black: string | null;
  event: string | null;
  site: string | null;
  headers_json: string | null;
};

const PUZZLE_COLUMNS = `p.id, p.game_id, p.ply, p.kind, p.tags_json, p.solver_side, p.start_fen,
  p.setup_move, p.solution_json, p.played_move, p.win_before, p.win_after, p.difficulty,
  p.difficulty_capped, p.user_chance, p.chance_rating, p.themes_json,
  pr.stage, pr.due_at, pr.lapses, pr.last_attempt_at, pr.last_outcome, pr.attempts,
  g.source, g.white, g.black, g.date`;

const PUZZLE_FROM = `game_puzzles p
  JOIN games g ON g.id = p.game_id
  LEFT JOIN game_puzzle_progress pr ON pr.puzzle_id = p.id`;

/* ------------------------------------------------------------------ reading stored JSON */

function readJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringsIn(text: string): string[] | null {
  const value = readJson(text);
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function kindsIn(value: unknown): GamePuzzleKind[] {
  return Array.isArray(value)
    ? value.filter((item): item is GamePuzzleKind => isOneOf(GAME_PUZZLE_KINDS, item))
    : [];
}

function scoreOf(value: unknown): EngineScore | null {
  if (!isRecord(value) || (value.type !== "cp" && value.type !== "mate")) return null;
  return typeof value.value === "number" && Number.isFinite(value.value)
    ? { type: value.type, value: value.value }
    : null;
}

/** A stored scan, entry by entry; null (scan again) when any entry can't be read. */
function scanIn(text: string | null): (PuzzleScanEntry | null)[] | null {
  const value = readJson(text);
  if (!Array.isArray(value)) return null;
  const entries: (PuzzleScanEntry | null)[] = [];
  for (const item of value) {
    if (item === null) {
      entries.push(null);
      continue;
    }
    const score = isRecord(item) ? scoreOf(item.score) : null;
    const bestMove = isRecord(item) ? item.bestMove : undefined;
    if (!score || (bestMove !== null && typeof bestMove !== "string")) return null;
    entries.push({ score, bestMove });
  }
  return entries;
}

function queuedSettingsIn(text: string): QueuedSettings {
  const value = readJson(text);
  const record = isRecord(value) ? value : {};
  return {
    kinds: kindsIn(record.kinds),
    depth: isOneOf(GAME_PUZZLE_DEPTH_PRESETS, record.depth) ? record.depth : "standard"
  };
}

function defaultSettings(): GamePuzzleSettings {
  return {
    ...DEFAULT_GAME_PUZZLE_SETTINGS,
    sources: [...DEFAULT_GAME_PUZZLE_SETTINGS.sources],
    timeControls: [...DEFAULT_GAME_PUZZLE_SETTINGS.timeControls],
    kinds: [...DEFAULT_GAME_PUZZLE_SETTINGS.kinds]
  };
}

function toProgress(row: ProgressRow): GamePuzzleProgress {
  return {
    stage: row.stage ?? 0,
    dueAt: row.due_at,
    lapses: row.lapses ?? 0,
    lastAttemptAt: row.last_attempt_at,
    lastOutcome: isOneOf(GAME_PUZZLE_OUTCOMES, row.last_outcome) ? row.last_outcome : null,
    attempts: row.attempts ?? 0
  };
}

const otherSide = (side: Color): Color => (side === "white" ? "black" : "white");

/** The stored puzzle, or null when it can't be read (it is left out). */
function toPuzzle(row: PuzzleRow): GamePuzzle | null {
  const source = puzzleSourceOf(row.source);
  const solution = stringsIn(row.solution_json);
  if (!source || !solution?.length) return null;
  if (!isOneOf(GAME_PUZZLE_KINDS, row.kind) || !isOneOf(COLORS, row.solver_side)) return null;
  // The solver is the user, except in an Opponent's chance (solved as the opponent).
  const userSide = row.kind === "opponent-chance" ? otherSide(row.solver_side) : row.solver_side;
  return {
    id: row.id,
    gameId: row.game_id,
    ply: row.ply,
    kind: row.kind,
    tags: kindsIn(readJson(row.tags_json)),
    solverSide: row.solver_side,
    startFen: row.start_fen,
    setupMove: row.setup_move,
    solution,
    playedMove: row.played_move,
    winBefore: row.win_before,
    winAfter: row.win_after,
    difficulty: row.difficulty,
    difficultyCapped: row.difficulty_capped === 1,
    userChance: row.user_chance,
    chanceRating: row.chance_rating,
    themes: stringsIn(row.themes_json) ?? [],
    progress: toProgress(row),
    game: {
      source,
      opponent: userSide === "white" ? row.black : row.white,
      date: row.date,
      moveNumber: Math.ceil(row.ply / 2)
    }
  };
}

/* ------------------------------------------------------------------ the set's queue */

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

/** The filter as SQL over PUZZLE_FROM; only "My games" puzzles are ever in the set. */
function filterSql(filter: GamePuzzleFilter): { where: string; params: SQLInputValue[] } {
  const sources = filter.sources?.length
    ? filter.sources.map((source) => GAME_SOURCE[source])
    : MY_GAME_SOURCES;
  const clauses = [`g.source IN (${placeholders(sources)})`];
  const params: SQLInputValue[] = [...sources];
  if (filter.kinds?.length) {
    clauses.push(`p.kind IN (${placeholders(filter.kinds)})`);
    params.push(...filter.kinds);
  }
  if (filter.difficulty) {
    const { min, max } = filter.difficulty;
    // 2600+ (no rating finds it half the time) is above every grid rating.
    clauses.push("(p.difficulty BETWEEN ? AND ? OR (? AND p.difficulty_capped = 1))");
    params.push(min, max, max >= MAIA3_RATING_RANGE.max ? 1 : 0);
  }
  return { where: clauses.join(" AND "), params };
}

type QueueCard = {
  id: string;
  dueAt: number | null;
  /** orderQueue's tie-breaks for new puzzles: newest game first (its rank), then game order. */
  ply: number;
  chapterOrder: number;
};

/** The matching puzzles in the set's order (due, then new, then the ones due later). */
function orderedCards(filter: GamePuzzleFilter, now: number): QueueCard[] {
  const { where, params } = filterSql(filter);
  const rows = all<{ id: string; game_id: string; due_at: number | null }>(
    `SELECT p.id, p.game_id, pr.due_at FROM ${PUZZLE_FROM}
    WHERE ${where}
    ORDER BY g.updated_at DESC, g.id, p.ply`,
    ...params
  );
  let rank = -1;
  let lastGame: string | null = null;
  const cards = rows.map((row) => {
    if (row.game_id !== lastGame) rank += 1;
    lastGame = row.game_id;
    return { id: row.id, dueAt: row.due_at, ply: 0, chapterOrder: rank };
  });
  return orderQueue(cards, now);
}

const isDue = (card: QueueCard, now: number) => card.dueAt === null || card.dueAt <= now;

/** The puzzles of `ids`, in that order (one that can't be read is left out). */
function puzzlesById(ids: readonly string[]): GamePuzzle[] {
  if (!ids.length) return [];
  const rows = all<PuzzleRow>(
    `SELECT ${PUZZLE_COLUMNS} FROM ${PUZZLE_FROM} WHERE p.id IN (${placeholders(ids)})`,
    ...ids
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    const puzzle = row ? toPuzzle(row) : null;
    return puzzle ? [puzzle] : [];
  });
}

/** Writes a found puzzle under `id` (a kept one keeps its creation time and its progress). */
function writePuzzle(id: string, gameId: string, puzzle: GeneratedPuzzle, now: number): void {
  run(
    `INSERT INTO game_puzzles (
      id, game_id, ply, kind, tags_json, solver_side, start_fen, setup_move, solution_json,
      played_move, win_before, win_after, difficulty, difficulty_capped, user_chance, chance_rating,
      themes_json, position_key, generator_version, scan_depth, verify_depth, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      tags_json = excluded.tags_json,
      solver_side = excluded.solver_side,
      start_fen = excluded.start_fen,
      setup_move = excluded.setup_move,
      played_move = excluded.played_move,
      win_before = excluded.win_before,
      win_after = excluded.win_after,
      difficulty = excluded.difficulty,
      difficulty_capped = excluded.difficulty_capped,
      user_chance = excluded.user_chance,
      chance_rating = excluded.chance_rating,
      themes_json = excluded.themes_json,
      generator_version = excluded.generator_version,
      scan_depth = excluded.scan_depth,
      verify_depth = excluded.verify_depth`,
    id,
    gameId,
    puzzle.ply,
    puzzle.kind,
    JSON.stringify(puzzle.tags),
    puzzle.solverSide,
    puzzle.startFen,
    puzzle.setupMove,
    JSON.stringify(puzzle.solution),
    puzzle.playedMove,
    puzzle.winBefore,
    puzzle.winAfter,
    puzzle.difficulty,
    puzzle.difficultyCapped ? 1 : 0,
    puzzle.userChance,
    puzzle.chanceRating,
    JSON.stringify(puzzle.themes),
    puzzle.positionKey,
    puzzle.generatorVersion,
    puzzle.depths.scan,
    puzzle.depths.verify,
    now
  );
}

function emptySourceSummary(): GamePuzzleSourceSummary {
  return { games: 0, eligible: 0, processed: 0, puzzles: 0 };
}

export const gamePuzzleRepository = {
  /**
   * Stores a game's puzzles from a run of `kinds`: they replace its puzzles of those kinds (and any
   * at the same plies). A puzzle whose position and solution are unchanged keeps its id and its
   * progress. Throws when the game is gone.
   */
  savePuzzles(
    gameId: string,
    kinds: readonly GamePuzzleKind[],
    puzzles: readonly GeneratedPuzzle[],
    now: number = Date.now()
  ): void {
    transaction(() => {
      if (!get<{ found: number }>("SELECT 1 AS found FROM games WHERE id = ?", gameId))
        throw new Error("The game was deleted.");
      const found = new Map(puzzles.map((puzzle) => [puzzle.ply, puzzle]));
      const ran = new Set<string>(kinds);
      const kept = new Map<number, string>();
      const existing = all<{
        id: string;
        ply: number;
        kind: string;
        position_key: string;
        solution_json: string;
      }>(
        "SELECT id, ply, kind, position_key, solution_json FROM game_puzzles WHERE game_id = ?",
        gameId
      );
      for (const row of existing) {
        const puzzle = found.get(row.ply);
        if (!puzzle && !ran.has(row.kind)) continue;
        if (
          puzzle?.positionKey === row.position_key &&
          JSON.stringify(puzzle.solution) === row.solution_json
        )
          kept.set(row.ply, row.id);
        else run("DELETE FROM game_puzzles WHERE id = ?", row.id);
      }
      for (const puzzle of puzzles)
        writePuzzle(kept.get(puzzle.ply) ?? nanoid(), gameId, puzzle, now);
    });
  },

  /** The set in queue order (filtered, leaving out `excludeIds`), with its total and due counts. */
  list(query: GamePuzzleQuery, now: number = Date.now()): GamePuzzleList {
    const cards = orderedCards(query, now);
    const excluded = new Set(query.excludeIds);
    const ids = cards
      .filter((card) => !excluded.has(card.id))
      .slice(0, query.limit ?? cards.length)
      .map((card) => card.id);
    return {
      puzzles: puzzlesById(ids),
      total: cards.length,
      due: cards.filter((card) => isDue(card, now)).length
    };
  },

  /** The next due or new puzzle not in `excludeIds`; null when none is left. */
  next(query: GamePuzzleQuery, now: number = Date.now()): GamePuzzle | null {
    const excluded = new Set(query.excludeIds);
    for (const card of orderedCards(query, now)) {
      if (!isDue(card, now)) return null;
      if (excluded.has(card.id)) continue;
      const puzzle = puzzlesById([card.id]).at(0);
      if (puzzle) return puzzle;
    }
    return null;
  },

  /** Schedules the puzzle after an attempt (chess/repertoire-scheduler.ts); its new progress. */
  recordAttempt(input: GamePuzzleAttemptInput, now: number = Date.now()): GamePuzzleProgress {
    return transaction(() => {
      const row = get<ProgressRow>(
        `SELECT pr.stage, pr.due_at, pr.lapses, pr.last_attempt_at, pr.last_outcome, pr.attempts
        FROM game_puzzles p LEFT JOIN game_puzzle_progress pr ON pr.puzzle_id = p.id
        WHERE p.id = ?`,
        input.puzzleId
      );
      if (!row) throw new Error("This puzzle is no longer in your games.");
      const previous = toProgress(row);
      const schedule = scheduleAfterOutcome(
        row.stage === null
          ? null
          : {
              stage: previous.stage,
              dueAt: previous.dueAt,
              lastAttemptAt: previous.lastAttemptAt,
              lapses: previous.lapses,
              unaidedSuccesses: 0,
              schedulerVersion: REPERTOIRE_SCHEDULER_VERSION
            },
        input.outcome,
        now
      );
      if (!schedule) throw new Error("The attempt has no outcome to schedule.");
      const progress: GamePuzzleProgress = {
        stage: schedule.stage,
        dueAt: schedule.dueAt,
        lapses: schedule.lapses,
        lastAttemptAt: schedule.lastAttemptAt,
        lastOutcome: input.outcome,
        attempts: previous.attempts + 1
      };
      run(
        `INSERT INTO game_puzzle_progress (puzzle_id, stage, due_at, lapses, last_attempt_at, last_outcome, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(puzzle_id) DO UPDATE SET
          stage = excluded.stage,
          due_at = excluded.due_at,
          lapses = excluded.lapses,
          last_attempt_at = excluded.last_attempt_at,
          last_outcome = excluded.last_outcome,
          attempts = excluded.attempts`,
        input.puzzleId,
        progress.stage,
        progress.dueAt,
        progress.lapses,
        progress.lastAttemptAt,
        progress.lastOutcome,
        progress.attempts
      );
      return progress;
    });
  },

  /** The "My games" card's counts (`usernames`: the connected accounts'). */
  summary(
    usernames: readonly string[],
    now: number = Date.now()
  ): Pick<GamePuzzleSummary, "sources" | "puzzles" | "due"> {
    const sources: Record<GamePuzzleSource, GamePuzzleSourceSummary> = {
      lichess: emptySourceSummary(),
      chesscom: emptySourceSummary(),
      imported: emptySourceSummary()
    };
    const games = all<Pick<GameRow, "source" | "white" | "black">>(
      `SELECT source, white, black FROM games WHERE source IN (${placeholders(MY_GAME_SOURCES)})`,
      ...MY_GAME_SOURCES
    );
    for (const game of games) {
      const source = puzzleSourceOf(game.source);
      if (!source) continue;
      sources[source].games += 1;
      if (userSideOfGame(game, usernames)) sources[source].eligible += 1;
    }
    for (const row of all<{ source: string; count: number }>(
      `SELECT g.source, COUNT(*) AS count FROM puzzle_generation_games q JOIN games g ON g.id = q.game_id
      WHERE q.last_result IS NOT NULL GROUP BY g.source`
    )) {
      const source = puzzleSourceOf(row.source);
      if (source) sources[source].processed = row.count;
    }
    let puzzles = 0;
    for (const row of all<{ source: string; count: number }>(
      "SELECT g.source, COUNT(*) AS count FROM game_puzzles p JOIN games g ON g.id = p.game_id GROUP BY g.source"
    )) {
      const source = puzzleSourceOf(row.source);
      if (!source) continue;
      sources[source].puzzles = row.count;
      puzzles += row.count;
    }
    const { where, params } = filterSql({});
    const due =
      get<{ due: number }>(
        `SELECT COUNT(*) AS due FROM ${PUZZLE_FROM} WHERE ${where} AND (pr.due_at IS NULL OR pr.due_at <= ?)`,
        ...params,
        now
      )?.due ?? 0;
    return { sources, puzzles, due };
  },

  /**
   * The games `settings` would queue, newest first (`limit` applied), and how many matching games
   * have no user side. Games already in the queue are left out; so are processed ones when
   * `skipProcessed`.
   */
  matchingGames(
    settings: GamePuzzleSettings,
    usernames: readonly string[]
  ): { ids: string[]; withoutUserSide: number } {
    const sources = settings.sources.map((source) => GAME_SOURCE[source]);
    if (!sources.length) return { ids: [], withoutUserSide: 0 };
    const rows = all<GameRow & { status: string | null; last_result: string | null }>(
      `SELECT g.id, g.source, g.white, g.black, g.event, g.site, g.headers_json, q.status, q.last_result
      FROM games g LEFT JOIN puzzle_generation_games q ON q.game_id = g.id
      WHERE g.source IN (${placeholders(sources)})
      ORDER BY g.updated_at DESC, g.id`,
      ...sources
    );
    const modes = new Set(settings.timeControls);
    const ids: string[] = [];
    let withoutUserSide = 0;
    for (const row of rows) {
      if (row.status === "queued" || row.status === "running") continue;
      if (settings.skipProcessed && row.last_result !== null) continue;
      const headers = storedHeaders(row.headers_json) ?? { event: row.event, site: row.site };
      if (!isOneOf(MY_GAME_SOURCES, row.source)) continue;
      if (!modes.has(gameRatingMode(headers, row.source))) continue;
      if (!userSideOfGame(row, usernames)) withoutUserSide += 1;
      else ids.push(row.id);
    }
    return { ids: settings.limit === null ? ids : ids.slice(0, settings.limit), withoutUserSide };
  },

  /** A game as the generator reads it; null when it is gone. Throws when its moves are damaged. */
  generationGame(gameId: string): GenerationGame | null {
    const row = get<
      GameRow & {
        date: string | null;
        initial_fen: string | null;
        pgn: string;
        move_tree_json: string;
      }
    >(
      `SELECT id, source, white, black, event, site, headers_json, date, initial_fen, pgn, move_tree_json
      FROM games WHERE id = ?`,
      gameId
    );
    if (!row || !isOneOf(MY_GAME_SOURCES, row.source)) return null;
    const { moveTree } = parseMoveTree(row);
    const root = moveTree.find((node) => node.parentId === null);
    return {
      source: row.source,
      white: row.white,
      black: row.black,
      date: row.date,
      headers: storedHeaders(row.headers_json) ?? { event: row.event, site: row.site },
      rootFen: row.initial_fen ?? root?.fenAfter ?? "",
      moves: mainlineUcis(moveTree)
    };
  },

  /* ---------------------------------------------------------------- the generation queue */

  /**
   * Queues games in order (games already queued or running stay where they are). A queue that was
   * empty starts a new batch for the status's count. Returns how many were queued.
   */
  enqueue(entries: readonly QueueEntry[], now: number = Date.now()): number {
    return transaction(() => {
      if (!this.hasQueued()) run("UPDATE puzzle_generation_games SET in_batch = 0");
      let order =
        get<{ last: number | null }>("SELECT MAX(queue_order) AS last FROM puzzle_generation_games")
          ?.last ?? 0;
      let queued = 0;
      for (const entry of entries) {
        order += 1;
        const changes = getDb()
          .prepare(
            `INSERT INTO puzzle_generation_games (
              game_id, status, source, settings_json, scan_json, queue_order, in_batch, enqueued_at
            ) VALUES (?, 'queued', ?, ?, ?, ?, 1, ?)
            ON CONFLICT(game_id) DO UPDATE SET
              status = 'queued',
              source = excluded.source,
              settings_json = excluded.settings_json,
              scan_json = excluded.scan_json,
              queue_order = excluded.queue_order,
              in_batch = 1,
              enqueued_at = excluded.enqueued_at
            WHERE puzzle_generation_games.status NOT IN ('queued', 'running')`
          )
          .run(
            entry.gameId,
            entry.source,
            JSON.stringify(entry.settings),
            entry.scan ? JSON.stringify(entry.scan) : null,
            order,
            now
          ).changes;
        queued += Number(changes);
      }
      return queued;
    });
  },

  hasQueued(): boolean {
    return Boolean(
      get<{ found: number }>(
        "SELECT 1 AS found FROM puzzle_generation_games WHERE status IN ('queued', 'running') LIMIT 1"
      )
    );
  },

  /** The first game waiting, marked running; null when the queue is empty. */
  takeNext(): QueueEntry | null {
    return transaction(() => {
      const row = get<QueueRow>(
        `SELECT game_id, source, settings_json, scan_json FROM puzzle_generation_games
        WHERE status = 'queued' ORDER BY queue_order LIMIT 1`
      );
      if (!row) return null;
      run("UPDATE puzzle_generation_games SET status = 'running' WHERE game_id = ?", row.game_id);
      return {
        gameId: row.game_id,
        source: row.source === "review" ? "review" : "dialog",
        settings: queuedSettingsIn(row.settings_json),
        scan: scanIn(row.scan_json)
      };
    });
  },

  /** Records how the running game ended (nothing when it is no longer running: cancelled, deleted). */
  finish(result: GamePuzzleGameResult, now: number = Date.now()): void {
    run(
      `UPDATE puzzle_generation_games
      SET status = ?1, last_result = ?1, finished_at = ?2, puzzles_found = ?3, error = ?4, scan_json = NULL
      WHERE game_id = ?5 AND status = 'running'`,
      result.status,
      now,
      result.puzzlesFound,
      result.error,
      result.gameId
    );
  },

  /** A game left running (the app quit mid-game) waits again, first in line. */
  requeueRunning(): void {
    run("UPDATE puzzle_generation_games SET status = 'queued' WHERE status = 'running'");
  },

  /**
   * Empties the queue: games never processed leave it, the others go back to their last result.
   * The batch count starts over.
   */
  cancelQueue(): void {
    transaction(() => {
      run(
        "DELETE FROM puzzle_generation_games WHERE status IN ('queued', 'running') AND last_result IS NULL"
      );
      run(
        `UPDATE puzzle_generation_games SET status = last_result, scan_json = NULL
        WHERE status IN ('queued', 'running')`
      );
      run("UPDATE puzzle_generation_games SET in_batch = 0");
    });
  },

  /** The batch since the queue was last empty: games finished, and in all. */
  batchCounts(): { done: number; total: number } {
    const row = get<{ total: number; done: number | null }>(
      `SELECT COUNT(*) AS total, SUM(status NOT IN ('queued', 'running')) AS done
      FROM puzzle_generation_games WHERE in_batch = 1`
    );
    return { done: row?.done ?? 0, total: row?.total ?? 0 };
  },

  /* ---------------------------------------------------------------- the queue's settings */

  paused(): boolean {
    return settingsRepository.getMain(PAUSED_KEY) === true;
  },

  setPaused(paused: boolean): void {
    settingsRepository.setMain(PAUSED_KEY, paused);
  },

  /** The dialog's last-used settings (the defaults when never used, or unreadable). */
  lastSettings(): GamePuzzleSettings {
    const stored = settingsRepository.getMain(LAST_SETTINGS_KEY);
    if (stored === undefined) return defaultSettings();
    try {
      return parseGamePuzzleSettings(stored);
    } catch {
      return defaultSettings();
    }
  },

  setLastSettings(settings: GamePuzzleSettings): void {
    settingsRepository.setMain(LAST_SETTINGS_KEY, settings);
  }
};
