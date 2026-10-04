import { applySan } from "@chaturanga/shared/chess/position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";
import { currentLineUcis } from "../analysis/engine-game-helpers";
import type { AnalysisTarget } from "../analysis/live-analysis";

/**
 * Study's engine panel: what live analysis searches for the selected move (the chapter's route to
 * it from its root, so the engine knows the game's history) and how a picked engine line becomes
 * chapter moves.
 */

/** The analysis target for `node` of `chapter`: owned by the chapter, so another chapter is another search. */
export function studyAnalysisTarget(
  chapter: Pick<RepertoireChapter, "id" | "rootFen" | "tree">,
  node: Pick<MoveNode, "id" | "fenAfter">
): AnalysisTarget {
  return {
    owner: `study:${chapter.id}`,
    nodeId: node.id,
    rootFen: chapter.rootFen,
    moves: currentLineUcis(chapter.tree, node.id),
    fen: node.fenAfter
  };
}

/**
 * An engine line's SAN moves (as its row shows them) from `fen`, in UCI for the chapter (castling
 * as the king's two-square move, as the chapter stores it); null when a move isn't legal where
 * it's played (the line no longer fits the position).
 */
export function sanLineToUcis(fen: string, sans: readonly string[]): string[] | null {
  const ucis: string[] = [];
  let position = fen;
  for (const san of sans) {
    let played: ReturnType<typeof applySan>;
    try {
      played = applySan(position, san);
    } catch {
      return null;
    }
    if (!played) return null;
    ucis.push(standardCastlingUci(position, played.uci));
    position = played.fen;
  }
  return ucis;
}
