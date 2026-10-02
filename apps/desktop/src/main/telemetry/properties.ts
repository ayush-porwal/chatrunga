import { basename } from "node:path";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { DEFAULT_COMMENTARY_MODEL } from "@chaturanga/shared/llm/models";

/**
 * Coarse, allowlisted descriptions for analytics: never an engine's own name or path, never a
 * custom model string, never error text.
 */

export type EngineFamily = "stockfish" | "lc0" | "other";

/** The engine family from its name and executable file name; anything unrecognised is "other". */
export function engineFamily(config: Pick<EngineConfig, "name" | "executablePath">): EngineFamily {
  const label = `${config.name} ${basename(config.executablePath)}`.toLowerCase();
  if (label.includes("stockfish")) return "stockfish";
  if (label.includes("lc0") || label.includes("leela")) return "lc0";
  return "other";
}

/** OpenRouter vendors reported as such; a model from any other vendor reads as "custom". */
const KNOWN_MODEL_VENDORS = new Set([
  "anthropic",
  "openai",
  "google",
  "meta-llama",
  "mistralai",
  "deepseek",
  "qwen",
  "x-ai",
  "cohere",
  "amazon",
  "microsoft",
  "nvidia",
  "moonshotai",
  "z-ai"
]);

/** The model's vendor (`anthropic/…` → `anthropic`), and the model id only when it's the default. */
export function modelProperties(model: string): {
  model_vendor: string;
  model_is_default: boolean;
} {
  const trimmed = model.trim() || DEFAULT_COMMENTARY_MODEL;
  const vendor = trimmed.split("/")[0]?.toLowerCase() ?? "";
  return {
    model_vendor: KNOWN_MODEL_VENDORS.has(vendor) ? vendor : "custom",
    model_is_default: trimmed === DEFAULT_COMMENTARY_MODEL
  };
}

/** Why a review failed, as a code (the message itself is never sent). */
export type ReviewFailureCode =
  | "engine_not_found"
  | "engine_unavailable"
  | "engine_exited"
  | "timeout"
  | "unknown";

export function reviewFailureCode(error: unknown): ReviewFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/engine not found/i.test(message)) return "engine_not_found";
  if (/not available|ENOENT|EACCES|spawn/i.test(message)) return "engine_unavailable";
  if (/exited|crash|killed/i.test(message)) return "engine_exited";
  if (/timed out|timeout/i.test(message)) return "timeout";
  return "unknown";
}

/** A count rounded into a coarse bucket (`"41-80"`), for distributions without exact sizes. */
export function plyBucket(plies: number): string {
  if (plies <= 20) return "1-20";
  if (plies <= 40) return "21-40";
  if (plies <= 80) return "41-80";
  if (plies <= 120) return "81-120";
  return "121+";
}
