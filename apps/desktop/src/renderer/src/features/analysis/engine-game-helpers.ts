import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { MoveNode } from "@chaturanga/shared/types/chess";

/** A castling move as chessops writes it, the king taking its own rook (`e1h1`), or a move that looks like one. */
const KING_ONTO_ROOK = /^(e1[ah]1|e8[ah]8)$/;

/**
 * The moves from the root to `nodeId`, in UCI as an engine reads it. Walks an id index (runs
 * before every engine search). Castling goes as the king's two-square move (`e1g1`): a game read
 * from a PGN stores it as chessops writes it, the king taking its rook (`e1h1`), which Stockfish
 * refuses as illegal (Stockfish 19 quits on it; older ones stopped reading the moves there and
 * searched an earlier position).
 */
export function currentLineUcis(moveTree: MoveNode[], nodeId: string): string[] {
  const byId = new Map(moveTree.map((item) => [item.id, item]));
  const reversed: string[] = [];
  let node = byId.get(nodeId);
  while (node && node.parentId) {
    if (node.uci)
      reversed.push(
        KING_ONTO_ROOK.test(node.uci) ? standardCastlingUci(node.fenBefore, node.uci) : node.uci
      );
    node = byId.get(node.parentId);
  }
  return reversed.reverse();
}
