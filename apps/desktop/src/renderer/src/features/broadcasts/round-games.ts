import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { BroadcastGame, BroadcastRoundDetail } from "@chaturanga/shared/types/broadcast";
import { roundQueryOptions } from "../../queries/broadcasts";
import type { StreamedGame } from "../../stores/broadcast-store";
import { boardModel } from "./board-state";
import { nameMatches, playerLabel, resultText } from "./broadcast-text";
import type { TournamentTarget } from "./navigation";

/** A game of a round already read, as a list shows it (the streamed position when there is one). */
export type RoundGameEntry = {
  key: string;
  gameId: string;
  /** Its round on the tournament page, the board outlined. */
  target: TournamentTarget;
  white: string;
  black: string;
  where: string;
  fen: string;
  lastMove: string | null;
  status: string;
  live: boolean;
};

/** The games of `rounds` that `matches` keeps, games being played first. */
export function roundGamesWhere(
  rounds: readonly BroadcastRoundDetail[],
  streamed: Partial<Record<string, StreamedGame>>,
  matches: (game: BroadcastGame) => boolean
): RoundGameEntry[] {
  const entries: RoundGameEntry[] = [];
  for (const detail of rounds) {
    detail.games.forEach((game, index) => {
      if (!matches(game)) return;
      // Only the position and result are shown: when the summary was read doesn't matter.
      const board = boardModel(game, streamed[game.id], 0);
      entries.push({
        key: `${detail.round.id}/${game.id}`,
        gameId: game.id,
        target: { tourId: detail.tour.id, roundId: detail.round.id, focusGameId: game.id },
        white: playerLabel(game.white),
        black: playerLabel(game.black),
        where: `${detail.tour.name} · ${detail.round.name} · Board ${index + 1}`,
        fen: board.fen,
        lastMove: board.lastMove,
        status: resultText(board.result),
        live: board.result === "*"
      });
    });
  }
  return entries.sort((a, b) => Number(b.live) - Number(a.live));
}

/** Whether a game's white or black player is one of `names`. */
export function playsIn(game: BroadcastGame, names: readonly string[]): boolean {
  return names.some(
    (name) => nameMatches(game.white.name, name) || nameMatches(game.black.name, name)
  );
}

/** The rounds read so far (structurally shared: the same array while nothing changed). */
function roundsRead(results: UseQueryResult<BroadcastRoundDetail>[]): BroadcastRoundDetail[] {
  return results.flatMap((result) => (result.data ? [result.data] : []));
}

/** The details of `roundIds` (the hub's live cards read them: no request of their own). */
export function useRoundsRead(roundIds: readonly string[], enabled = true): BroadcastRoundDetail[] {
  return useQueries({
    queries: roundIds.map((roundId) => ({ ...roundQueryOptions(roundId), enabled })),
    combine: roundsRead
  });
}
