export type BoardTheme =
  | "brown"
  | "green"
  | "blue"
  | "purple"
  | "gray"
  | "rose"
  | "newspaper"
  | "wood"
  | "walnut"
  | "slate";

/** Cburnett sprites ship inside `@lichess-org/chessground` (`chessground.cburnett.css`). */
export type PieceStyle = "cburnett" | VendoredPieceSet;

/**
 * Extra sets vendored as scoped CSS (`generated-piece-themes.css`), SVGs from Lichess lila `public/piece`.
 * Not shipped by the Chessground npm package itself (only cburnett CSS is bundled there).
 */
export type VendoredPieceSet =
  | "merida"
  | "alpha"
  | "california"
  | "cardinal"
  | "chessnut"
  | "kosal"
  | "maestro"
  | "pirouetti";

/** Visual tuning applied on the board wrapper for all piece sets (Tailwind filters on `piece` descendants). */
export type PiecePresentation = "default" | "sharp" | "soft" | "contrast";

export const VENDORED_PIECE_SETS: readonly VendoredPieceSet[] = [
  "merida",
  "alpha",
  "california",
  "cardinal",
  "chessnut",
  "kosal",
  "maestro",
  "pirouetti"
] as const;

const legacyPieceStyleMap: Record<string, PieceStyle | undefined> = {
  staunton: "cburnett",
  stauntonCrisp: "cburnett",
  stauntonSoft: "cburnett",
  stauntonContrast: "cburnett",
  cburnettCrisp: "cburnett",
  cburnettSoft: "cburnett",
  cburnettContrast: "cburnett",
  /** Hyphenated ids from earlier experiments */
  "cburnett-crisp": "cburnett",
  "cburnett-soft": "cburnett",
  "cburnett-contrast": "cburnett",
  /** Common misspelling vs Lichess folder `kosal` */
  kosalo: "kosal"
};

/** Raw persisted style ids that implied a presentation before `piecePresentation` existed. */
const legacyPieceStyleIdToPresentation: Record<string, PiecePresentation> = {
  cburnettCrisp: "sharp",
  cburnettSoft: "soft",
  cburnettContrast: "contrast",
  stauntonCrisp: "sharp",
  stauntonSoft: "soft",
  stauntonContrast: "contrast",
  "cburnett-crisp": "sharp",
  "cburnett-soft": "soft",
  "cburnett-contrast": "contrast"
};

const ALL_PIECE_STYLES: PieceStyle[] = ["cburnett", ...VENDORED_PIECE_SETS];

const ALL_PIECE_PRESENTATIONS: PiecePresentation[] = ["default", "sharp", "soft", "contrast"];

/** Which sprite pack is painted for a persisted {@link PieceStyle}. */
export function pieceSpritePack(style: PieceStyle): "cburnett" | VendoredPieceSet {
  return style === "cburnett" ? "cburnett" : style;
}

/**
 * Class applied on the Chessground mount node (`cg-wrap`) so scoped rules in `generated-piece-themes.css`
 * override default cburnett sprites. Undefined when the built-in cburnett sheet alone should apply.
 */
export function cgWrapPieceSetClass(style: PieceStyle): string | undefined {
  const pack = pieceSpritePack(style);
  return pack === "cburnett" ? undefined : `piece-set-${pack}`;
}

const presentationTailwindClass: Record<PiecePresentation, string> = {
  default: "",
  sharp:
    "[&_piece]:contrast-125 [&_piece]:drop-shadow-[0_2px_1px_rgb(0_0_0/0.42)] [&_piece.black]:brightness-90 [&_piece.white]:brightness-105",
  soft:
    "[&_piece]:contrast-90 [&_piece]:opacity-95 [&_piece]:drop-shadow-[0_1px_1px_rgb(0_0_0/0.28)] [&_piece.black]:brightness-95",
  contrast:
    "[&_piece]:contrast-150 [&_piece]:drop-shadow-[0_2px_2px_rgb(0_0_0/0.55)] [&_piece.black]:brightness-75 [&_piece.white]:brightness-110"
};

/** Tailwind filters applied on the board wrapper (targets `piece` descendants). Applies to every piece set. */
export function piecePresentationTailwindClass(presentation: PiecePresentation): string {
  return presentationTailwindClass[presentation];
}

export const pieceStyleOptions: Array<{
  id: PieceStyle;
  label: string;
  description: string;
}> = [
  {
    id: "cburnett",
    label: "Cburnett",
    description:
      "Default sprites bundled with Chessground (`chessground.cburnett.css`, SVG data URLs — offline / file:// safe)."
  },
  {
    id: "merida",
    label: "Merida",
    description: "Classic Merida-style set from Lichess (`public/piece/merida`), inlined for offline use."
  },
  {
    id: "alpha",
    label: "Alpha",
    description: "Lichess Alpha set (`public/piece/alpha`)."
  },
  {
    id: "california",
    label: "California",
    description: "Lichess California set (`public/piece/california`)."
  },
  {
    id: "cardinal",
    label: "Cardinal",
    description: "Lichess Cardinal set (`public/piece/cardinal`)."
  },
  {
    id: "chessnut",
    label: "Chessnut",
    description: "Lichess Chessnut set (`public/piece/chessnut`)."
  },
  {
    id: "kosal",
    label: "Kosal",
    description: "Lichess Kosal set (`public/piece/kosal`)."
  },
  {
    id: "maestro",
    label: "Maestro",
    description: "Lichess Maestro set (`public/piece/maestro`)."
  },
  {
    id: "pirouetti",
    label: "Pirouetti",
    description: "Lichess Pirouetti set (`public/piece/pirouetti`)."
  }
];

export const piecePresentationOptions: Array<{
  id: PiecePresentation;
  label: string;
  description: string;
}> = [
  { id: "default", label: "Default", description: "No extra filters." },
  {
    id: "sharp",
    label: "Sharpen",
    description: "Stronger contrast and shadow on piece sprites."
  },
  {
    id: "soft",
    label: "Soften",
    description: "Tuned down for long sessions."
  },
  {
    id: "contrast",
    label: "High contrast",
    description: "Maximum separation from the board."
  }
];

export type AppSettings = {
  boardOrientation: "white" | "black";
  boardTheme: BoardTheme;
  /** `#RRGGBB`; when both this and `boardSquareDark` are set, they override the preset theme square colors. */
  boardSquareLight: string | null;
  boardSquareDark: string | null;
  pieceStyle: PieceStyle;
  piecePresentation: PiecePresentation;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  boardAnimation: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  defaultEngineId: string | null;
  lastEngineMoveTimeMs: number;
  lastEngineDepth: number | null;
  recentFilePaths: string[];
  theme: "light" | "dark";
  lastOpenedGameId: string | null;
};

export const boardThemeSquareColors: Record<BoardTheme, { light: string; dark: string }> = {
  brown: { light: "#f0d9b5", dark: "#b58863" },
  green: { light: "#eeeed2", dark: "#769656" },
  blue: { light: "#d7e8f7", dark: "#5f8fbf" },
  purple: { light: "#e8ddf5", dark: "#8364a2" },
  gray: { light: "#d9d9d9", dark: "#8f8f8f" },
  rose: { light: "#eaded0", dark: "#b17278" },
  newspaper: { light: "#f6f0df", dark: "#9b927d" },
  wood: { light: "#e4bf83", dark: "#9c6235" },
  walnut: { light: "#d0a56f", dark: "#6f452c" },
  slate: { light: "#c9d1d9", dark: "#59636f" }
};

export const defaultSettings: AppSettings = {
  boardOrientation: "white",
  boardTheme: "brown",
  boardSquareLight: null,
  boardSquareDark: null,
  pieceStyle: "cburnett",
  piecePresentation: "default",
  showCoordinates: true,
  showLegalMoves: true,
  boardAnimation: true,
  soundEnabled: true,
  soundVolume: 0.7,
  defaultEngineId: null,
  lastEngineMoveTimeMs: 1000,
  lastEngineDepth: null,
  recentFilePaths: [],
  theme: "dark",
  lastOpenedGameId: null
};

/** Maps persisted settings from older builds onto current {@link PieceStyle} ids. */
export function normalizePieceStyle(value: unknown): PieceStyle {
  if (typeof value !== "string") return defaultSettings.pieceStyle;
  if (legacyPieceStyleMap[value]) return legacyPieceStyleMap[value]!;
  return ALL_PIECE_STYLES.includes(value as PieceStyle) ? (value as PieceStyle) : defaultSettings.pieceStyle;
}

export function normalizePiecePresentation(value: unknown): PiecePresentation {
  if (typeof value !== "string") return defaultSettings.piecePresentation;
  return ALL_PIECE_PRESENTATIONS.includes(value as PiecePresentation)
    ? (value as PiecePresentation)
    : defaultSettings.piecePresentation;
}

/**
 * Applies piece style normalization and maps legacy combined ids (e.g. `cburnettCrisp`) onto
 * `pieceStyle` + `piecePresentation`. Idempotent for settings already on the new shape.
 */
export function hydratePieceSettings(settings: AppSettings): AppSettings {
  const rawStyleStr = typeof settings.pieceStyle === "string" ? settings.pieceStyle : "";
  let presentation = normalizePiecePresentation(settings.piecePresentation);
  const fromLegacy = legacyPieceStyleIdToPresentation[rawStyleStr];
  if (fromLegacy) presentation = fromLegacy;
  return {
    ...settings,
    pieceStyle: normalizePieceStyle(settings.pieceStyle),
    piecePresentation: presentation
  };
}

/** Returns normalized `#rrggbb` or null if invalid / empty. */
export function normalizeBoardSquareHex(input: string | null | undefined): string | null {
  if (input == null) return null;
  const m = input.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : null;
}
