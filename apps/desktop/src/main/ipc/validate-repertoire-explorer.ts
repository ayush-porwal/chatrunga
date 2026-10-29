/**
 * The `repertoireExplorer.*` IPC inputs, checked (they come from the renderer) and rebuilt from
 * known fields only.
 */
import { MAIA3_RATING_RANGE } from "@chaturanga/shared/engine/maia3";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { RATING_MODES } from "@chaturanga/shared/types/ratings";
import type {
  ExplorerMaiaInput,
  ExplorerPositionInput
} from "@chaturanga/shared/types/repertoire-explorer";
import { asFen, asId, asIntegerInRange, asObject, fail, nullable } from "./fields";

/** Run check names at most this many repertoires at once. */
const MAX_REPERTOIRES = 1_000;

export function parseExplorerPositionInput(value: unknown): ExplorerPositionInput {
  const input = asObject(value, "explorer input");
  return { repertoireId: asId(input.repertoireId, "repertoireId"), fen: asFen(input.fen) };
}

export function parseExplorerMaiaInput(value: unknown): ExplorerMaiaInput {
  const input = asObject(value, "Maia input");
  const { min, max } = MAIA3_RATING_RANGE;
  const mode = input.mode;
  if (mode !== null && !isOneOf(RATING_MODES, mode)) fail("mode", "expected a time control");
  return {
    ...parseExplorerPositionInput(value),
    rating:
      nullable(input.rating, (rating) => asIntegerInRange(rating, "rating", min, max)) ?? null,
    mode
  };
}

/** The repertoires Run check names (each once). */
export function parseRepertoireIds(value: unknown): string[] {
  if (!Array.isArray(value)) fail("repertoireIds", "expected an array");
  if (value.length > MAX_REPERTOIRES) fail("repertoireIds", "too many items");
  return [...new Set(value.map((id: unknown) => asId(id, "repertoire id")))];
}
