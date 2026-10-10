import type { MaiaRating } from "./engine";
import { isOneOf } from "./guards";
import {
  normalizePlayerRatings,
  RATINGS_ACCOUNTS,
  uniformRatings,
  type PlayerRatings,
  type RatingsAccount
} from "./ratings";

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
  | "slate"
  | "sapphire";

/** Cburnett is also bundled with Chessground (`chessground.cburnett.css`), which draws the first paint. */
export type PieceStyle = "cburnett" | VendoredPieceSet;

/**
 * Sets packed from our copies in `scripts/piece-svg-sources` into the committed `.css.gz`, which
 * `generated-piece-themes.ts` turns into scoped CSS at startup.
 */
export type VendoredPieceSet =
  | "merida"
  | "alpha"
  | "california"
  | "cardinal"
  | "chessnut"
  | "kosal"
  | "maestro"
  | "pirouetti"
  | "classic"
  | "anarcandy"
  | "caliente"
  | "celtic"
  | "cooke"
  | "disguised"
  | "dubrovny"
  | "fantasy"
  | "firi"
  | "fresca"
  | "gioco"
  | "horsey"
  | "icpieces"
  | "kiwen-suwi"
  | "letter"
  | "minimal-warmth"
  | "mpchess"
  | "papercut"
  | "pixel"
  | "rhosgfx"
  | "shapes"
  | "spatial"
  | "staunty"
  | "tatiana"
  | "totoy"
  | "xkcd";

/**
 * How tall pieces stand (Settings → Board → Piece sizes): `ladder` ranks them, king tallest and
 * pawn shortest; `uniform` makes every piece as tall as the king. Both are packed for every set.
 */
export type PieceSizes = "ladder" | "uniform";

export const VENDORED_PIECE_SETS: readonly VendoredPieceSet[] = [
  "merida",
  "alpha",
  "california",
  "cardinal",
  "chessnut",
  "kosal",
  "maestro",
  "pirouetti",
  "classic",
  "anarcandy",
  "caliente",
  "celtic",
  "cooke",
  "disguised",
  "dubrovny",
  "fantasy",
  "firi",
  "fresca",
  "gioco",
  "horsey",
  "icpieces",
  "kiwen-suwi",
  "letter",
  "minimal-warmth",
  "mpchess",
  "papercut",
  "pixel",
  "rhosgfx",
  "shapes",
  "spatial",
  "staunty",
  "tatiana",
  "totoy",
  "xkcd"
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
  /** Common misspelling of `kosal` */
  kosalo: "kosal"
};

const ALL_PIECE_STYLES: PieceStyle[] = ["cburnett", ...VENDORED_PIECE_SETS];

const ALL_PIECE_SIZES: PieceSizes[] = ["ladder", "uniform"];

/**
 * Class applied on the Chessground mount node (`cg-wrap`) so scoped rules built by
 * `generated-piece-themes.ts` override Chessground's bundled cburnett sprites, which only show
 * until those finished drawings load (cburnett included).
 */
export function cgWrapPieceSetClass(style: PieceStyle): string {
  return `piece-set-${style}`;
}

/** Class beside the piece set's on the mount node: picks the set's uniform drawings. */
export function pieceSizesClass(sizes: PieceSizes): string {
  return sizes === "uniform" ? "piece-sizes-uniform" : "";
}

export type PieceLicence = { name: string; url: string };

/** The licences the piece sets are published under (scripts/piece-svg-sources/README.md). */
const PIECE_LICENCES = {
  gpl2: { name: "GPLv2+", url: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html" },
  gpl3: { name: "GPLv3+", url: "https://www.gnu.org/licenses/gpl-3.0.html" },
  agpl3: { name: "AGPLv3+", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
  apache2: { name: "Apache 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  mit: { name: "MIT", url: "https://opensource.org/license/mit" },
  cc0: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  ccBy4: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  ccBySa4: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  ccByNcSa4: { name: "CC BY-NC-SA 4.0", url: "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
  ccByNcSa25: { name: "CC BY-NC-SA 2.5", url: "https://xkcd.com/license.html" },
  alpha: {
    name: "Free for personal non-commercial use",
    url: "http://www.enpassant.dk/chess/downl/alpha.zip"
  }
} satisfies Record<string, PieceLicence>;

export const pieceStyleOptions: Array<{
  id: PieceStyle;
  label: string;
  /** Who drew the set, shown in Settings beside its licence. */
  description: string;
  licence: PieceLicence;
}> = [
  {
    id: "cburnett",
    label: "Cburnett",
    description: "By Colin M.L. Burnett.",
    licence: PIECE_LICENCES.gpl2
  },
  {
    id: "merida",
    label: "Merida",
    description: "By Armando Hernandez Marroquin.",
    licence: PIECE_LICENCES.gpl2
  },
  {
    id: "alpha",
    label: "Alpha",
    description: "By Eric Bentzen.",
    licence: PIECE_LICENCES.alpha
  },
  {
    id: "california",
    label: "California",
    description: "By Jerry S.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "cardinal",
    label: "Cardinal",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "chessnut",
    label: "Chessnut",
    description: "By Alexis Luengas.",
    licence: PIECE_LICENCES.apache2
  },
  {
    id: "kosal",
    label: "Kosal",
    description: "By Kosal Sen.",
    licence: PIECE_LICENCES.agpl3
  },
  {
    id: "maestro",
    label: "Maestro",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "pirouetti",
    label: "Pirouetti",
    description: "By pirouetti.",
    licence: PIECE_LICENCES.agpl3
  },
  {
    id: "classic",
    label: "Classic",
    description: "Cburnett by Colin M.L. Burnett, with warm gradients.",
    licence: PIECE_LICENCES.gpl2
  },
  {
    id: "anarcandy",
    label: "Anarcandy",
    description: "By caderek.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "caliente",
    label: "Caliente",
    description: "By avi.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "celtic",
    label: "Celtic",
    description: "By Maurizio Monge.",
    licence: PIECE_LICENCES.mit
  },
  {
    id: "cooke",
    label: "Cooke",
    description: "By fejfar.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "disguised",
    label: "Disguised",
    description: "By danegraphics.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "dubrovny",
    label: "Dubrovny",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "fantasy",
    label: "Fantasy",
    description: "By Maurizio Monge.",
    licence: PIECE_LICENCES.mit
  },
  {
    id: "firi",
    label: "Firi",
    description: "By James Faure.",
    licence: PIECE_LICENCES.ccBy4
  },
  {
    id: "fresca",
    label: "Fresca",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "gioco",
    label: "Gioco",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "horsey",
    label: "Horsey",
    description: "By cham and michael1241.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "icpieces",
    label: "IC Pieces",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "kiwen-suwi",
    label: "Kiwen-suwi",
    description: "By neverRare.",
    licence: PIECE_LICENCES.ccBy4
  },
  {
    id: "letter",
    label: "Letter",
    description: "By usolando.",
    licence: PIECE_LICENCES.agpl3
  },
  {
    id: "minimal-warmth",
    label: "Minimal Warmth",
    description: "By blunder_reign.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "mpchess",
    label: "MPChess",
    description: "By Maxime Chupin.",
    licence: PIECE_LICENCES.gpl3
  },
  {
    id: "papercut",
    label: "Papercut",
    description: "By Nikolay Anzarov.",
    licence: PIECE_LICENCES.ccBy4
  },
  {
    id: "pixel",
    label: "Pixel",
    description: "By therealqtpi.",
    licence: PIECE_LICENCES.agpl3
  },
  {
    id: "rhosgfx",
    label: "RhosGFX",
    description: "By RhosGFX.",
    licence: PIECE_LICENCES.cc0
  },
  {
    id: "shapes",
    label: "Shapes",
    description: "By flugsio.",
    licence: PIECE_LICENCES.ccBySa4
  },
  {
    id: "spatial",
    label: "Spatial",
    description: "By Maurizio Monge.",
    licence: PIECE_LICENCES.mit
  },
  {
    id: "staunty",
    label: "Staunty",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "tatiana",
    label: "Tatiana",
    description: "By sadsnake1.",
    licence: PIECE_LICENCES.ccByNcSa4
  },
  {
    id: "totoy",
    label: "Totoy",
    description: "By Kosal Sen.",
    licence: PIECE_LICENCES.ccBy4
  },
  {
    id: "xkcd",
    label: "xkcd",
    description: "By Randall Munroe.",
    licence: PIECE_LICENCES.ccByNcSa25
  }
];

export const pieceSizesOptions: Array<{
  id: PieceSizes;
  label: string;
  description: string;
}> = [
  { id: "ladder", label: "By rank", description: "The king stands tallest, pawns shortest." },
  { id: "uniform", label: "Uniform", description: "Every piece is as tall as the king." }
];

/** How much the AI commentary says about each move. */
export type CommentaryDetail = "concise" | "balanced" | "detailed";
export const COMMENTARY_DETAILS: readonly CommentaryDetail[] = ["concise", "balanced", "detailed"];

export type AppSettings = {
  boardOrientation: "white" | "black";
  boardTheme: BoardTheme;
  /** `#RRGGBB`; when both this and `boardSquareDark` are set, they override the preset theme square colors. */
  boardSquareLight: string | null;
  boardSquareDark: string | null;
  pieceStyle: PieceStyle;
  pieceSizes: PieceSizes;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  boardAnimation: boolean;
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
  reviewCommentaryDetail: CommentaryDetail;
  /**
   * The player's rating per Lichess mode (Settings → Ratings): typed in, or synced from the
   * connected Lichess account. A review without the game's own rating reads its mode's.
   */
  playerRatings: PlayerRatings;
  /**
   * Which connected account fills `playerRatings` while both Lichess and Chess.com are connected
   * (Settings → Ratings). With one connected, that one does.
   */
  ratingsAccount: RatingsAccount;
  reviewPlayerColor: "white" | "black";
  reviewShowTopLines: boolean;
  /** MultiPV lines per reviewed position (1-5). */
  reviewMultiPv: number;
  /** Maia levels to run during review; null = every installed level. */
  reviewMaiaLevels: ReviewMaiaLevel[] | null;
  /** Live analysis: the engine to analyse with (null: the default engine). */
  analysisEngineId: string | null;
  /** Live analysis: how many lines (MultiPV), 1–5. */
  analysisLines: number;
  /** Live analysis: search until stopped, to a depth, or for a time per position. */
  analysisLimit: AnalysisLimit;
  /** Live analysis: the depth searched to when `analysisLimit` is "depth". */
  analysisDepth: number;
  /** Live analysis: seconds per position when `analysisLimit` is "time". */
  analysisTimeSec: number;
  /** Live analysis: an arrow for the engine's best move on the board. */
  analysisBestMoveArrow: boolean;
  /** The evaluation bar beside the board (every board: analysis, review). */
  analysisEvalBar: boolean;
  /** Which side of the board the evaluation bar sits on. */
  analysisEvalBarSide: EvalBarSide;
  /** UCI `Threads` for the evaluation engine; null = auto (cpus - 1, capped at 8). */
  engineThreads: number | null;
  /** UCI `Hash` (MB) for the evaluation engine. */
  engineHashMb: number;
  recentFilePaths: string[];
  /** In-app updates: download new versions in the background (Windows, Linux AppImage, signed macOS). */
  updatesAutoDownload: boolean;
  /**
   * Send usage analytics (docs/telemetry.md). On unless the user turns it off; turning it off
   * deletes events not sent yet. `CHATURANGA_TELEMETRY_ENABLED=false` overrides it.
   */
  usageAnalyticsEnabled: boolean;
  /**
   * Startup may adopt an Lc0 installed outside the app (Homebrew, PATH) for Maia. Turned off when
   * the user forgets Lc0's path, back on when they choose a binary; not shown in Settings.
   */
  lc0AutoDetect: boolean;
  theme: "light" | "dark";
  lastOpenedGameId: string | null;
  /** Game review's Opening tab: the repertoire last compared for White games (null: none yet). */
  repertoireCompareWhite: string | null;
  /** Game review's Opening tab: the repertoire last compared for Black games (null: none yet). */
  repertoireCompareBlack: string | null;
  /**
   * Repertoire practice: how long a correct answer stays before the next card comes by itself,
   * one of {@link PRACTICE_AUTO_ADVANCE_MS}; 0 waits for Next. An answer with authored notes
   * always waits, so they can be read.
   */
  practiceAutoAdvanceMs: PracticeAutoAdvanceMs;
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
export const ONBOARDING_HINTS = ["maia-curve"] as const;
export type OnboardingHintId = (typeof ONBOARDING_HINTS)[number];

export type ReviewCommentaryProvider = "openrouter";

/** Repertoire practice's auto-advance choices (ms): off, then quick to slow. */
export const PRACTICE_AUTO_ADVANCE_MS = [0, 600, 1500, 3000] as const;
export type PracticeAutoAdvanceMs = (typeof PRACTICE_AUTO_ADVANCE_MS)[number];

export type ReviewMaiaLevel = MaiaRating;
export const REVIEW_MAIA_LEVELS: readonly ReviewMaiaLevel[] = [
  1100, 1300, 1500, 1700, 1900
] as const;
export const MAX_ENGINE_THREADS = 8;

/** How far live analysis searches each position: until stopped (as Lichess's infinite analysis), to a depth, or for a time. */
export const ANALYSIS_LIMITS = ["infinite", "depth", "time"] as const;
export type AnalysisLimit = (typeof ANALYSIS_LIMITS)[number];
export const ANALYSIS_LINES_RANGE = { min: 1, max: 5 } as const;
export const EVAL_BAR_SIDES = ["left", "right"] as const;
export type EvalBarSide = (typeof EVAL_BAR_SIDES)[number];
export const ANALYSIS_DEPTH_RANGE = { min: 8, max: 60 } as const;
export const ANALYSIS_TIME_RANGE_SEC = { min: 1, max: 300 } as const;
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
  slate: { light: "#c9d1d9", dark: "#59636f" },
  sapphire: { light: "#5188ca", dark: "#2a63aa" }
};

export const defaultSettings: AppSettings = {
  boardOrientation: "white",
  boardTheme: "brown",
  boardSquareLight: null,
  boardSquareDark: null,
  pieceStyle: "cburnett",
  pieceSizes: "ladder",
  showCoordinates: true,
  showLegalMoves: true,
  boardAnimation: true,
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
  playerRatings: uniformRatings(),
  ratingsAccount: "lichess",
  reviewPlayerColor: "white",
  reviewShowTopLines: true,
  reviewMultiPv: 3,
  reviewMaiaLevels: null,
  analysisEngineId: null,
  analysisLines: 3,
  analysisLimit: "infinite",
  analysisDepth: 24,
  analysisTimeSec: 10,
  analysisBestMoveArrow: true,
  analysisEvalBar: true,
  analysisEvalBarSide: "left",
  engineThreads: null,
  engineHashMb: 128,
  recentFilePaths: [],
  updatesAutoDownload: true,
  usageAnalyticsEnabled: true,
  lc0AutoDetect: true,
  theme: "dark",
  lastOpenedGameId: null,
  repertoireCompareWhite: null,
  repertoireCompareBlack: null,
  // The pace practice always had: a correct answer moves on after 0.6 s.
  practiceAutoAdvanceMs: 600,
  onboardingCompletedAt: null,
  onboardingHintsSeen: []
};

/**
 * Settings older builds stored that are no longer settings; read once, at startup, to migrate them
 * (main/rating-migration.ts). `reviewPlayerRating`: the one rating every mode now starts from.
 */
export type LegacySettingKey = "reviewPlayerRating";

/** Whether `key` names a setting (every setting has a default). */
export function isSettingKey(key: string): key is keyof AppSettings {
  return Object.hasOwn(defaultSettings, key);
}

/** The settings a patch sets. */
export function settingKeys(
  patch: Partial<Record<keyof AppSettings, unknown>>
): (keyof AppSettings)[] {
  return Object.keys(patch).filter(isSettingKey);
}

export function isPieceStyle(value: unknown): value is PieceStyle {
  return isOneOf(ALL_PIECE_STYLES, value);
}

export function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === "string" && Object.hasOwn(boardThemeSquareColors, value);
}

/** Maps persisted settings from older builds onto current {@link PieceStyle} ids. */
export function normalizePieceStyle(value: unknown): PieceStyle {
  if (typeof value !== "string") return defaultSettings.pieceStyle;
  if (legacyPieceStyleMap[value]) return legacyPieceStyleMap[value]!;
  return isOneOf(ALL_PIECE_STYLES, value) ? value : defaultSettings.pieceStyle;
}

/** The current set for an id older builds stored (`staunton`, `cburnettSoft`, …); null for anything else. */
export function legacyPieceStyle(value: string): PieceStyle | null {
  return legacyPieceStyleMap[value] ?? null;
}

export function normalizePieceSizes(value: unknown): PieceSizes {
  return typeof value === "string" && isOneOf(ALL_PIECE_SIZES, value)
    ? value
    : defaultSettings.pieceSizes;
}

/**
 * Normalizes the piece settings (older set ids, unknown sizes) and drops `piecePresentation`,
 * the piece look older builds stored. Idempotent.
 */
export function hydratePieceSettings(settings: AppSettings): AppSettings {
  const { piecePresentation: _removed, ...rest } = settings as AppSettings & {
    piecePresentation?: unknown;
  };
  return {
    ...rest,
    pieceStyle: normalizePieceStyle(settings.pieceStyle),
    pieceSizes: normalizePieceSizes(settings.pieceSizes)
  };
}

/**
 * Drops window settings older builds stored that no longer exist (`glassEffect`: the translucent
 * window is always on now, unless the system's Reduce transparency is). Idempotent.
 */
export function normalizeAppearanceSettings(settings: AppSettings): AppSettings {
  if (!("glassEffect" in settings)) return settings;
  const rest: AppSettings & { glassEffect?: unknown } = { ...settings };
  delete rest.glassEffect;
  return rest;
}

/** Validates the practice settings, falling back to defaults for bad values. Idempotent. */
export function normalizePracticeSettings(settings: AppSettings): AppSettings {
  const delay: unknown = settings.practiceAutoAdvanceMs;
  return {
    ...settings,
    practiceAutoAdvanceMs: isOneOf(PRACTICE_AUTO_ADVANCE_MS, delay)
      ? delay
      : defaultSettings.practiceAutoAdvanceMs
  };
}

/** Validates the in-app update settings, falling back to defaults for bad values. Idempotent. */
export function normalizeUpdateSettings(settings: AppSettings): AppSettings {
  // `updatesIncludeBeta` (older builds): there are no beta releases to opt in to any more.
  const rest: AppSettings & { updatesIncludeBeta?: unknown } = { ...settings };
  delete rest.updatesIncludeBeta;
  return {
    ...rest,
    updatesAutoDownload:
      typeof settings.updatesAutoDownload === "boolean"
        ? settings.updatesAutoDownload
        : defaultSettings.updatesAutoDownload
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

/**
 * Validates the per-mode ratings (a damaged mode falls back to the default) and the account picked
 * to fill them, and drops the single rating older builds stored, which startup migrated into them.
 * Idempotent.
 */
export function normalizeRatingSettings(settings: AppSettings): AppSettings {
  const rest: AppSettings & { reviewPlayerRating?: unknown } = { ...settings };
  delete rest.reviewPlayerRating;
  const account: unknown = settings.ratingsAccount;
  return {
    ...rest,
    playerRatings: normalizePlayerRatings(settings.playerRatings),
    ratingsAccount: isOneOf(RATINGS_ACCOUNTS, account) ? account : defaultSettings.ratingsAccount
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
    // A legacy value not yet migrated at startup (see main/index.ts) reads as OpenRouter.
    reviewCommentaryProvider: normalizeCommentaryProvider(settings.reviewCommentaryProvider)
  };
}
