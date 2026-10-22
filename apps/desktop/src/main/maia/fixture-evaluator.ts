import { makeUci } from "chessops/util";
import type { Role } from "chessops/types";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { Maia3Evaluator, Maia3Output, Maia3Query } from "@chaturanga/shared/engine/maia3";

/** White's winning chances the fixture reports for every position. */
export const FIXTURE_MAIA3_VALUE = 0.5;

const PROMOTIONS: readonly Role[] = ["queen", "rook", "bishop", "knight"];

/** Every legal move in `fen` in standard UCI (castling as `e1g1`), sorted alphabetically. */
function legalUcis(fen: string): string[] {
  let pos: ReturnType<typeof positionFromFen>;
  try {
    pos = positionFromFen(fen);
  } catch {
    throw new Error(`The Maia fixture can't read the position ${fen}.`);
  }
  const moves = new Set<string>();
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    for (const to of dests) {
      const lastRank = Math.floor(to / 8) === (pos.turn === "white" ? 7 : 0);
      const promotions = piece?.role === "pawn" && lastRank ? PROMOTIONS : [undefined];
      for (const promotion of promotions)
        moves.add(standardCastlingUci(fen, makeUci({ from, to, promotion })));
    }
  }
  return [...moves].sort();
}

/**
 * Maia 3's output for `query` as the e2e fixture makes it, without the model: the legal moves in
 * alphabetical UCI order, the k-th (from 0) weighted `1 / (k + 1)^(eloSelf / 1000)` and normalised
 * (so higher ratings concentrate on the first moves, and the rating curve isn't flat), and White's
 * winning chances fixed at {@link FIXTURE_MAIA3_VALUE}. An unreadable FEN throws.
 */
export function fixtureMaia3Output(query: Maia3Query): Maia3Output {
  const moves = legalUcis(query.fen);
  const sharpness = Math.max(0.1, query.eloSelf / 1000);
  const weights = moves.map((_, index) => 1 / (index + 1) ** sharpness);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    policy: Object.fromEntries(moves.map((uci, index) => [uci, weights[index] / total])),
    value: FIXTURE_MAIA3_VALUE
  };
}

/**
 * A stand-in for Maia 3 in end-to-end tests (`CHATURANGA_E2E_MAIA3=fixture`, see maia/index.ts):
 * always installed, answers at once with {@link fixtureMaia3Output}, so CI never downloads the
 * model. Same contract as the host: in order, abortable.
 */
export class FixtureMaia3Evaluator implements Maia3Evaluator {
  isInstalled(): boolean {
    return true;
  }

  evaluate(
    queries: readonly Maia3Query[],
    options: { signal?: AbortSignal } = {}
  ): Promise<Maia3Output[]> {
    if (options.signal?.aborted) return Promise.reject(new Error("The Maia request was aborted."));
    try {
      return Promise.resolve(queries.map(fixtureMaia3Output));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(): void {
    // Nothing to release.
  }
}
