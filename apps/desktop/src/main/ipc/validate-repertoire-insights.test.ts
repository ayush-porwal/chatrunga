import { DEFAULT_INSIGHTS_FILTERS } from "@chaturanga/shared/types/repertoire-insights";
import { describe, expect, it } from "vitest";
import {
  parseInsightsFilters,
  parseInsightsGamesQuery,
  parseInsightsReportQuery
} from "./validate-repertoire-insights";

describe("Insights IPC inputs", () => {
  it("accepts the filters, each choice once, and a date only for Since", () => {
    expect(parseInsightsFilters({ ...DEFAULT_INSIGHTS_FILTERS, extra: 1 })).toStrictEqual(
      DEFAULT_INSIGHTS_FILTERS
    );
    expect(
      parseInsightsFilters({
        period: "since",
        since: "2026-01-31",
        timeControls: ["blitz", "blitz"],
        ratedOnly: true,
        accounts: ["imported"]
      })
    ).toStrictEqual({
      period: "since",
      since: "2026-01-31",
      timeControls: ["blitz"],
      ratedOnly: true,
      accounts: ["imported"]
    });
    expect(
      parseInsightsFilters({ ...DEFAULT_INSIGHTS_FILTERS, since: "2026-01-31" }).since
    ).toBeNull();
    expect(() => parseInsightsFilters({ ...DEFAULT_INSIGHTS_FILTERS, period: "since" })).toThrow(
      /since/
    );
    expect(() => parseInsightsFilters({ ...DEFAULT_INSIGHTS_FILTERS, accounts: ["fics"] })).toThrow(
      /accounts/
    );
  });

  it("accepts the report's line move and the games list's own filters", () => {
    expect(parseInsightsReportQuery({ lineMove: 4 })).toStrictEqual({ lineMove: 4 });
    expect(() => parseInsightsReportQuery({ lineMove: 9 })).toThrow(/line move/);
    expect(parseInsightsGamesQuery({ page: 0, color: null, outcomes: null })).toStrictEqual({
      page: 0
    });
    expect(
      parseInsightsGamesQuery({
        page: 2,
        color: "black",
        outcomes: ["in-book", "ended-in-book"],
        repertoireId: "r1",
        upToMove: 8,
        positionKey: "v1:key",
        uci: "e7e5"
      })
    ).toStrictEqual({
      page: 2,
      color: "black",
      outcomes: ["in-book", "ended-in-book"],
      repertoireId: "r1",
      upToMove: 8,
      positionKey: "v1:key",
      uci: "e7e5"
    });
    expect(() => parseInsightsGamesQuery({ page: 0, uci: "e9e5" })).toThrow(/move/);
  });
});
