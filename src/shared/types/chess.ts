export type Color = "white" | "black";
export type Square = `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type AnnotationColor = "green" | "red" | "yellow" | "blue";
export type GameSource = "new" | "pgn-import" | "engine-game";
export type GameMode = "freeplay" | "engine";

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
  result?: string | null;
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
};

export type SavedGame = GameSummary & {
  site: string | null;
  round: string | null;
  initialFen: string | null;
  pgn: string;
  moveTree: MoveNode[];
};

export type SaveGameInput = {
  id?: string | null;
  source: GameSource;
  headers: GameHeaders;
  rootFen: string;
  currentFen: string;
  pgn: string;
  moveTree: MoveNode[];
};

export type ImportPgnInput = {
  pgn: string;
  sourcePath?: string | null;
};
