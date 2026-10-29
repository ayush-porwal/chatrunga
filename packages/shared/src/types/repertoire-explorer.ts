/**
 * Study's Explorer (docs/repertoire-games-and-practice.md §6.1–6.2): the moves of the user's own
 * games at a position (main's position index), and Maia 3's likely moves at a rating.
 */
import type { RatingMode } from "./ratings";
import type { InsightsFilters } from "./repertoire-insights";

export type ExplorerPositionInput = { repertoireId: string; fen: string };

/** One move played from the position in the user's games, scored from the user's side. */
export type ExplorerMove = {
  uci: string;
  san: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** The user's points divided by the games with a result (0–1); null when none has one. */
  score: number | null;
  /** When it was last played (epoch ms); null when no game says. */
  lastPlayedAt: number | null;
  /** The repertoire has this move here. */
  inRepertoire: boolean;
};

export type ExplorerGames = {
  /** Most games first. */
  moves: ExplorerMove[];
  /** The Insights filters the counts follow. */
  filters: InsightsFilters;
  /** The index is still being built (counts may grow): games indexed of all. */
  indexing: { done: number; total: number } | null;
};

export type ExplorerMaiaInput = ExplorerPositionInput & {
  /** null: the user's rating for `mode`. */
  rating: number | null;
  /** null: the mode the user plays most. */
  mode: RatingMode | null;
};

/** Where the default rating came from: Settings → Ratings, the user's recent games, or neither. */
export type ExplorerRatingSource = "settings" | "games" | "default";

export type ExplorerMaiaMove = {
  uci: string;
  san: string;
  /** 0–1. */
  probability: number;
  inRepertoire: boolean;
};

export type ExplorerMaiaMoves =
  | { installed: false }
  | {
      installed: true;
      /** The rating Maia was read at (on Maia 3's grid). */
      rating: number;
      mode: RatingMode;
      /** The user's rating at `mode` (on the grid), and where it came from. */
      defaultRating: number;
      ratingSource: ExplorerRatingSource;
      /** The side to move is the repertoire's opponent. */
      opponentToMove: boolean;
      /** Likeliest first: to 90% of the weight, at most 8. */
      moves: ExplorerMaiaMove[];
    };
