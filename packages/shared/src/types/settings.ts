import type { MaiaRating } from "./engine";

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

/**
 * Class applied on the Chessground mount node (`cg-wrap`) so scoped rules in `generated-piece-themes.css`
 * override default cburnett sprites. Undefined when the built-in cburnett sheet alone should apply.
 */
export function cgWrapPieceSetClass(style: PieceStyle): string | undefined {
  return style === "cburnett" ? undefined : `piece-set-${style}`;
}

const presentationTailwindClass: Record<PiecePresentation, string> = {
  default: "",
  sharp:
    "[&_piece]:contrast-125 [&_piece]:drop-shadow-[0_2px_1px_rgb(0_0_0/0.42)] [&_piece.black]:brightness-90 [&_piece.white]:brightness-105",
  soft: "[&_piece]:contrast-90 [&_piece]:opacity-95 [&_piece]:drop-shadow-[0_1px_1px_rgb(0_0_0/0.28)] [&_piece.black]:brightness-95",
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
    description:
      "Classic Merida-style set from Lichess (`public/piece/merida`), inlined for offline use."
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
  /**
   * macOS: let the desktop show through the sidebar and titlebar (window vibrancy). Ignored on
   * other platforms and while the system "Reduce transparency" accessibility setting is on.
   */
  glassEffect: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  defaultEngineId: string | null;
  lastEngineMoveTimeMs: number;
  lastEngineDepth: number | null;
  /**
   * Review engine controls. `movetime` per reviewed position (ms). Default 1s: shorter searches
   * give run-to-run noisy Stockfish evals. Settings rows are only written when the user picks a
   * value, so a stored choice survives default changes.
   */
  reviewSearchTimeMs: number;
  reviewUseMaia: boolean;
  reviewCommentaryEnabled: boolean;
  /**
   * Commentary is written by OpenRouter with the user's own key; the only provider. Kept as a
   * setting so rows stored by older builds ("local", "server") read and migrate cleanly.
   */
  reviewCommentaryProvider: ReviewCommentaryProvider;
  reviewCommentaryDetail: "concise" | "balanced" | "detailed";
  reviewPlayerRating: number;
  reviewPlayerColor: "white" | "black";
  reviewShowTopLines: boolean;
  /** MultiPV lines per reviewed position (1-5). */
  reviewMultiPv: number;
  /** Maia levels to run during review; null = every installed level. */
  reviewMaiaLevels: ReviewMaiaLevel[] | null;
  /** UCI `Threads` for the evaluation engine; null = auto (cpus - 1, capped at 8). */
  engineThreads: number | null;
  /** UCI `Hash` (MB) for the evaluation engine. */
  engineHashMb: number;
  recentFilePaths: string[];
  /** In-app updates: download new versions in the background (Windows, Linux AppImage, signed macOS). */
  updatesAutoDownload: boolean;
  /** In-app updates: also offer prerelease (beta) versions. Always on while running a prerelease. */
  updatesIncludeBeta: boolean;
  theme: "light" | "dark";
  lastOpenedGameId: string | null;
  /**
   * When the first-run welcome was finished or skipped (epoch ms). `null`: not yet (the welcome
   * shows). `0`: an install that predates the welcome (set once at startup, see
   * main/onboarding-migration.ts), which never shows it on its own.
   */
  onboardingCompletedAt: number | null;
  /** One-time tips already shown (see {@link ONBOARDING_HINTS}); each appears in one review only. */
  onboardingHintsSeen: OnboardingHintId[];
};

/** The one-time Game review tips. */
export const ONBOARDING_HINTS = ["commentary-links", "maia-curve"] as const;
export type OnboardingHintId = (typeof ONBOARDING_HINTS)[number];

export type ReviewCommentaryProvider = "openrouter";

export type ReviewMaiaLevel = MaiaRating;
export const REVIEW_MAIA_LEVELS: readonly ReviewMaiaLevel[] = [
  1100, 1300, 1500, 1700, 1900
] as const;
export const MAX_ENGINE_THREADS = 8;
export const ENGINE_HASH_MB_RANGE = { min: 16, max: 4096 } as const;

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
  glassEffect: true,
  soundEnabled: true,
  soundVolume: 0.7,
  defaultEngineId: null,
  lastEngineMoveTimeMs: 1000,
  lastEngineDepth: null,
  reviewSearchTimeMs: 1000,
  reviewUseMaia: true,
  reviewCommentaryEnabled: true,
  reviewCommentaryProvider: "openrouter",
  reviewCommentaryDetail: "balanced",
  reviewPlayerRating: 1500,
  reviewPlayerColor: "white",
  reviewShowTopLines: true,
  reviewMultiPv: 3,
  reviewMaiaLevels: null,
  engineThreads: null,
  engineHashMb: 128,
  recentFilePaths: [],
  updatesAutoDownload: true,
  updatesIncludeBeta: false,
  theme: "dark",
  lastOpenedGameId: null,
  onboardingCompletedAt: null,
  onboardingHintsSeen: []
};

/** Maps persisted settings from older builds onto current {@link PieceStyle} ids. */
export function normalizePieceStyle(value: unknown): PieceStyle {
  if (typeof value !== "string") return defaultSettings.pieceStyle;
  if (legacyPieceStyleMap[value]) return legacyPieceStyleMap[value]!;
  return ALL_PIECE_STYLES.includes(value as PieceStyle)
    ? (value as PieceStyle)
    : defaultSettings.pieceStyle;
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

/** Validates the window appearance settings, falling back to defaults for bad values. Idempotent. */
export function normalizeAppearanceSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    glassEffect:
      typeof settings.glassEffect === "boolean" ? settings.glassEffect : defaultSettings.glassEffect
  };
}

/** Validates the in-app update settings, falling back to defaults for bad values. Idempotent. */
export function normalizeUpdateSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    updatesAutoDownload:
      typeof settings.updatesAutoDownload === "boolean"
        ? settings.updatesAutoDownload
        : defaultSettings.updatesAutoDownload,
    updatesIncludeBeta:
      typeof settings.updatesIncludeBeta === "boolean"
        ? settings.updatesIncludeBeta
        : defaultSettings.updatesIncludeBeta
  };
}

/**
 * Validates the first-run settings. A completion time must be a finite, non-negative number
 * (anything else reads as "not completed"); unknown or repeated tip ids are dropped. Idempotent.
 */
export function normalizeOnboardingSettings(settings: AppSettings): AppSettings {
  const completedAt = settings.onboardingCompletedAt;
  const seen: unknown = settings.onboardingHintsSeen;
  return {
    ...settings,
    onboardingCompletedAt:
      typeof completedAt === "number" && Number.isFinite(completedAt) && completedAt >= 0
        ? Math.floor(completedAt)
        : null,
    onboardingHintsSeen: Array.isArray(seen)
      ? ONBOARDING_HINTS.filter((id) => seen.includes(id))
      : []
  };
}

/** Returns normalized `#rrggbb` or null if invalid / empty. */
export function normalizeBoardSquareHex(input: string | null | undefined): string | null {
  if (input == null) return null;
  const m = input.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Default evaluation-engine thread count: leave one core for the UI, cap at {@link MAX_ENGINE_THREADS}. */
export function defaultEngineThreads(cpuCount: number): number {
  return Math.max(1, Math.min(MAX_ENGINE_THREADS, Math.floor(cpuCount) - 1));
}

/** Resolves `engineThreads` (null = auto) to a concrete UCI `Threads` value. */
export function resolveEngineThreads(setting: number | null | undefined, cpuCount: number): number {
  if (setting === null || setting === undefined) return defaultEngineThreads(cpuCount);
  return clampInt(setting, 1, Math.max(1, Math.floor(cpuCount)), defaultEngineThreads(cpuCount));
}

/**
 * Maps a stored commentary provider onto the supported one. Older builds offered a hosted
 * coach (`"server"`) and an offline template (`"local"`); both are retired, so every value
 * reads as OpenRouter.
 */
export function normalizeCommentaryProvider(value: unknown): ReviewCommentaryProvider {
  void value;
  return "openrouter";
}

/**
 * Ids of the engines older builds listed from inside the app bundle ("bundled-stockfish",
 * "bundled-maia…"). The app no longer ships engine binaries, so these ids can never resolve.
 */
const LEGACY_BUNDLED_ENGINE_ID = /^bundled-(stockfish|maia)/;

/**
 * A saved default engine id, or null (the app then picks the default engine) when unset or it
 * points at a retired bundled engine.
 */
export function normalizeDefaultEngineId(value: unknown): string | null {
  if (typeof value !== "string" || !value || LEGACY_BUNDLED_ENGINE_ID.test(value)) return null;
  return value;
}

/** Validates the review/engine resource settings, falling back to defaults for bad values. Idempotent. */
export function normalizeReviewEngineSettings(settings: AppSettings): AppSettings {
  const levels = settings.reviewMaiaLevels;
  return {
    ...settings,
    defaultEngineId: normalizeDefaultEngineId(settings.defaultEngineId),
    reviewMultiPv: clampInt(settings.reviewMultiPv, 1, 5, defaultSettings.reviewMultiPv),
    reviewMaiaLevels: Array.isArray(levels)
      ? REVIEW_MAIA_LEVELS.filter((level) => levels.map(Number).includes(level))
      : null,
    engineThreads:
      settings.engineThreads === null || settings.engineThreads === undefined
        ? null
        : clampInt(settings.engineThreads, 1, 256, 1),
    engineHashMb: clampInt(
      settings.engineHashMb,
      ENGINE_HASH_MB_RANGE.min,
      ENGINE_HASH_MB_RANGE.max,
      defaultSettings.engineHashMb
    ),
    reviewPlayerRating: clampInt(
      settings.reviewPlayerRating,
      100,
      3500,
      defaultSettings.reviewPlayerRating
    ),
    // A legacy value not yet migrated at startup (see main/index.ts) reads as OpenRouter.
    reviewCommentaryProvider: normalizeCommentaryProvider(settings.reviewCommentaryProvider)
  };
}
