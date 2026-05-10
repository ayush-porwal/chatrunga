export type BoardTheme =
  | "brown"
  | "green"
  | "blue"
  | "purple"
  | "gray"
  | "newspaper"
  | "wood"
  | "walnut"
  | "slate";

export type PieceStyle = "staunton" | "chaturanga" | "neo" | "minimal";

export type AppSettings = {
  boardOrientation: "white" | "black";
  boardTheme: BoardTheme;
  pieceStyle: PieceStyle;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  boardAnimation: boolean;
  defaultEngineId: string | null;
  lastEngineMoveTimeMs: number;
  lastEngineDepth: number | null;
  recentFilePaths: string[];
  theme: "light" | "dark";
  lastOpenedGameId: string | null;
};

export const defaultSettings: AppSettings = {
  boardOrientation: "white",
  boardTheme: "brown",
  pieceStyle: "chaturanga",
  showCoordinates: true,
  showLegalMoves: true,
  boardAnimation: true,
  defaultEngineId: null,
  lastEngineMoveTimeMs: 1000,
  lastEngineDepth: null,
  recentFilePaths: [],
  theme: "dark",
  lastOpenedGameId: null
};
