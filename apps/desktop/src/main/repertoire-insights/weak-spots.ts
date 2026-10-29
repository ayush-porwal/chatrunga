/**
 * Weak-spots practice's data (docs/repertoire-games-and-practice.md §5.5), under the saved
 * Insights filters: the positions where the user left a repertoire in real games, most games
 * first, and how often opponents played each reply at each position in games against it. The
 * practice queue (Practice's `weak` mode) builds its cards from these; nothing here schedules.
 */
import { rootPly } from "@chaturanga/shared/chess/pgn";
import { forgotSpots, insightsGames } from "./report";

/** A position where the user left their repertoire in real games. */
export type WeakSpotPosition = {
  repertoireId: string;
  positionKey: string;
  /** The position, reached by playing `leadUp` from `rootFen`. */
  fen: string;
  /** The games (under the filters) in which the user played something else here. */
  games: number;
  /**
   * What to replay to reach it: the moves (UCI) the games took most often, from `rootFen` (the
   * games' start, usually the initial position). The practice card's own lead-up may come from
   * the repertoire's chapter instead (`chapterId` and `nodeId`, when it still has the position).
   */
  rootFen: string;
  leadUp: string[];
  chapterId: string | null;
  nodeId: string | null;
  /** The repertoire's moves there (UCI). */
  expectedUcis: string[];
  /** What the user played instead (UCI), most games first. */
  played: { uci: string; games: number }[];
};

/**
 * The forgotten positions, most games first (ties: the most recently seen first). With
 * `repertoireId`, that repertoire's only; with `positionKey` too, that position only (a report
 * row's Practise).
 */
export function weakSpotPositions(
  options: { repertoireId?: string; positionKey?: string } = {},
  now: number = Date.now()
): WeakSpotPosition[] {
  return forgotSpots(insightsGames(now, options.repertoireId))
    .filter((spot) => !options.positionKey || spot.positionKey === options.positionKey)
    .map((spot) => ({
      repertoireId: spot.repertoireId,
      positionKey: spot.positionKey,
      fen: spot.fen,
      games: spot.games,
      rootFen: spot.rootFen,
      leadUp: spot.line.map((move) => move.uci),
      chapterId: spot.study?.chapterId ?? null,
      nodeId: spot.study?.nodeId ?? null,
      expectedUcis: spot.expected.map((move) => move.uci),
      played: spot.played.map((move) => ({ uci: move.uci, games: move.games }))
    }));
}

/**
 * How often opponents played each move at each position, in the user's games against
 * `repertoireId` (whose outcome comes from it), while those games were in the repertoire: by
 * position key, the replies most played first (ties keep the order first seen). Replies the
 * repertoire doesn't cover are counted too; the rehearsal picks among the covered ones.
 */
export function replyFrequencies(
  repertoireId: string,
  now: number = Date.now()
): Map<string, { uci: string; games: number }[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const { best } of insightsGames(now, repertoireId)) {
    if (!best.color) continue;
    const firstPly = rootPly(best.rootFen ?? "") + 1;
    best.moves.forEach((move, index) => {
      // Odd plies are White's moves.
      const mover = (firstPly + index) % 2 === 1 ? "white" : "black";
      if (mover === best.color) return;
      let replies = counts.get(move.key);
      if (!replies) counts.set(move.key, (replies = new Map<string, number>()));
      replies.set(move.uci, (replies.get(move.uci) ?? 0) + 1);
    });
  }
  return new Map(
    [...counts].map(([key, replies]) => [
      key,
      [...replies].map(([uci, games]) => ({ uci, games })).sort((a, b) => b.games - a.games)
    ])
  );
}
