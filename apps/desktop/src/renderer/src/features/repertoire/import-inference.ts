import type {
  ImportPreview,
  ImportSelection,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { openingFamily } from "@chaturanga/shared/types/repertoire-practice";

/**
 * What the import preview suggests and counts (docs/repertoire-games-and-practice.md §2): a new
 * repertoire's name (its most common opening family) and colour (the PGN's `Orientation` tag,
 * else the side whose moves branch less), and the strip's three counts for the chosen colour.
 * Pure.
 */

/** The opening family most of the games share (ties: the first seen); "" when none is known. */
export function suggestedName(games: ImportPreview["games"]): string {
  const counts = new Map<string, number>();
  for (const game of games) {
    const name = game.opening?.name;
    if (name) counts.set(openingFamily(name), (counts.get(openingFamily(name)) ?? 0) + 1);
  }
  let best = "";
  let most = 0;
  for (const [family, count] of counts) {
    if (count > most) {
      best = family;
      most = count;
    }
  }
  return best;
}

/**
 * The colour the PGN is for: the `Orientation` tag most games carry (a Lichess study export), else
 * the side whose moves branch less (the player's own moves seldom branch; replies do).
 */
export function suggestedColor(games: ImportPreview["games"]): RepertoireColor {
  let white = 0;
  let black = 0;
  for (const game of games) {
    // Headers hold only the tags the game has: most have no Orientation.
    const tag = Object.hasOwn(game.headers, "Orientation")
      ? game.headers.Orientation.trim().toLowerCase()
      : null;
    if (tag === "white") white += 1;
    if (tag === "black") black += 1;
  }
  if (white !== black) return white > black ? "white" : "black";
  const branching = games.reduce(
    (total, game) => ({
      white: total.white + (game.branching?.white ?? 0),
      black: total.black + (game.branching?.black ?? 0)
    }),
    { white: 0, black: 0 }
  );
  return branching.black < branching.white ? "black" : "white";
}

export type ImportStats = {
  /** Moves the included games add. */
  newMoves: number;
  /** Your moves to practise (each included opening game's decisions). */
  practiceMoves: number;
  /** Positions where the included games give you more than one move. */
  severalMoves: number;
  /** The games those positions come from (the "Show" filter). */
  severalMovesGames: number[];
};

export function importStats(
  preview: ImportPreview,
  selections: readonly ImportSelection[],
  color: RepertoireColor
): ImportStats {
  const included = new Set(selections.filter((item) => item.include).map((item) => item.gameIndex));
  const kinds = new Map(selections.map((item) => [item.gameIndex, item.kind]));
  let newMoves = 0;
  let practiceMoves = 0;
  for (const game of preview.games) {
    if (!included.has(game.index)) continue;
    newMoves += game.nodeCount;
    if (kinds.get(game.index) === "opening") practiceMoves += game.decisions[color];
  }
  const games = new Set<number>();
  let severalMoves = 0;
  for (const position of preview.multiMovePositions?.[color] ?? []) {
    const moves = position.moves.filter((move) => move.games.some((index) => included.has(index)));
    if (moves.length < 2) continue;
    severalMoves += 1;
    for (const move of moves) {
      for (const index of move.games) if (included.has(index)) games.add(index);
    }
  }
  return {
    newMoves,
    practiceMoves,
    severalMoves,
    severalMovesGames: [...games].sort((a, b) => a - b)
  };
}
