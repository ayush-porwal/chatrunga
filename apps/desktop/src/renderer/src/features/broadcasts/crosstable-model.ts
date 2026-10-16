import type {
  BroadcastGame,
  BroadcastResult,
  BroadcastRoundDetail,
  BroadcastStanding
} from "@chaturanga/shared/types/broadcast";
import type { Color } from "@chaturanga/shared/types/chess";

/** A player's game of one round, from their side: whom they met (by place), and how it went. */
export type CrossCell = {
  game: BroadcastGame;
  color: Color;
  /** The opponent's place in the standings (1-based), or null for one not in them. */
  opponent: number | null;
  /** "1", "½" or "0" for the player; null while it is being played. */
  score: "1" | "½" | "0" | null;
};

/** A line of the crosstable: a player and their game of each round (null: none, or unread). */
export type CrossRow = { player: BroadcastStanding; place: number; cells: (CrossCell | null)[] };

function scoreFor(result: BroadcastResult, color: Color): CrossCell["score"] {
  if (result === "*") return null;
  if (result === "½-½") return "½";
  return (result === "1-0") === (color === "white") ? "1" : "0";
}

/**
 * The tournament's crosstable: the standings in their order, and for each round (`rounds` in
 * order, null for one not read yet) the game each player played in it, its result the streamed
 * one when there is one (`streamed`, by game id: newer than the round as read).
 */
export function crosstable(
  standings: readonly BroadcastStanding[],
  rounds: readonly (BroadcastRoundDetail | null)[],
  streamed: Partial<Record<string, { result: BroadcastResult }>> = {}
): CrossRow[] {
  const places = new Map(standings.map((player, index) => [player.name, index + 1]));
  return standings.map((player, index) => ({
    player,
    place: index + 1,
    cells: rounds.map((round) => {
      const game = round?.games.find(
        (item) => item.white.name === player.name || item.black.name === player.name
      );
      if (!game) return null;
      const color: Color = game.white.name === player.name ? "white" : "black";
      const opponent = color === "white" ? game.black : game.white;
      return {
        game,
        color,
        opponent: places.get(opponent.name) ?? null,
        score: scoreFor(streamed[game.id]?.result ?? game.result, color)
      };
    })
  }));
}
