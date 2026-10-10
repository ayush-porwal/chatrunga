import {
  isBoardTheme,
  isPieceStyle,
  ANALYSIS_DEPTH_RANGE,
  ANALYSIS_LIMITS,
  ANALYSIS_LINES_RANGE,
  ANALYSIS_TIME_RANGE_SEC,
  ENGINE_HASH_MB_RANGE,
  EVAL_BAR_SIDES,
  normalizeBoardSquareHex,
  legacyPieceStyle,
  ONBOARDING_HINTS,
  PRACTICE_AUTO_ADVANCE_MS,
  REVIEW_MAIA_LEVELS,
  type AppSettings
} from "@chaturanga/shared/types/settings";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { isPlayerRatings, RATINGS_ACCOUNTS } from "@chaturanga/shared/types/ratings";

/** Whether a value fits a setting, narrowing it to the setting's type. */
type Check<T> = (value: unknown) => value is T;

const bool: Check<boolean> = (value) => typeof value === "boolean";
const oneOf =
  <const T extends string | number>(...allowed: readonly T[]): Check<T> =>
  (value): value is T =>
    isOneOf(allowed, value);
const number =
  (min: number, max: number, integer = false): Check<number> =>
  (value): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value));
const text =
  (maxLength: number): Check<string> =>
  (value): value is string =>
    typeof value === "string" && value.length <= maxLength;
const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (value): value is T | null =>
    value === null || check(value);
const list =
  <T>(item: Check<T>, maxItems: number): Check<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.length <= maxItems && value.every(item);
const hexColor: Check<string> = (value): value is string =>
  typeof value === "string" && normalizeBoardSquareHex(value) !== null;

/**
 * What each setting may hold. Typed over every key, so a new setting doesn't compile until it has
 * a check. Values read back are normalized as well (settings.ts); this stops bad ones being stored.
 */
const SETTING_CHECKS: { [K in keyof AppSettings]: Check<AppSettings[K]> } = {
  boardOrientation: oneOf("white", "black"),
  boardTheme: isBoardTheme,
  boardSquareLight: nullable(hexColor),
  boardSquareDark: nullable(hexColor),
  // Older ids are mapped to current ones first (see NORMALIZE).
  pieceStyle: isPieceStyle,
  pieceSizes: oneOf("ladder", "uniform"),
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
  playerRatings: isPlayerRatings,
  ratingsAccount: oneOf(...RATINGS_ACCOUNTS),
  reviewPlayerColor: oneOf("white", "black"),
  reviewShowTopLines: bool,
  reviewMultiPv: number(1, 5, true),
  reviewMaiaLevels: nullable(list(oneOf(...REVIEW_MAIA_LEVELS), REVIEW_MAIA_LEVELS.length)),
  analysisEngineId: nullable(text(200)),
  analysisLines: number(ANALYSIS_LINES_RANGE.min, ANALYSIS_LINES_RANGE.max, true),
  analysisLimit: oneOf(...ANALYSIS_LIMITS),
  analysisDepth: number(ANALYSIS_DEPTH_RANGE.min, ANALYSIS_DEPTH_RANGE.max, true),
  analysisTimeSec: number(ANALYSIS_TIME_RANGE_SEC.min, ANALYSIS_TIME_RANGE_SEC.max, true),
  analysisBestMoveArrow: bool,
  analysisEvalBar: bool,
  analysisEvalBarSide: oneOf(...EVAL_BAR_SIDES),
  engineThreads: nullable(number(1, 1024, true)),
  engineHashMb: number(ENGINE_HASH_MB_RANGE.min, ENGINE_HASH_MB_RANGE.max, true),
  recentFilePaths: list(text(4096), 50),
  updatesAutoDownload: bool,
  usageAnalyticsEnabled: bool,
  lc0AutoDetect: bool,
  theme: oneOf("light", "dark"),
  lastOpenedGameId: nullable(text(200)),
  repertoireCompareWhite: nullable(text(200)),
  repertoireCompareBlack: nullable(text(200)),
  practiceAutoAdvanceMs: oneOf(...PRACTICE_AUTO_ADVANCE_MS),
  onboardingCompletedAt: nullable(number(0, Number.MAX_SAFE_INTEGER, true)),
  onboardingHintsSeen: list(oneOf(...ONBOARDING_HINTS), ONBOARDING_HINTS.length)
};

/** Text some settings are stored in a canonical form of: `#rrggbb` colors, current piece set ids. */
const NORMALIZE: Partial<Record<keyof AppSettings, (value: string) => string>> = {
  boardSquareLight: (value) => normalizeBoardSquareHex(value) ?? value,
  boardSquareDark: (value) => normalizeBoardSquareHex(value) ?? value,
  // An older build's id becomes the current one; an unknown id stays as it is, and is refused.
  pieceStyle: (value) => legacyPieceStyle(value) ?? value
};

/** `value` if it fits `key` (square colors stored as `#rrggbb`), else an error (nothing is stored). */
export function parseSettingValue<K extends keyof AppSettings>(
  key: K,
  value: unknown
): AppSettings[K] {
  const normalize = NORMALIZE[key];
  const normalized = normalize && typeof value === "string" ? normalize(value) : value;
  const check: Check<AppSettings[K]> = SETTING_CHECKS[key];
  if (!check(normalized)) throw new Error(`Invalid value for setting ${key}`);
  return normalized;
}

/** What writing `value` to `key` stores: the setting alone, in its canonical form. */
export function parseSettingWrite<K extends keyof AppSettings>(
  key: K,
  value: unknown
): Partial<Record<keyof AppSettings, unknown>> {
  return { [key]: parseSettingValue(key, value) };
}
