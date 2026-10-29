/**
 * Where Insights' buttons go (docs/repertoire-games-and-practice.md §5.2): Study with the From
 * your games banner (and the reply staged for Prepare), weak-spots practice, Game review at the
 * move, and the Games card's filters. Pure target builders, and the actions' shape.
 */
import type { Color } from "@chaturanga/shared/types/chess";
import type {
  InsightsForgotSpot,
  InsightsGamesQuery,
  InsightsUnpreparedReply
} from "@chaturanga/shared/types/repertoire-insights";
import type { StudyOpenTarget } from "../repertoire-chapters";
import type { InsightsReviewFocus } from "./insights-return";

/** Game review of a listed game at the move a row is about (Back to Insights returns). */
export type InsightsReviewTarget = {
  gameId: string;
  /** The ply to show (null: the game's start). */
  ply: number | null;
  /** The repertoire and colour to compare with on the review's Opening section. */
  repertoireId: string | null;
  color: Color | null;
  /** What the review's "From your games" band says and offers (null: nothing to say). */
  focus: InsightsReviewFocus | null;
};

/** Weak-spots practice: every forgotten position (null), or one (a row's Practise). */
export type WeakSpotsTarget = { repertoireId: string; positionKey: string } | null;

/** The Games card's filters a report row or bar segment sets (the rest are cleared). */
type GamesFilter = Pick<InsightsGamesQuery, "repertoireId" | "positionKey" | "uci" | "outcomes">;

export type InsightsActions = {
  practise: (spot: InsightsForgotSpot | null) => void;
  studyForgot: (spot: InsightsForgotSpot) => void;
  prepare: (reply: InsightsUnpreparedReply) => void;
  study: (target: StudyOpenTarget) => void;
  reviewGame: (target: InsightsReviewTarget) => void;
  showGames: (filter: GamesFilter) => void;
  openSettings: () => void;
};

/** Study at a forgotten position, with what the user played there and the repertoire's moves. */
export function forgotStudyTarget(spot: InsightsForgotSpot): StudyOpenTarget | null {
  if (!spot.study) return null;
  return {
    repertoireId: spot.repertoireId,
    ...spot.study,
    tab: "moves",
    fromGames: {
      kind: "forgot",
      positionKey: spot.positionKey,
      played: spot.played,
      expectedSans: spot.expected.map((move) => move.san)
    }
  };
}

/** Study at the position before an unprepared reply, with the reply staged. */
export function prepareStudyTarget(reply: InsightsUnpreparedReply): StudyOpenTarget | null {
  if (!reply.study) return null;
  return {
    repertoireId: reply.repertoireId,
    ...reply.study,
    tab: "moves",
    stage: { nodeId: reply.study.nodeId, uci: reply.reply.uci },
    fromGames: {
      kind: "unprepared",
      positionKey: reply.positionKey,
      reply: { ...reply.reply, games: reply.games }
    }
  };
}
