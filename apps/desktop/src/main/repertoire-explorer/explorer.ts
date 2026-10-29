/**
 * Study's Explorer queries (docs/repertoire-games-and-practice.md §6.1–6.2): the user's games at a
 * position (from the position index), and Maia 3's likely moves there at a rating. Both mark the
 * moves the repertoire has at the position.
 */
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { buildChapterLookup, nodeMetaOf } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove, positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import {
  MAIA3_DEFAULT_RATING,
  nearestMaia3Rating,
  rankedMoves,
  type Maia3Evaluator
} from "@chaturanga/shared/engine/maia3";
import type { MaiaMoveProb } from "@chaturanga/shared/types/engine";
import type {
  ExplorerGames,
  ExplorerMaiaInput,
  ExplorerMaiaMoves,
  ExplorerPositionInput,
  ExplorerRatingSource
} from "@chaturanga/shared/types/repertoire-explorer";
import type { PlayerRatings, RatingMode } from "@chaturanga/shared/types/ratings";
import type { InsightsFilters } from "@chaturanga/shared/types/repertoire-insights";
import { requireRepertoire } from "../repertoire/core";
import { chapterRepository, positionIndexRepository } from "../repertoire/repository";
import { gamePositionIndex } from "./position-index";

/** Maia's moves are listed until they cover this much of its weight… */
const MAIA_COVERAGE = 0.9;
/** …or this many. */
const MAIA_MAX_MOVES = 8;
/** The user's recent games whose rating the default reads (their median). */
const RECENT_RATED_GAMES = 20;

/** `uci` in SAN from `fen` (castling either way); the UCI itself when it isn't legal there. */
export function sanAt(fen: string, uci: string): string {
  try {
    const position = positionFromFen(fen);
    const move = parseUci(standardCastlingUci(fen, uci));
    return move && position.isLegal(move) ? makeSan(position, move) : uci;
  } catch {
    return uci;
  }
}

/**
 * The moves the repertoire has at a position (standard UCI): every occurrence's children that are
 * neither study-only nor disabled.
 */
function repertoireMovesAt(repertoireId: string, key: string): Set<string> {
  const moves = new Set<string>();
  const chapterIds = new Map<string, string[]>();
  for (const { chapterId, nodeId } of positionIndexRepository.occurrences(repertoireId, key)) {
    chapterIds.set(chapterId, [...(chapterIds.get(chapterId) ?? []), nodeId]);
  }
  for (const [chapterId, nodeIds] of chapterIds) {
    const chapter = chapterRepository.get(chapterId);
    if (!chapter) continue;
    const lookup = buildChapterLookup(chapter);
    for (const nodeId of nodeIds) {
      for (const childId of lookup.childrenById.get(nodeId) ?? []) {
        const child = lookup.nodesById.get(childId);
        const meta = nodeMetaOf(chapter.nodeMeta, childId);
        if (!child?.uci || meta.disabled || meta.edge === "reference") continue;
        moves.add(standardCastlingUci(child.fenBefore, child.uci));
      }
    }
  }
  return moves;
}

/** The user's games at a position under the Insights filters (§6.1). */
export function explorerGames(
  input: ExplorerPositionInput,
  filters: InsightsFilters,
  indexing: { done: number; total: number } | null,
  now: number = Date.now()
): ExplorerGames {
  requireRepertoire(input.repertoireId);
  const key = positionKey(input.fen);
  const inRepertoire = repertoireMovesAt(input.repertoireId, key);
  return {
    moves: gamePositionIndex.moves(key, filters, now).map((row) => {
      const decided = row.wins + row.draws + row.losses;
      return {
        ...row,
        san: sanAt(input.fen, row.uci),
        score: decided ? (row.wins + row.draws / 2) / decided : null,
        inRepertoire: inRepertoire.has(row.uci)
      };
    }),
    filters,
    indexing
  };
}

/** Maia's likeliest moves until they cover 90% of its weight, at most 8 (§6.2). */
export function likelyMoves(
  policy: Readonly<Record<string, number>>,
  coverage: number = MAIA_COVERAGE,
  max: number = MAIA_MAX_MOVES
): MaiaMoveProb[] {
  const picked: MaiaMoveProb[] = [];
  let covered = 0;
  for (const move of rankedMoves(policy)) {
    if (picked.length >= max || covered >= coverage) break;
    picked.push(move);
    covered += move.prob;
  }
  return picked;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * The user's rating at `mode` (§6.2): Settings → Ratings when it was set (typed in, or synced from
 * an account), else the median of their recent games' ratings, else Maia's default.
 */
export function defaultRating(
  mode: RatingMode,
  ratings: PlayerRatings,
  ratingsSet: boolean,
  recentRatings: readonly number[]
): { rating: number; source: ExplorerRatingSource } {
  const setting = ratings[mode];
  if (ratingsSet || setting.source !== "manual")
    return { rating: setting.rating, source: "settings" };
  const fromGames = median(recentRatings);
  if (fromGames !== null) return { rating: fromGames, source: "games" };
  return { rating: MAIA3_DEFAULT_RATING, source: "default" };
}

export type UserRatingDeps = {
  playerRatings(): PlayerRatings;
  /** Whether Settings → Ratings was ever saved. */
  ratingsSet(): boolean;
};

/** The mode the user plays most (rapid without games), and their rating at it. */
export function userRating(
  deps: UserRatingDeps,
  mode: RatingMode | null = null
): { rating: number; mode: RatingMode; source: ExplorerRatingSource } {
  const chosen = mode ?? gamePositionIndex.mostPlayedMode() ?? "rapid";
  return {
    mode: chosen,
    ...defaultRating(
      chosen,
      deps.playerRatings(),
      deps.ratingsSet(),
      gamePositionIndex.recentRatings(chosen, RECENT_RATED_GAMES)
    )
  };
}

/** Maia 3's likely moves at a position (§6.2); `installed: false` when the model isn't there. */
export async function explorerMaiaMoves(
  input: ExplorerMaiaInput,
  maia: Pick<Maia3Evaluator, "evaluate" | "isInstalled">,
  ratingDeps: UserRatingDeps
): Promise<ExplorerMaiaMoves> {
  const repertoire = requireRepertoire(input.repertoireId);
  if (!maia.isInstalled()) return { installed: false };
  const user = userRating(ratingDeps, input.mode);
  const rating = nearestMaia3Rating(input.rating ?? user.rating);
  // The user is waiting on it, as on an engine game's move.
  const [output] = await maia.evaluate([{ fen: input.fen, eloSelf: rating, eloOppo: rating }], {
    priority: "game"
  });
  const inRepertoire = repertoireMovesAt(input.repertoireId, positionKey(input.fen));
  return {
    installed: true,
    rating,
    mode: user.mode,
    defaultRating: nearestMaia3Rating(user.rating),
    ratingSource: user.source,
    opponentToMove: playerToMove(input.fen) !== repertoire.color,
    moves: likelyMoves(output.policy).map(({ uci, prob }) => {
      const standard = standardCastlingUci(input.fen, uci);
      return {
        uci: standard,
        san: sanAt(input.fen, standard),
        probability: prob,
        inRepertoire: inRepertoire.has(standard)
      };
    })
  };
}
