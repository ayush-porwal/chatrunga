import { nanoid } from "nanoid";
import type { SQLInputValue } from "node:sqlite";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { getDb } from "./index";
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
>;

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
    updatedAt: row.updated_at
  };
}

/**
 * The stored move tree. A damaged one is rebuilt from the row's PGN; if that fails too, opening
 * the game fails, rather than showing an empty board that autosave would then write over the
 * stored PGN (the only copy left of the moves).
 */
function parseMoveTree(row: GameRow): MoveNode[] {
  try {
    const parsed: unknown = JSON.parse(row.move_tree_json);
    if (Array.isArray(parsed) && isConsistentTree(parsed)) return parsed;
  } catch {
    // Fall through to the PGN.
  }
  try {
    return importPgnText(row.pgn).game.moveTree;
  } catch {
    throw new Error("This saved game is damaged and can't be opened.");
  }
}

function isMoveNodeLike(value: unknown): value is MoveNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<MoveNode>;
  return (
    typeof node.id === "string" &&
    typeof node.fenAfter === "string" &&
    Array.isArray(node.children) &&
    (node.parentId === null || typeof node.parentId === "string")
  );
}

/** One root, and every parent and child link points at a node of the tree (and back). */
export function isConsistentTree(nodes: readonly unknown[]): nodes is MoveNode[] {
  if (!nodes.length || !nodes.every(isMoveNodeLike)) return false;
  const tree = nodes as MoveNode[];
  const byId = new Map(tree.map((node) => [node.id, node]));
  if (byId.size !== tree.length) return false;
  if (tree.filter((node) => node.parentId === null).length !== 1) return false;
  return tree.every(
    (node) =>
      (node.parentId === null || byId.get(node.parentId)?.children.includes(node.id)) &&
      node.children.every((childId) => byId.get(childId)?.parentId === node.id)
  );
}

function toSavedGame(row: GameRow): SavedGame {
  const moveTree = parseMoveTree(row);

  let review: GameReview | null = null;
  if (row.review_json) {
    try {
      const parsed = JSON.parse(row.review_json) as GameReview;
      // Reviews saved before real Maia policy was parsed have no schemaVersion;
      // mark them v1 so consumers ignore their (uniform) Maia probabilities.
      if (parsed && Array.isArray(parsed.moves)) review = { ...parsed, schemaVersion: parsed.schemaVersion ?? 1 };
    } catch {
      review = null;
    }
  }

  let headers: GameHeaders | null = null;
  if (row.headers_json) {
    try {
      const parsed: unknown = JSON.parse(row.headers_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) headers = parsed as GameHeaders;
    } catch {
      headers = null;
    }
  }

  return {
    ...toGameSummary(row),
    currentNodeId: row.current_node_id,
    headers,
    site: row.site,
    round: row.round,
    initialFen: row.initial_fen,
    pgn: row.pgn,
    moveTree,
    review
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
    return this.get(row.id)!;
  },

  update(id: string, patch: UpdateEngineInput): EngineConfig {
    const existing = this.get(id);
    if (!existing) throw new Error("Engine not found");
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
  const existing = get<{ created_at: number; review_json: string | null }>(
    "SELECT created_at, review_json FROM games WHERE id = ?",
    id
  );
  const createdAt = existing?.created_at ?? timestamp;
  const reviewJson =
    input.review === undefined
      ? (existing?.review_json ?? null)
      : input.review === null
        ? null
        : JSON.stringify(input.review);

  const requestedNode = input.moveTree.find((node) => node.id === input.currentNodeId);
  const currentNodeId =
    requestedNode?.id ??
    input.moveTree.find((node) => node.fenAfter === input.currentFen)?.id ??
    input.moveTree.find((node) => node.parentId === null)?.id ??
    "root";

  run(
    `INSERT INTO games (
      id, source, white, black, event, site, round, result, date,
      initial_fen, pgn, current_fen, current_node_id, headers_json, move_tree_json, review_json,
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
      review_json = excluded.review_json,
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
    reviewJson,
    createdAt,
    timestamp
  );

  const saved = gameRepository.get(id);
  if (!saved) throw new Error("Failed to save game");
  return saved;
}

export const gameRepository = {
  list(): GameSummary[] {
    // Puzzle sessions are never library games (see the cleanup in db/index.ts).
    return all<GameSummaryRow>(
      `SELECT id, source, white, black, event, result, date, current_fen, updated_at
      FROM games WHERE source != 'puzzle' ORDER BY updated_at DESC`
    ).map(toGameSummary);
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
   * Permanently removes the game row. All persisted state for this game lives in that row
   * (PGN, move tree, headers, embedded engine review JSON, clocks, etc.), so this deletes
   * everything with no separate review or ancillary tables to clean up.
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
