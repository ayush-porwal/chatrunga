import {
  boardThemeSquareColors,
  ENGINE_HASH_MB_RANGE,
  normalizeBoardSquareHex,
  ONBOARDING_HINTS,
  REVIEW_MAIA_LEVELS,
  type AppSettings
} from "@chaturanga/shared/types/settings";

type Check = (value: unknown) => boolean;

const bool: Check = (value) => typeof value === "boolean";
const oneOf =
  (...allowed: readonly unknown[]): Check =>
  (value) =>
    allowed.includes(value);
const number =
  (min: number, max: number, integer = false): Check =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const text =
  (maxLength: number): Check =>
  (value) =>
    typeof value === "string" && value.length <= maxLength;
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const list =
  (item: Check, maxItems: number): Check =>
  (value) =>
    Array.isArray(value) && value.length <= maxItems && value.every(item);
const hexColor: Check = (value) => typeof value === "string" && normalizeBoardSquareHex(value) !== null;

/**
 * What each setting may hold. Typed over every key, so a new setting doesn't compile until it has
 * a check. Values read back are normalized as well (settings.ts); this stops bad ones being stored.
 */
const SETTING_CHECKS: { [K in keyof AppSettings]-?: Check } = {
  boardOrientation: oneOf("white", "black"),
  boardTheme: oneOf(...Object.keys(boardThemeSquareColors)),
  boardSquareLight: nullable(hexColor),
  boardSquareDark: nullable(hexColor),
  // Older ids are mapped on read (normalizePieceStyle).
  pieceStyle: text(40),
  piecePresentation: oneOf("default", "sharp", "soft", "contrast"),
  showCoordinates: bool,
  showLegalMoves: bool,
  boardAnimation: bool,
  soundEnabled: bool,
  soundVolume: number(0, 1),
  defaultEngineId: nullable(text(200)),
  lastEngineMoveTimeMs: number(1, 3_600_000),
  lastEngineDepth: nullable(number(1, 200, true)),
  reviewSearchTimeMs: number(10, 600_000),
  reviewUseMaia: bool,
  reviewCommentaryEnabled: bool,
  reviewCommentaryProvider: oneOf("openrouter"),
  reviewCommentaryDetail: oneOf("concise", "balanced", "detailed"),
  reviewPlayerRating: number(0, 4000),
  reviewPlayerColor: oneOf("white", "black"),
  reviewShowTopLines: bool,
  reviewMultiPv: number(1, 5, true),
  reviewMaiaLevels: nullable(list(oneOf(...REVIEW_MAIA_LEVELS), REVIEW_MAIA_LEVELS.length)),
  engineThreads: nullable(number(1, 1024, true)),
  engineHashMb: number(ENGINE_HASH_MB_RANGE.min, ENGINE_HASH_MB_RANGE.max, true),
  recentFilePaths: list(text(4096), 50),
  updatesAutoDownload: bool,
  usageAnalyticsEnabled: bool,
  lc0AutoDetect: bool,
  theme: oneOf("light", "dark"),
  lastOpenedGameId: nullable(text(200)),
  onboardingCompletedAt: nullable(number(0, Number.MAX_SAFE_INTEGER, true)),
  onboardingHintsSeen: list(oneOf(...ONBOARDING_HINTS), ONBOARDING_HINTS.length)
};

/** `value` if it fits `key` (square colors stored as `#rrggbb`), else an error (nothing is stored). */
export function parseSettingValue<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] {
  if (!SETTING_CHECKS[key](value)) throw new Error(`Invalid value for setting ${key}`);
  if ((key === "boardSquareLight" || key === "boardSquareDark") && typeof value === "string") {
    return normalizeBoardSquareHex(value) as AppSettings[K];
  }
  return value as AppSettings[K];
}
