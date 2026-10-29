/**
 * What the import preview adds for the practice home (docs/repertoire-games-and-practice.md §2):
 * each game's opening, first moves, lines and branching, and the positions where the PGN gives
 * the player more than one move (by transposition too). Read from the parsed games in main.
 */
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type ImportMultiMovePosition,
  type ImportPreviewGame,
  type RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { formatPath } from "@chaturanga/shared/chess/repertoire-pgn";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { ImportedGame } from "./import-job";
import { detectChapterOpening } from "./chapter-openings";

/** Moves (plies) of the mainline a preview row shows. */
const FIRST_MOVES_PLIES = 8;

type GameExtras = Required<
  Pick<ImportPreviewGame, "opening" | "firstMoves" | "lineCount" | "branching">
>;

/** A game's opening, first moves, lines and branching per side to move. */
export function gameExtras(game: ImportedGame): GameExtras {
  if (game.rejected || !game.tree.length) {
    return { opening: null, firstMoves: "", lineCount: 0, branching: { white: 0, black: 0 } };
  }
  const byId = new Map(game.tree.map((node) => [node.id, node]));
  const mainline: MoveNode[] = [];
  const seen = new Set<string>();
  for (
    let node = byId.get(REPERTOIRE_ROOT_NODE_ID);
    node?.children.length && !seen.has(node.id);
    node = byId.get(node.children[0])
  ) {
    seen.add(node.id);
    const next = byId.get(node.children[0]);
    if (next) mainline.push(next);
  }
  const path = mainline.slice(0, FIRST_MOVES_PLIES);
  const branching: Record<RepertoireColor, number> = { white: 0, black: 0 };
  let lineCount = 0;
  for (const item of game.tree) {
    if (!item.children.length && item.parentId !== null) lineCount += 1;
    if (item.children.length > 1) branching[playerToMove(item.fenAfter)] += 1;
  }
  return {
    opening: detectChapterOpening(game),
    firstMoves: `${formatPath(path)}${mainline.length > path.length ? " …" : ""}`,
    lineCount,
    branching
  };
}

/**
 * For a repertoire of each colour: the positions where the games give the player (the side to
 * move) more than one move, across every game, each move with the games that play it.
 */
export function multiMovePositions(
  games: readonly ImportedGame[]
): Record<RepertoireColor, ImportMultiMovePosition[]> {
  const moves = new Map<string, Map<string, { san: string; games: Set<number> }>>();
  for (const game of games) {
    if (game.rejected) continue;
    const byId = new Map(game.tree.map((node) => [node.id, node]));
    for (const node of game.tree) {
      const key = game.positionKeys[node.id];
      if (!key || !node.children.length) continue;
      let at = moves.get(key);
      for (const childId of node.children) {
        const child = byId.get(childId);
        if (!child?.uci) continue;
        if (!at) {
          at = new Map();
          moves.set(key, at);
        }
        const move = at.get(child.uci) ?? { san: child.san ?? child.uci, games: new Set() };
        move.games.add(game.index);
        at.set(child.uci, move);
      }
    }
  }
  const result: Record<RepertoireColor, ImportMultiMovePosition[]> = { white: [], black: [] };
  for (const [positionKey, at] of moves) {
    if (at.size < 2) continue;
    // The key's FEN part names the side to move ("v1:<placement> w …").
    const color: RepertoireColor = positionKey.split(" ")[1] === "b" ? "black" : "white";
    result[color].push({
      positionKey,
      moves: [...at].map(([uci, move]) => ({ uci, san: move.san, games: [...move.games] }))
    });
  }
  return result;
}
