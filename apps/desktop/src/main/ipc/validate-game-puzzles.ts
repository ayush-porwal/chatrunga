/**
 * The `gamePuzzles.*` IPC inputs, checked (they come from the renderer) and rebuilt from known
 * fields only.
 */
import { MAIA3_RATING_RANGE } from "@chaturanga/shared/engine/maia3";
import {
  GAME_PUZZLE_DEPTH_PRESETS,
  GAME_PUZZLE_GAME_LIMITS,
  GAME_PUZZLE_KINDS,
  GAME_PUZZLE_OUTCOMES,
  GAME_PUZZLE_SOURCES,
  type GamePuzzleAttemptInput,
  type GamePuzzleQuery,
  type GamePuzzleSettings
} from "@chaturanga/shared/types/game-puzzles";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { RATING_MODES } from "@chaturanga/shared/types/ratings";
import { asBoolean, asId, asIntegerInRange, asObject, fail, nullable, optional } from "./fields";

/** A session leaves out at most this many puzzles it has shown. */
const MAX_EXCLUDED = 10_000;
const MAX_LIST = 500;

/** A list of members of `values`, each once, in the order given. */
function asMembers<const T extends string>(
  value: unknown,
  label: string,
  values: readonly T[]
): T[] {
  if (!Array.isArray(value)) fail(label, "expected an array");
  if (value.length > values.length * 4) fail(label, "too many items");
  const members = value.map((item: unknown) => {
    if (!isOneOf(values, item)) fail(label, `expected ${values.join(", ")}`);
    return item;
  });
  return [...new Set(members)];
}

function asGameLimit(value: unknown): number {
  if (!isOneOf(GAME_PUZZLE_GAME_LIMITS, value))
    fail("game limit", `expected ${GAME_PUZZLE_GAME_LIMITS.join(", ")} or null`);
  return value;
}

export function parseGamePuzzleSettings(value: unknown): GamePuzzleSettings {
  const input = asObject(value, "puzzle generation settings");
  const limit = input.limit === null ? null : asGameLimit(input.limit);
  if (!isOneOf(GAME_PUZZLE_DEPTH_PRESETS, input.depth))
    fail("depth", `expected ${GAME_PUZZLE_DEPTH_PRESETS.join(", ")}`);
  return {
    sources: asMembers(input.sources, "sources", GAME_PUZZLE_SOURCES),
    timeControls: asMembers(input.timeControls, "time controls", RATING_MODES),
    limit,
    skipProcessed: asBoolean(input.skipProcessed, "skip processed"),
    kinds: asMembers(input.kinds, "puzzle kinds", GAME_PUZZLE_KINDS),
    depth: input.depth
  };
}

function asDifficultyRange(value: unknown): { min: number; max: number } {
  const input = asObject(value, "difficulty range");
  const { min, max } = MAIA3_RATING_RANGE;
  const range = {
    min: asIntegerInRange(input.min, "minimum difficulty", min, max),
    max: asIntegerInRange(input.max, "maximum difficulty", min, max)
  };
  if (range.min > range.max) fail("difficulty range", "minimum above maximum");
  return range;
}

function asIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(label, "expected an array");
  if (value.length > MAX_EXCLUDED) fail(label, "too many items");
  return value.map((item, index) => asId(item, `${label}[${index}]`));
}

export function parseGamePuzzleQuery(value: unknown): GamePuzzleQuery {
  const input = asObject(value, "puzzle query");
  const query: GamePuzzleQuery = {};
  const kinds = optional(input.kinds, (kinds) =>
    asMembers(kinds, "puzzle kinds", GAME_PUZZLE_KINDS)
  );
  const sources = optional(input.sources, (sources) =>
    asMembers(sources, "sources", GAME_PUZZLE_SOURCES)
  );
  const difficulty = nullable(input.difficulty, asDifficultyRange);
  const excludeIds = optional(input.excludeIds, (ids) => asIds(ids, "excluded puzzles"));
  const limit = optional(input.limit, (limit) => asIntegerInRange(limit, "limit", 1, MAX_LIST));
  if (kinds) query.kinds = kinds;
  if (sources) query.sources = sources;
  if (difficulty !== undefined) query.difficulty = difficulty;
  if (excludeIds) query.excludeIds = excludeIds;
  if (limit !== undefined) query.limit = limit;
  return query;
}

export function parseGamePuzzleAttemptInput(value: unknown): GamePuzzleAttemptInput {
  const input = asObject(value, "puzzle attempt");
  if (!isOneOf(GAME_PUZZLE_OUTCOMES, input.outcome))
    fail("puzzle outcome", `expected ${GAME_PUZZLE_OUTCOMES.join(", ")}`);
  return { puzzleId: asId(input.puzzleId, "puzzle id"), outcome: input.outcome };
}
