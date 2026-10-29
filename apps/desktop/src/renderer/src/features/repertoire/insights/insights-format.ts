/**
 * Insights' words (docs/repertoire-games-and-practice-ui.md §2f): move and line labels from plies,
 * the outcome pills, scores, the after-book column and the filters' choices. Pure.
 */
import { rootPly } from "@chaturanga/shared/chess/pgn";
import type { Color } from "@chaturanga/shared/types/chess";
import { RATING_MODES, RATING_MODE_LABELS } from "@chaturanga/shared/types/ratings";
import {
  INSIGHTS_ACCOUNTS,
  type InsightsAccount,
  type InsightsAfterBook,
  type InsightsFilters,
  type InsightsGameRow,
  type InsightsMove,
  type InsightsOutcome,
  type InsightsPeriod,
  type InsightsScore
} from "@chaturanga/shared/types/repertoire-insights";

const COLOR_NAME: Record<Color, string> = { white: "White", black: "Black" };

/** "3.e5" / "4…Nc6": a move by its ply (odd plies are White's). */
export function plyMoveLabel(ply: number, san: string): string {
  const number = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${number}.${san}` : `${number}…${san}`;
}

/**
 * A line's moves as it reads, one label per move: "1. e4", "e5", "2. Nf3" (a line starting with
 * Black's move numbers it: "4… Nc6").
 */
export function lineLabels(rootFen: string, moves: readonly InsightsMove[]): string[] {
  const first = rootPly(rootFen) + 1;
  return moves.map((move, index) => {
    const ply = first + index;
    const number = Math.ceil(ply / 2);
    if (ply % 2 === 1) return `${number}. ${move.san}`;
    return index === 0 ? `${number}… ${move.san}` : move.san;
  });
}

/** The ply after a line: where the move a row is about is played. */
export function plyAfter(rootFen: string, moves: readonly unknown[]): number {
  return rootPly(rootFen) + moves.length + 1;
}

type OutcomePill = {
  label: string;
  title: string | null;
  tone: "accent" | "info" | "warn" | "danger" | "neutral";
};

/** A listed game's outcome pill: "Forgot 4…Nc6", "New reply 3.e5", "In book", "Not covered: 1.e3"… */
export function outcomePill(
  row: Pick<InsightsGameRow, "outcome" | "issue" | "color">
): OutcomePill {
  const issue = row.issue;
  switch (row.outcome) {
    case "forgot": {
      const expected = issue?.expected[0];
      const label = issue && expected ? `Forgot ${plyMoveLabel(issue.ply, expected)}` : "Forgot";
      const title =
        issue?.played && issue.expected.length
          ? `You played ${plyMoveLabel(issue.ply, issue.played)}; your repertoire has ${issue.expected.join(", ")}.`
          : null;
      return { label, title, tone: "danger" };
    }
    case "new-reply":
      return {
        label: issue?.played ? `New reply ${plyMoveLabel(issue.ply, issue.played)}` : "New reply",
        title: "Your repertoire doesn't cover this reply yet.",
        tone: "warn"
      };
    case "in-book":
      return { label: "In book", title: "The game ended inside your repertoire.", tone: "accent" };
    case "ended-in-book":
      return {
        label: "Ended in book",
        title: "Your preparation ran out with nothing to fix.",
        tone: "accent"
      };
    case "not-covered":
      return {
        label: issue?.played
          ? `Not covered: ${plyMoveLabel(issue.ply, issue.played)}`
          : "Not covered",
        title: "Another opening than your repertoire's.",
        tone: "neutral"
      };
    case "no-repertoire":
      return {
        label: row.color ? `No ${COLOR_NAME[row.color]} repertoire` : "No repertoire",
        title: null,
        tone: "neutral"
      };
    case "no-user-side":
      return {
        label: "No user side",
        title: "Neither player is one of your connected accounts.",
        tone: "neutral"
      };
  }
}

/** "62%" with "3W 1D 2L" for its title. */
export function scoreText(score: InsightsScore): { percent: string; detail: string } {
  return {
    percent: `${score.percent}%`,
    detail: `${score.wins} won · ${score.draws} drawn · ${score.losses} lost`
  };
}

/** "−12% after" (win chance lost after leaving book), with how many reviewed games it is from. */
export function afterBookText(afterBook: InsightsAfterBook | null): {
  text: string;
  title: string;
} | null {
  if (!afterBook) return null;
  const loss = Math.round(afterBook.averageLoss);
  const sign = loss > 0 ? "−" : loss < 0 ? "+" : "±";
  return {
    text: `${sign}${Math.abs(loss)}% after`,
    title: `Average win chance ${loss > 0 ? "lost" : "gained"} over the 10 moves after leaving book, from ${
      afterBook.reviewedGames
    } reviewed game${afterBook.reviewedGames === 1 ? "" : "s"}`
  };
}

/** "38 games" / "1 game", with thousands separated. */
export function gamesCount(count: number): string {
  return `${count.toLocaleString()} game${count === 1 ? "" : "s"}`;
}

/** "Comparing 1,701 games… 62%" while the comparer runs. */
export function comparingText(done: number, total: number): string {
  const percent = total ? Math.floor((done / total) * 100) : 0;
  return `Comparing ${total.toLocaleString()} games… ${percent}%`;
}

export const PERIOD_LABELS: Record<InsightsPeriod, string> = {
  all: "All time",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "1y": "Last 12 months",
  "2y": "Last 2 years",
  since: "Since…"
};

export const ACCOUNT_LABELS: Record<InsightsAccount, string> = {
  lichess: "Lichess",
  chesscom: "Chess.com",
  imported: "Imported"
};

/**
 * What the filters leave out, as the Filters button names it ("Last 3 months · Blitz, Rapid ·
 * Rated only"), or null when they count every game.
 */
export function filtersSummary(filters: InsightsFilters): string | null {
  const parts: string[] = [];
  if (filters.period === "since") parts.push(`Since ${filters.since ?? "a date"}`);
  else if (filters.period !== "all") parts.push(PERIOD_LABELS[filters.period]);
  if (filters.timeControls.length < RATING_MODES.length) {
    const modes = filters.timeControls.map((mode) => RATING_MODE_LABELS[mode]);
    parts.push(modes.join(", ") || "No time controls");
  }
  if (filters.ratedOnly) parts.push("Rated only");
  if (filters.accounts.length < INSIGHTS_ACCOUNTS.length) {
    const accounts = filters.accounts.map((account) => ACCOUNT_LABELS[account]);
    parts.push(accounts.join(", ") || "No accounts");
  }
  return parts.length ? parts.join(" · ") : null;
}

/** The games list's outcome choices (a bar segment may pick two at once). */
export const OUTCOME_FILTERS: readonly { label: string; outcomes: InsightsOutcome[] | null }[] = [
  { label: "All outcomes", outcomes: null },
  { label: "Forgot", outcomes: ["forgot"] },
  { label: "New reply", outcomes: ["new-reply"] },
  { label: "In book", outcomes: ["in-book"] },
  { label: "Ended in book", outcomes: ["ended-in-book"] },
  { label: "Stayed in book", outcomes: ["in-book", "ended-in-book"] },
  { label: "Not covered", outcomes: ["not-covered"] },
  { label: "No repertoire", outcomes: ["no-repertoire"] },
  { label: "Other openings", outcomes: ["not-covered", "no-repertoire"] },
  { label: "No user side", outcomes: ["no-user-side"] }
];

/** The index of `outcomes` among the choices (the first, All, when none matches). */
export function outcomeFilterIndex(outcomes: readonly InsightsOutcome[] | null): number {
  const key = (list: readonly InsightsOutcome[] | null) => (list ?? []).join(",");
  return Math.max(
    0,
    OUTCOME_FILTERS.findIndex((choice) => key(choice.outcomes) === key(outcomes))
  );
}
