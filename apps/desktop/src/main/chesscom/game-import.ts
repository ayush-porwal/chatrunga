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
 * Where the next import starts: the archive month last read (it may get more games) and the end
 * time (epoch seconds) of the newest game seen in it; games that ended at or before it were seen.
 */
export type ImportCursor = { month: ArchiveMonth; endTime: number };

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

/**
 * Imports the player's finished standard games into the library, a monthly archive at a time
 * (oldest first, one request at a time). The first import reaches back to `since`; later ones
 * continue from `cursor`. A game already there (same chess.com URL in its Site header) is skipped,
 * so re-running an import is harmless; variants (`rules` other than `chess`) are skipped too.
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
  const firstMonth = cursor ? cursor.month : archiveMonthOf(input.since);
  // Seen before: at or before the cursor; on a first import, before the window.
  const seen = (game: ChesscomGame) =>
    cursor ? game.endTime <= cursor.endTime : game.endTime * 1000 < input.since;
  let newest = cursor?.endTime ?? 0;
  // The earliest game that failed to import: the cursor stays before it, so it's tried again.
  const failure: { first: ImportCursor | null } = { first: null };
  let lastProgressAt = 0;
  for (const month of months.filter((month) => month >= firstMonth)) {
    signal?.throwIfAborted();
    const games = parseArchiveGames(
      await client.json(playerPath(username, `/games/${month}`), signal)
    );
    for (const game of games) {
      if (seen(game)) continue;
      newest = Math.max(newest, game.endTime);
      const outcome = importGame(repository, game);
      if (outcome === "imported") result.imported += 1;
      else result.skipped += 1;
      const first = failure.first;
      if (outcome === "failed" && (!first || first.month === month))
        failure.first = { month, endTime: Math.min(first?.endTime ?? game.endTime, game.endTime) };
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        input.onProgress?.(result.imported);
      }
    }
    result.nextCursor = { month, endTime: newest };
  }
  if (failure.first)
    result.nextCursor = { month: failure.first.month, endTime: failure.first.endTime - 1 };
  return result;
}

function importGame(
  repository: ImportRepository,
  game: ChesscomGame
): "imported" | "skipped" | "failed" {
  // Skipped for good: variants, games already in the library, games without a move.
  if (game.rules !== "chess") return "skipped";
  if (repository.findIdBySite(game.url)) return "skipped";
  if (!game.pgn) return "failed";
  try {
    // Strict: a move that can't be played fails the game (to be tried again), not cut it short.
    const { game: parsed } = importPgnText(game.pgn, { strict: true });
    if (parsed.moveTree.length < 2) return "skipped";
    // The game's page is its identity (chess.com's PGN names only "Chess.com" as the site).
    const headers = { ...parsed.headers, site: game.url };
    repository.saveImported(
      {
        ...parsed,
        id: null,
        source: "chesscom",
        headers,
        pgn: exportGameToPgn({ headers, moveTree: parsed.moveTree })
      },
      game.endTime * 1000
    );
    return "imported";
  } catch (error) {
    logger.warn("chesscom", `couldn't import game ${game.url}:`, error);
    return "failed";
  }
}
