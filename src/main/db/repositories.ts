import { nanoid } from "nanoid";
import type { SQLInputValue } from "node:sqlite";
import { getDb } from "./index";
import { defaultSettings, type AppSettings } from "../../shared/types/settings";
import type {
  CreateEngineInput,
  EngineConfig,
  UpdateEngineInput
} from "../../shared/types/engine";
import type {
  GameSummary,
  MoveNode,
  SavedGame,
  SaveGameInput
} from "../../shared/types/chess";

type EngineRow = {
  id: string;
  name: string;
  executable_path: string;
  working_directory: string | null;
  args: string | null;
  protocol: string;
  is_default: number;
  is_enabled: number;
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
  move_tree_json: string;
  created_at: number;
  updated_at: number;
};

type SettingRow = {
  key: string;
  value: string;
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

function toEngine(row: EngineRow): EngineConfig {
  return {
    id: row.id,
    name: row.name,
    executablePath: row.executable_path,
    workingDirectory: row.working_directory,
    args: parseArgs(row.args),
    protocol: "uci",
    isDefault: Boolean(row.is_default),
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toGameSummary(row: GameRow): GameSummary {
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

function toSavedGame(row: GameRow): SavedGame {
  let moveTree: MoveNode[];
  try {
    moveTree = JSON.parse(row.move_tree_json) as MoveNode[];
  } catch {
    moveTree = [];
  }

  return {
    ...toGameSummary(row),
    site: row.site,
    round: row.round,
    initialFen: row.initial_fen,
    pgn: row.pgn,
    moveTree
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
      args: JSON.stringify(input.args ?? []),
      protocol: "uci",
      isDefault: input.isDefault ?? this.list().length === 0,
      isEnabled: input.isEnabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    if (row.isDefault) this.clearDefault();
    run(
      `INSERT INTO engines (
        id, name, executable_path, working_directory, args, protocol,
        is_default, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.executablePath,
      row.workingDirectory,
      row.args,
      row.protocol,
      row.isDefault ? 1 : 0,
      row.isEnabled ? 1 : 0,
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
        args = ?,
        is_default = ?,
        is_enabled = ?,
        updated_at = ?
      WHERE id = ?`,
      patch.name === undefined ? existing.name : patch.name,
      patch.executablePath === undefined ? existing.executablePath : patch.executablePath,
      patch.workingDirectory === undefined ? existing.workingDirectory : patch.workingDirectory,
      patch.args === undefined ? JSON.stringify(existing.args) : JSON.stringify(patch.args),
      (patch.isDefault === undefined ? existing.isDefault : patch.isDefault) ? 1 : 0,
      (patch.isEnabled === undefined ? existing.isEnabled : patch.isEnabled) ? 1 : 0,
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

export const gameRepository = {
  list(): GameSummary[] {
    return all<GameRow>("SELECT * FROM games ORDER BY updated_at DESC").map(toGameSummary);
  },

  get(id: string): SavedGame | null {
    const row = get<GameRow>("SELECT * FROM games WHERE id = ?", id);
    return row ? toSavedGame(row) : null;
  },

  save(input: SaveGameInput): SavedGame {
    const timestamp = now();
    const id = input.id || nanoid();
    const existing = get<{ created_at: number }>("SELECT created_at FROM games WHERE id = ?", id);
    const createdAt = existing?.created_at ?? timestamp;

    run(
      `INSERT INTO games (
        id, source, white, black, event, site, round, result, date,
        initial_fen, pgn, current_fen, move_tree_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        move_tree_json = excluded.move_tree_json,
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
      JSON.stringify(input.moveTree),
      createdAt,
      timestamp
    );

    const saved = this.get(id);
    if (!saved) throw new Error("Failed to save game");
    return saved;
  },

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
    return { ...defaultSettings, ...values };
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
