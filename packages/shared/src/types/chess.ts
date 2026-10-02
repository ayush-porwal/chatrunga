import type { GameReview } from "./engine";

export type Color = "white" | "black";
export type Square =
  `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type AnnotationColor = "green" | "red" | "yellow" | "blue";
export type GameSource = "new" | "pgn-import" | "engine-game" | "analysis" | "puzzle" | "lichess";
/** `online`: a live Lichess game (the opponent's side is `engineSide` in the game store). */
export type GameMode = "freeplay" | "engine" | "analysis" | "puzzle" | "online";

export type BoardArrow = {
  orig: Square;
  dest: Square;
  color: AnnotationColor;
};

export type BoardHighlight = {
  square: Square;
  color: AnnotationColor;
};

export type UserMove = {
  from: Square;
  to: Square;
  promotion?: "queen" | "rook" | "bishop" | "knight";
};

export type MoveNode = {
  id: string;
  parentId: string | null;
  san: string | null;
  uci: string | null;
  fenBefore: string;
  fenAfter: string;
  ply: number;
  nags: string[];
  comment: string | null;
  /** Remaining time after this move, from PGN tag `[%clk h:mm:ss]`. */
  clockAfter?: string | null;
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
  children: string[];
};

export type GameHeaders = {
  event?: string | null;
  site?: string | null;
  date?: string | null;
  round?: string | null;
  white?: string | null;
  black?: string | null;
  whiteElo?: string | null;
  blackElo?: string | null;
  timeControl?: string | null;
  eco?: string | null;
  opening?: string | null;
  utcDate?: string | null;
  utcTime?: string | null;
  termination?: string | null;
  result?: string | null;
  /** Non-standard tags like En Croissant's [Orientation "black"] — applied on load. */
  orientationHint?: Color | null;
};

export type GameSession = {
  id: string | null;
  source: GameSource;
  headers: GameHeaders;
  rootFen: string;
  currentFen: string;
  currentNodeId: string;
  moveTree: MoveNode[];
  pgn: string;
};

export type ImportedGame = {
  game: GameSession;
  warning?: string;
  /**
   * The same game is already in the library (same Lichess URL, or the same start, main line,
   * players and date): it's opened instead of importing a copy.
   */
  existingGameId?: string;
};

export type GameSummary = {
  id: string;
  source: GameSource;
  white: string | null;
  black: string | null;
  event: string | null;
  result: string | null;
  date: string | null;
  currentFen: string;
  updatedAt: number;
  /** How many analyses (engine reviews) of the game are saved. */
  reviewCount: number;
  /** When the newest of them was made (epoch ms); null when there is none. */
  lastReviewedAt: number | null;
};

/** Where a library page starts: just after this game in the list's order (newest first, then id). */
export type GameListCursor = { updatedAt: number; id: string };

/**
 * Which library games a list shows: "reviewed" those with a saved analysis, "lichess" the Lichess
 * imports, "other" everything else.
 */
export type GameListFilter = "all" | "reviewed" | "lichess" | "other";

/** One page of the library, filtered and searched in the database before it is cut to `limit`. */
/** The longest library search text (the search box stops there; IPC refuses longer). */
export const GAME_SEARCH_MAX_LENGTH = 200;

export type GameListQuery = {
  /** Null (or absent) for the first page; a page's `nextCursor` for the one after it. */
  cursor?: GameListCursor | null;
  /** Games per page (clamped to 1..200; 50 when absent). */
  limit?: number;
  /** Case-insensitive text in the players, event, date or result. */
  search?: string;
  filter?: GameListFilter;
  /** A game left out (the one on the board, which the review picker lists on its own). */
  excludeId?: string | null;
};

export type GameListPage = {
  items: GameSummary[];
  /** Where the next page starts; null when this is the last one. */
  nextCursor: GameListCursor | null;
};

/** What the library holds, for which filters to offer (without listing it). */
export type GameLibraryFacets = {
  /** Any game other than `excludeId`. */
  hasGames: boolean;
  /** Any Lichess import (counting `excludeId`). */
  hasLichess: boolean;
  /** Any game other than `excludeId` with a saved analysis. */
  hasReviewed: boolean;
};

/** One saved analysis of a game, as listed for choosing between them (the review itself loads on demand). */
export type SavedReviewInfo = {
  reviewId: string;
  createdAt: number;
  engineName: string | null;
  /** Search per move (ms), or the depth when the review searched to a depth. */
  moveTimeMs: number | null;
  depth: number | null;
  /** Maia ratings used (empty: no Maia). */
  maiaLevels: number[];
  moveCount: number;
  commentaryCount: number;
};

export type SavedGame = GameSummary & {
  /** Canonical node cursor; legacy rows may omit it and fall back to currentFen. */
  currentNodeId?: string | null;
  /** Every header as last saved; older rows have none (their PGN still carries them). */
  headers?: GameHeaders | null;
  site: string | null;
  round: string | null;
  initialFen: string | null;
  pgn: string;
  moveTree: MoveNode[];
  /** The newest analysis (with its AI commentary); the others load by id (`games.getReview`). */
  review: GameReview | null;
  /** Every saved analysis of the game, newest first. */
  reviews: SavedReviewInfo[];
};

export type SaveGameInput = {
  id?: string | null;
  source: GameSource;
  headers: GameHeaders;
  rootFen: string;
  currentFen: string;
  currentNodeId?: string | null;
  pgn: string;
  moveTree: MoveNode[];
  /**
   * The analysis on the board, saved under its `reviewId` (added, or updated with new commentary).
   * Other saved analyses of the game are never touched; omitted or null saves no analysis.
   */
  review?: GameReview | null;
};

export type ImportPgnInput = {
  pgn: string;
  sourcePath?: string | null;
};
