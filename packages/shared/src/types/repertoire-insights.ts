/**
 * Repertoire Insights (docs/repertoire-games-and-practice.md §5): the user's games compared with
 * their repertoires in the background, the report and games list built from the results, and the
 * saved filters both use (weak-spots practice and the Study explorer read them too).
 */
import type { Color } from "./chess";
import type { RatingMode } from "./ratings";

/**
 * A game's outcome against the repertoires of the user's colour, from the one it followed longest:
 * - `forgot`: the user played a move the repertoire doesn't have (`player-deviation`);
 * - `new-reply`: the opponent played a reply it doesn't cover (`uncovered-opponent`);
 * - `ended-in-book`: preparation ran out with nothing actionable after (`preparation-ends`);
 * - `in-book`: the game ended inside the repertoire;
 * - `not-covered`: no chapter applies (another opening), or the game left at its very first moves;
 * - `no-repertoire`: there is no repertoire of the user's colour;
 * - `no-user-side`: neither player is a connected account (the game isn't compared).
 */
export const INSIGHTS_OUTCOMES = [
  "forgot",
  "new-reply",
  "in-book",
  "ended-in-book",
  "not-covered",
  "no-repertoire",
  "no-user-side"
] as const;
export type InsightsOutcome = (typeof INSIGHTS_OUTCOMES)[number];

/** Where a game comes from, as the filters name it. */
export const INSIGHTS_ACCOUNTS = ["lichess", "chesscom", "imported"] as const;
export type InsightsAccount = (typeof INSIGHTS_ACCOUNTS)[number];

/** The report's period: all time, the last 3/6/12/24 months, or since a date (`since`). */
export const INSIGHTS_PERIODS = ["all", "3m", "6m", "1y", "2y", "since"] as const;
export type InsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

/** The saved filters (settings), used by the report, the games list and weak-spots practice. */
export type InsightsFilters = {
  period: InsightsPeriod;
  /** The first day counted when `period` is `since` (`YYYY-MM-DD`, local); null otherwise. */
  since: string | null;
  /** The time controls counted (a game without one counts as rapid). */
  timeControls: RatingMode[];
  /** Rated games only (a game is casual only when its Event says so, as Lichess writes it). */
  ratedOnly: boolean;
  accounts: InsightsAccount[];
};

export const DEFAULT_INSIGHTS_FILTERS: InsightsFilters = {
  period: "all",
  since: null,
  timeControls: ["bullet", "blitz", "rapid", "classical", "correspondence"],
  ratedOnly: false,
  accounts: [...INSIGHTS_ACCOUNTS]
};

/** "Score by line" groups games by their moves up to this move (2–8; 4 by default). */
export const INSIGHTS_LINE_MOVES = [2, 3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_INSIGHTS_LINE_MOVE = 4;

export const INSIGHTS_GAMES_PAGE_SIZE = 50;

export type InsightsMove = { uci: string; san: string };
type InsightsMoveCount = InsightsMove & { games: number };

/** The user's results in a set of games; `percent` is their points divided by games (0–100). */
export type InsightsScore = { wins: number; draws: number; losses: number; percent: number };

/** The average win-% the user lost over the 10 plies after leaving book, in reviewed games. */
export type InsightsAfterBook = { averageLoss: number; reviewedGames: number };

/** Where a position is in a repertoire (Study opens there); null when no chapter has it now. */
export type InsightsStudyPlace = { chapterId: string; nodeId: string } | null;

/** What a forgot or unprepared row shares. */
type InsightsSpot = {
  repertoireId: string;
  repertoireName: string;
  color: Color;
  positionKey: string;
  /** The position (before the move the row is about). */
  fen: string;
  games: number;
  /** The moves to the position from the game's start, in their most common order. */
  rootFen: string;
  line: InsightsMove[];
  score: InsightsScore;
  /** When the latest of these games was played (epoch ms); null when no game has a date. */
  lastSeenAt: number | null;
  afterBook: InsightsAfterBook | null;
  /** The latest of these games, and the ply of the move the row is about (Review game). */
  latestGameId: string;
  ply: number;
  study: InsightsStudyPlace;
};

/** A position where the user left their repertoire. */
export type InsightsForgotSpot = InsightsSpot & {
  /** The repertoire's moves there. */
  expected: InsightsMove[];
  /** What the user played instead, most games first. */
  played: InsightsMoveCount[];
};

/** An opponent reply the repertoire doesn't cover. */
export type InsightsUnpreparedReply = InsightsSpot & { reply: InsightsMove };

/** A first move outside the repertoire, with the opening it starts and its games. */
export type InsightsOpeningRow = InsightsMove & {
  opening: string | null;
  games: number;
  /** The user's colour in those games. */
  color: Color;
};

export type InsightsOpenings = {
  /** The opponent's first move outside the repertoire at the root. */
  opponentsChose: InsightsOpeningRow[];
  /** The user played a different first move. */
  youChose: InsightsOpeningRow[];
  /** No repertoire of the user's colour. */
  noRepertoire: InsightsOpeningRow[];
};

/** Games grouped by their moves up to the chosen move, all still in the repertoire there. */
export type InsightsScoreLine = {
  repertoireId: string;
  color: Color;
  rootFen: string;
  moves: InsightsMove[];
  games: number;
  score: InsightsScore;
  afterBook: InsightsAfterBook | null;
  study: InsightsStudyPlace;
};

/** The report bar: the games compared, by what happened. */
type InsightsBar = {
  forgot: number;
  newReply: number;
  /** In book, or preparation ended with nothing actionable after. */
  stayedInBook: number;
  /** Another opening, a first move outside the repertoire, or no repertoire of the colour. */
  otherOpenings: number;
};

export type InsightsReport = {
  /** Games matching the filters that have a user side (the bar's total). */
  games: number;
  /** Games matching the filters that have no user side (not compared). */
  noUserSide: number;
  bar: InsightsBar;
  /** Most games first. */
  forgot: InsightsForgotSpot[];
  unprepared: InsightsUnpreparedReply[];
  openings: InsightsOpenings;
  /** For `lineMove` (the request's): most games first. */
  scoreByLine: InsightsScoreLine[];
  /** Games per time control and per account under the other filters (the filter menus' counts). */
  timeControlCounts: Record<RatingMode, number>;
  accountCounts: Record<InsightsAccount, number>;
};

export type InsightsReportQuery = { lineMove: number };

/** The games list's own filters (the saved ones apply too). */
export type InsightsGamesQuery = {
  page: number;
  color?: Color | null;
  repertoireId?: string | null;
  /** Games with any of these outcomes (a bar segment can name two). */
  outcomes?: InsightsOutcome[] | null;
  /** The issue happened at or before this move. */
  upToMove?: number | null;
  /** A report row's games: its position, and the reply for an unprepared row. */
  positionKey?: string | null;
  uci?: string | null;
};

/** What happened in a listed game, for its outcome pill. */
type InsightsGameIssue = {
  ply: number;
  /** "4…Nf6", as the move is written in the game. */
  played: string | null;
  /** The played move (UCI). */
  playedUci: string | null;
  /** The repertoire's moves there (SAN), for a forgot game. */
  expected: string[];
  /** The same moves as UCI (the board's arrows for them). */
  expectedUcis: string[];
  /** The position before the move (a forgot or new reply game's): what practice and Study open. */
  positionKey: string | null;
  /** Where Study opens that position (forgot and new reply only). */
  study: InsightsStudyPlace;
};

export type InsightsGameRow = {
  gameId: string;
  playedAt: number | null;
  account: InsightsAccount;
  /** The user's colour; null without a user side. */
  color: Color | null;
  opponent: string | null;
  opponentRating: number | null;
  result: "win" | "draw" | "loss" | null;
  timeControl: RatingMode;
  opening: string | null;
  outcome: InsightsOutcome;
  issue: InsightsGameIssue | null;
  repertoireId: string | null;
  repertoireName: string | null;
};

export type InsightsGamesPage = { rows: InsightsGameRow[]; total: number; page: number };

/** The background comparer: games still to compare in its current pass. */
export type InsightsComparerStatus = { running: boolean; done: number; total: number };

/** The Practice tab's banner: forgotten positions under the filters, and whether any account is connected. */
export type InsightsWeakSpotSummary = { positions: number; games: number; accounts: boolean };
