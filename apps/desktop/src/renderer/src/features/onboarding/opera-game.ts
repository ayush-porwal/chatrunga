import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";

/**
 * Paul Morphy vs Duke Karl of Brunswick and Count Isouard, Paris 1858: the "Opera game".
 * Public domain. The welcome's board follows it from step to step as illustration: short
 * (17 moves), decisive, and famous for 16.Qb8+!, a queen sacrifice that forces mate.
 */
const OPERA_GAME_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`;

let mainline: MoveNode[] | null = null;

/** The game's main-line nodes (index = ply; 0 is the start position). Parsed once. */
export function operaGameMainline(): MoveNode[] {
  if (mainline) return mainline;
  const { game } = importPgnText(OPERA_GAME_PGN);
  const byId = new Map(game.moveTree.map((node) => [node.id, node]));
  const nodes: MoveNode[] = [];
  let node = game.moveTree.find((item) => item.parentId === null);
  while (node) {
    nodes.push(node);
    node = node.children[0] ? byId.get(node.children[0]) : undefined;
  }
  mainline = nodes;
  return nodes;
}

/** Moments of the game the welcome's board shows, one per step. */
export type OperaMoment = {
  ply: number;
  /** "10.Nxb5" */
  label: string;
  /** A coach-style note on the move, or null for a quiet caption only. */
  note: string | null;
};

export function operaGameMoment(
  ply: number,
  note: string | null = null
): OperaMoment & { fen: string; uci: string | null } {
  const nodes = operaGameMainline();
  const node = nodes[Math.max(0, Math.min(nodes.length - 1, ply))];
  const moveNumber = Math.ceil(node.ply / 2);
  const label = node.san ? `${moveNumber}${node.ply % 2 === 1 ? "." : "…"}${node.san}` : "Start";
  return { ply: node.ply, label, note, fen: node.fenAfter, uci: node.uci };
}
