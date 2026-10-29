/**
 * The `repertoireInsights.*` IPC inputs, checked (they come from the renderer) and rebuilt from
 * known fields only.
 */
import { isOneOf } from "@chaturanga/shared/types/guards";
import { RATING_MODES } from "@chaturanga/shared/types/ratings";
import {
  INSIGHTS_ACCOUNTS,
  INSIGHTS_LINE_MOVES,
  INSIGHTS_OUTCOMES,
  INSIGHTS_PERIODS,
  type InsightsFilters,
  type InsightsGamesQuery,
  type InsightsReportQuery
} from "@chaturanga/shared/types/repertoire-insights";
import {
  asBoolean,
  asId,
  asIntegerInRange,
  asMembers,
  asObject,
  fail,
  nullable,
  UCI_MOVE
} from "./fields";

/** The deepest "up to move" the games list filters by. */
const MAX_UP_TO_MOVE = 100;
const MAX_PAGE = 100_000;
const MAX_POSITION_KEY = 200;

export function parseInsightsFilters(value: unknown): InsightsFilters {
  const input = asObject(value, "Insights filters");
  if (!isOneOf(INSIGHTS_PERIODS, input.period))
    fail("period", `expected ${INSIGHTS_PERIODS.join(", ")}`);
  let since: string | null = null;
  if (input.period === "since") {
    if (typeof input.since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.since))
      fail("since", "expected a date (YYYY-MM-DD)");
    since = input.since;
  }
  return {
    period: input.period,
    since,
    timeControls: asMembers(input.timeControls, "time controls", RATING_MODES),
    ratedOnly: asBoolean(input.ratedOnly, "rated only"),
    accounts: asMembers(input.accounts, "accounts", INSIGHTS_ACCOUNTS)
  };
}

export function parseInsightsReportQuery(value: unknown): InsightsReportQuery {
  const input = asObject(value, "Insights report query");
  if (!isOneOf(INSIGHTS_LINE_MOVES, input.lineMove))
    fail("line move", `expected ${INSIGHTS_LINE_MOVES.join(", ")}`);
  return { lineMove: input.lineMove };
}

export function parseInsightsGamesQuery(value: unknown): InsightsGamesQuery {
  const input = asObject(value, "Insights games query");
  const query: InsightsGamesQuery = { page: asIntegerInRange(input.page, "page", 0, MAX_PAGE) };
  const color = nullable(input.color, (item) => {
    if (item !== "white" && item !== "black") fail("colour", "expected white or black");
    return item;
  });
  const outcomes = nullable(input.outcomes, (items) =>
    asMembers(items, "outcomes", INSIGHTS_OUTCOMES)
  );
  const repertoireId = nullable(input.repertoireId, (item) => asId(item, "repertoire id"));
  const upToMove = nullable(input.upToMove, (item) =>
    asIntegerInRange(item, "up to move", 1, MAX_UP_TO_MOVE)
  );
  const positionKey = nullable(input.positionKey, (item) => {
    if (typeof item !== "string" || !item || item.length > MAX_POSITION_KEY)
      fail("position key", "expected a position key");
    return item;
  });
  const uci = nullable(input.uci, (item) => {
    if (typeof item !== "string" || !UCI_MOVE.test(item)) fail("move", "expected a UCI move");
    return item;
  });
  if (color) query.color = color;
  if (outcomes?.length) query.outcomes = outcomes;
  if (repertoireId) query.repertoireId = repertoireId;
  if (upToMove) query.upToMove = upToMove;
  if (positionKey) query.positionKey = positionKey;
  if (uci) query.uci = uci;
  return query;
}
