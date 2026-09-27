import { exportGameToPgn, importPgnText } from "@chaturanga/shared/chess/pgn";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import { logger } from "../logger";
import type { LichessClient } from "./http";

/** The first import reaches back a year. */
export const FIRST_SYNC_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 250;
/** Variants our board can't replay are skipped (`fromPosition` is standard chess from a FEN). */
const IMPORTABLE_VARIANTS = new Set(["standard", "fromPosition"]);

export type ImportRepository = {
  findIdBySite(site: string): string | null;
  saveImported(input: SaveGameInput, playedAt: number): unknown;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  /** `since` for the next import (one past the newest last move seen), null when none was seen. */
  nextSince: number | null;
};

export function sinceForSync(syncSince: number | null, now: number): number {
  return syncSince ?? now - FIRST_SYNC_WINDOW_MS;
}

export function lichessGameUrl(gameId: string): string {
  return `https://lichess.org/${gameId}`;
}

/**
 * Streams the user's finished games played since `since` into the library. A game already there
 * (same Lichess URL in its Site header) is skipped, so re-running an import is harmless.
 */
export async function importLichessGames(input: {
  client: Pick<LichessClient, "stream">;
  repository: ImportRepository;
  username: string;
  since: number;
  signal?: AbortSignal;
  onProgress?: (imported: number) => void;
}): Promise<ImportResult> {
  const params = new URLSearchParams({
    since: String(input.since),
    pgnInJson: "true",
    clocks: "true",
    opening: "true",
    finished: "true"
  });
  const result: ImportResult = { imported: 0, skipped: 0, nextSince: null };
  let lastProgressAt = 0;
  await input.client.stream(
    `/api/games/user/${encodeURIComponent(input.username)}?${params.toString()}`,
    { signal: input.signal },
    (line) => {
      const game = line as {
        id?: unknown;
        pgn?: unknown;
        variant?: unknown;
        lastMoveAt?: unknown;
        createdAt?: unknown;
      };
      if (typeof game.id !== "string" || !game.id) return;
      const playedAt =
        typeof game.lastMoveAt === "number"
          ? game.lastMoveAt
          : typeof game.createdAt === "number"
            ? game.createdAt
            : null;
      if (playedAt !== null) result.nextSince = Math.max(result.nextSince ?? 0, playedAt + 1);
      if (importGame(input.repository, game.id, game.pgn, game.variant, playedAt ?? Date.now()))
        result.imported += 1;
      else result.skipped += 1;
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        input.onProgress?.(result.imported);
      }
    }
  );
  return result;
}

function importGame(
  repository: ImportRepository,
  gameId: string,
  pgn: unknown,
  variant: unknown,
  playedAt: number
): boolean {
  const site = lichessGameUrl(gameId);
  if (typeof pgn !== "string" || (typeof variant === "string" && !IMPORTABLE_VARIANTS.has(variant)))
    return false;
  if (repository.findIdBySite(site)) return false;
  try {
    const { game } = importPgnText(pgn);
    // Aborted before a move (or unreadable): nothing to review.
    if (game.moveTree.length < 2) return false;
    const headers = { ...game.headers, site };
    repository.saveImported(
      {
        ...game,
        id: null,
        source: "lichess",
        headers,
        pgn: exportGameToPgn({ headers, moveTree: game.moveTree })
      },
      playedAt
    );
    return true;
  } catch (error) {
    logger.warn("lichess", `skipped game ${gameId}:`, error);
    return false;
  }
}
