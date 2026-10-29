import { applySan, applyUserMove } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { userMoveFromUci } from "@/lib/uci";
import { useGameStore } from "../../stores/game-store";
import { activeBestLine, type BestLineStep } from "../game/best-line-cursor";
import { activeScratchLine, type ScratchLine } from "../game/scratch-line";

/*
 * Playing into Game review's scratch line (see game/scratch-line.ts): moves made on the review
 * board, a coach's line clicked, a live engine line picked. The game's move tree never changes;
 * the game store only shows the line (showScratchLine).
 */

/** One move (SAN, or UCI with any promotion letter) played from `fen`; null when it isn't legal there. */
export function scratchStep(fen: string, move: string): BestLineStep | null {
  try {
    const userMove = userMoveFromUci(move);
    const applied = userMove ? applyUserMove(fen, userMove) : applySan(fen, move);
    return applied ? { san: applied.san, uci: applied.uci, fenAfter: applied.fen } : null;
  } catch {
    return null;
  }
}

/**
 * The line with `step` played from the move on the board: the moves after it are dropped, unless
 * the next one is that same move (the line then steps on to it, keeping the rest).
 */
export function playOnScratchLine(line: ScratchLine, step: BestLineStep): ScratchLine {
  if (line.moves.at(line.index + 1)?.uci === step.uci) return { ...line, index: line.index + 1 };
  const moves = [...line.moves.slice(0, line.index + 1), step];
  return { ...line, moves, index: moves.length - 1 };
}

/**
 * Where `moves` (SAN or UCI) played from `startNodeId` lead: the game moves they follow (main line
 * or a variation already in the tree), then the rest of them as moves off the game. `node` is the
 * last game move followed; `rest` is empty when the whole line is the game's own. Null for an
 * unknown start or an illegal move.
 */
export function followGameMoves(
  moveTree: readonly MoveNode[],
  startNodeId: string,
  moves: readonly string[]
): { node: MoveNode; rest: BestLineStep[] } | null {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const start = byId.get(startNodeId);
  if (!start) return null;
  let node: MoveNode = start;
  const rest: BestLineStep[] = [];
  let fen = node.fenAfter;
  for (const move of moves) {
    const step = scratchStep(fen, move);
    if (!step) return null;
    fen = step.fenAfter;
    if (!rest.length) {
      const existing: MoveNode | undefined = node.children
        .map((childId) => byId.get(childId))
        .find((child) => child && (child.uci === step.uci || child.fenAfter === step.fenAfter));
      if (existing) {
        node = existing;
        continue;
      }
    }
    rest.push(step);
  }
  return { node, rest };
}

/**
 * Game review's board: plays a move (UCI or SAN) on the position shown without changing the game.
 * A game move it repeats is simply gone to; otherwise it goes into the scratch line (started at the
 * current move, or from a BEST line's position with that line up to it). False when it is illegal
 * there.
 */
export function playScratchMove(move: string): boolean {
  const game = useGameStore.getState();
  const step = scratchStep(game.currentFen, move);
  if (!step) return false;
  const scratch = activeScratchLine(game);
  if (scratch) {
    game.showScratchLine(playOnScratchLine(scratch, step));
    return true;
  }
  const best = activeBestLine(game);
  if (best) {
    const moves = [...best.moves.slice(0, best.index + 1), step];
    game.showScratchLine({
      originNodeId: best.markedNodeId,
      anchorNodeId: best.anchorNodeId,
      moves,
      index: moves.length - 1
    });
    return true;
  }
  return playScratchLine(game.currentNodeId, game.currentNodeId, [move]);
}

/**
 * A coach's line (SAN or UCI from `startNodeId`): the game moves it follows are gone to, the rest is
 * shown as a scratch line, the panels staying on `originNodeId` (the move it was clicked from). The
 * tree is not changed. False (and nothing changes) for an unknown move or an illegal line.
 */
export function playScratchLine(
  originNodeId: string,
  startNodeId: string,
  moves: readonly string[]
): boolean {
  const game = useGameStore.getState();
  const followed = followGameMoves(game.moveTree, startNodeId, moves);
  if (!followed) return false;
  const { node, rest } = followed;
  if (!rest.length) {
    game.goToNode(node.id);
    return true;
  }
  // Panels stay on the move the line was asked from (a move of the tree), else where it branches.
  const origin = game.moveTree.some((item) => item.id === originNodeId) ? originNodeId : node.id;
  game.showScratchLine({
    originNodeId: origin,
    anchorNodeId: node.id,
    moves: rest,
    index: rest.length - 1
  });
  return true;
}
