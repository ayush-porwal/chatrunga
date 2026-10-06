import { exportGameToPgn, importPgnText } from "@chaturanga/shared/chess/pgn";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import type { ChesscomImportWindow } from "@chaturanga/shared/types/chesscom";
import { logger } from "../logger";
import {
  archiveMonthOf,
  parseArchiveGames,
  parseArchiveMonths,
  playerPath,
  type ArchiveMonth,
  type ChesscomClient,
  type ChesscomGame
} from "./client";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back each first-import choice reaches. */
export const IMPORT_WINDOW_MS: Record<ChesscomImportWindow, number> = {
  "3months": 91 * DAY_MS,
  year: 365 * DAY_MS,
  all: Number.POSITIVE_INFINITY
};
const PROGRESS_INTERVAL_MS = 250;

export type ImportRepository = {
  findIdBySite(site: string): string | null;
  saveImported(input: SaveGameInput, playedAt: number): unknown;
};

/**
 * Where the next import starts: the last archive month read (the next import reads it again, and
 * the month before it, since chess.com may still have served a cached, incomplete month), and the
 * first import's window (epoch seconds): games that ended before it are never taken.
 */
export type ImportCursor = { month: ArchiveMonth; floor: number };

export type ImportResult = {
  imported: number;
  skipped: number;
  /** The cursor for the next import (the one passed in when no archive was read). */
  nextCursor: ImportCursor | null;
};

/** The earliest end time (epoch ms) the first import takes. */
export function firstImportSince(window: ChesscomImportWindow, now: number): number {
  return Math.max(0, now - IMPORT_WINDOW_MS[window]);
}

/** The archive month before `month` (`2026/01` → `2025/12`). */
export function previousMonth(month: ArchiveMonth): ArchiveMonth {
  const [year = 0, number = 1] = month.split("/").map(Number);
  return archiveMonthOf(Date.UTC(year, number - 2, 1));
}

/**
 * Imports the player's finished standard games into the library, a monthly archive at a time
 * (oldest first, one request at a time). The first import reaches back to `since`; later ones
 * continue from `cursor`. A game already there (same chess.com URL in its Site header) is skipped,
 * so reading a month again is harmless; variants (`rules` other than `chess`) are skipped too.
 */
export async function importChesscomGames(input: {
  client: Pick<ChesscomClient, "json">;
  repository: ImportRepository;
  /** The chess.com username (the account's id). */
  username: string;
  cursor: ImportCursor | null;
  /** First import only (no cursor): the earliest end time taken (epoch ms). */
  since: number;
  signal?: AbortSignal;
  onProgress?: (imported: number) => void;
}): Promise<ImportResult> {
  const { client, repository, username, cursor, signal } = input;
  const result: ImportResult = { imported: 0, skipped: 0, nextCursor: cursor };
  const months = parseArchiveMonths(
    await client.json(playerPath(username, "/games/archives"), signal)
  );
  const floor = cursor ? cursor.floor : Math.ceil(input.since / 1000);
  const firstMonth = cursor ? previousMonth(cursor.month) : archiveMonthOf(floor * 1000);
  // The first month with a game that couldn't be saved: the next import starts there again.
  let failedMonth: ArchiveMonth | null = null;
  let lastProgressAt = 0;
  for (const month of months.filter((month) => month >= firstMonth)) {
    signal?.throwIfAborted();
    const games = parseArchiveGames(
      await client.json(playerPath(username, `/games/${month}`), signal)
    );
    for (const game of games) {
      if (game.endTime < floor) continue;
      const outcome = importGame(repository, game);
      if (outcome === "imported") result.imported += 1;
      else result.skipped += 1;
      if (outcome === "failed") failedMonth ??= month;
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        input.onProgress?.(result.imported);
      }
    }
    result.nextCursor = { month: failedMonth ?? month, floor };
  }
  return result;
}

/**
 * One game into the library. A game that can't be read (no PGN, a move that can't be played) is
 * skipped for good (logged): chess.com won't send it differently next time. Only a game the
 * library failed to save is `failed`, to be tried again.
 */
function importGame(
  repository: ImportRepository,
  game: ChesscomGame
): "imported" | "skipped" | "failed" {
  if (game.rules !== "chess") return "skipped";
  if (repository.findIdBySite(game.url)) return "skipped";
  let input: SaveGameInput;
  try {
    if (!game.pgn) throw new Error("no PGN");
    // Strict: a move that can't be played refuses the game, rather than cutting it short.
    const { game: parsed } = importPgnText(game.pgn, { strict: true });
    if (parsed.moveTree.length < 2) return "skipped";
    // The game's page is its identity (chess.com's PGN names only "Chess.com" as the site).
    const headers = { ...parsed.headers, site: game.url };
    input = {
      ...parsed,
      id: null,
      source: "chesscom",
      headers,
      pgn: exportGameToPgn({ headers, moveTree: parsed.moveTree })
    };
  } catch (error) {
    logger.warn("chesscom", `skipped game ${game.url}, which can't be read:`, error);
    return "skipped";
  }
  try {
    repository.saveImported(input, game.endTime * 1000);
    return "imported";
  } catch (error) {
    logger.warn("chesscom", `couldn't save game ${game.url}:`, error);
    return "failed";
  }
}
