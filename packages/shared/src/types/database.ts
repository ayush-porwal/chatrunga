export type ExternalDatabaseKind = "puzzle" | "position" | "game-library";

export type ExternalDatabaseFormat = "csv" | "csv.zst" | "pgn" | "jsonl.zst";

export type ExternalDatabaseSource = {
  id: string;
  name: string;
  provider: string;
  kind: ExternalDatabaseKind;
  format: ExternalDatabaseFormat;
  url: string;
  pageUrl: string;
  description: string;
  license: string;
  expectedRecords?: number;
  updatedLabel?: string;
  fields: string[];
  supportedFilters: string[];
};

export type InstalledDatabase = {
  id: string;
  sourceId: string;
  name: string;
  provider: string;
  kind: ExternalDatabaseKind;
  format: ExternalDatabaseFormat;
  filePath: string;
  fileSizeBytes: number;
  recordCount: number | null;
  sourceUrl: string;
  pageUrl: string;
  license: string;
  downloadedAt: number;
  updatedAt: number;
};

export type DatabaseDownloadProgress = {
  sourceId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  state: "downloading" | "completed" | "failed";
  message?: string;
};

export type PuzzleSampleInput = {
  databaseId: string;
  excludeIds?: string[];
  lichess?: {
    ratingMin: number;
    ratingMax: number;
    popularityMin: number;
    lengths: string[];
    themes: string[];
    openings: string[];
    side: "any" | "white" | "black";
  };
  position?: {
    difficultyMin: number;
    difficultyMax: number;
    tags: string[];
  };
};

export type PuzzleSample = {
  id: string;
  databaseId: string;
  sourceId: string;
  sourceName: string;
  initialFen: string;
  fenBefore?: string;
  opponentMove?: string | null;
  solutionMoves: string[];
  rating?: number | null;
  popularity?: number | null;
  themes: string[];
  gameUrl?: string | null;
  openingTags: string[];
  sideToMove: "white" | "black";
  difficulty?: number | null;
};

export const externalDatabaseSources = [
  {
    id: "lichess-puzzles",
    name: "Lichess Puzzle Database",
    provider: "Lichess",
    kind: "puzzle",
    format: "csv.zst",
    url: "https://database.lichess.org/lichess_db_puzzle.csv.zst",
    pageUrl: "https://database.lichess.org/#puzzles",
    description:
      "Rated tactical puzzles with FEN, UCI solution moves, ratings, popularity, themes, game URL, and opening tags.",
    license: "Creative Commons CC0",
    expectedRecords: 5_939_980,
    updatedLabel: "2026-05-02",
    fields: [
      "PuzzleId",
      "FEN",
      "Moves",
      "Rating",
      "RatingDeviation",
      "Popularity",
      "NbPlays",
      "Themes",
      "GameUrl",
      "OpeningTags"
    ],
    supportedFilters: [
      "rating",
      "popularity",
      "themes",
      "solution length",
      "side to move",
      "opening"
    ]
  },
  {
    id: "chess-position-analysis-results",
    name: "Chess Position Analysis Results",
    provider: "Neil GD",
    kind: "position",
    format: "csv",
    url: "https://raw.githubusercontent.com/neilgd/chess-position-analysis-results/main/data/chess-positions.csv",
    pageUrl:
      "https://github.com/neilgd/chess-position-analysis-results/blob/main/data/chess-positions.csv",
    description:
      "Curated chess positions with FEN, best move, difficulty, side to move, source game URL, and strategic labels.",
    license: "Repository dataset",
    fields: ["fen", "best_move", "difficulty", "side_to_move", "lichess_url", "strategic labels"],
    supportedFilters: ["difficulty", "side to move", "strategic labels"]
  }
] satisfies ExternalDatabaseSource[];
