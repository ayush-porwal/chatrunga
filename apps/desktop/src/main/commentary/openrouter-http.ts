/**
 * What every OpenRouter chat request shares (review commentary, puzzle explanations, book
 * import): the endpoint and headers, the user-facing meaning of an HTTP error, and reading the
 * answer and its usage. Responses are data from outside: checked, never cast.
 */
import { isRecord } from "@chaturanga/shared/types/guards";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Request headers: the key (main process only) and the app's attribution. */
export function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://chaturanga.ayushporwal.com",
    "X-Title": "Chaturanga"
  };
}

export type OpenRouterHttpFailureCode =
  | "invalid_key"
  | "insufficient_credits"
  | "invalid_model"
  | "rate_limited"
  | "provider_error";

/** An HTTP error as a message safe to show (provider bodies are never passed on) and a code. */
export function openRouterHttpFailure(status: number): {
  message: string;
  code: OpenRouterHttpFailureCode;
} {
  if (status === 401 || status === 403) {
    return {
      message: "OpenRouter rejected the API key. Check it in Settings → Commentary.",
      code: "invalid_key"
    };
  }
  if (status === 402)
    return { message: "Your OpenRouter account is out of credits.", code: "insufficient_credits" };
  if (status === 404) {
    return {
      message: "OpenRouter doesn't know this model. Check the model name in Settings → Commentary.",
      code: "invalid_model"
    };
  }
  if (status === 429) {
    return {
      message: "OpenRouter is rate limiting requests. Try again in a moment.",
      code: "rate_limited"
    };
  }
  return {
    message: `OpenRouter returned an error (${status}). Try again in a moment.`,
    code: "provider_error"
  };
}

function firstChoice(body: unknown): Record<string, unknown> | null {
  const choices: unknown = isRecord(body) ? body.choices : undefined;
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  return isRecord(choice) ? choice : null;
}

/** The first choice's answer, trimmed; null when the response has none or it is blank. */
export function completionText(body: unknown): string | null {
  const message = firstChoice(body)?.message;
  const content = isRecord(message) ? message.content : undefined;
  return typeof content === "string" ? content.trim() || null : null;
}

/**
 * The model stopped at its output limit (`finish_reason: "length"`; requests set no `max_tokens`,
 * so the model's own maximum). With no answer text, a thinking model spent it all reasoning:
 * OpenRouter then returns `content: null` and only the reasoning (or nothing, with
 * `reasoning.exclude`).
 */
export function completionHitTokenLimit(body: unknown): boolean {
  return firstChoice(body)?.finish_reason === "length";
}

/** Token counts and cost as OpenRouter reported them; a field it didn't report stays unknown. */
export type OpenRouterUsage = {
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
};

/**
 * OpenRouter's usage block (`prompt_tokens`, `completion_tokens`, `cost` in USD), kept only as
 * numbers; anything missing or malformed stays unknown — never zero. `completion_tokens` includes
 * a thinking model's reasoning (also given as `completion_tokens_details.reasoning_tokens`, not
 * kept); other fields are ignored.
 */
export function parseUsage(value: unknown): OpenRouterUsage | null {
  if (!isRecord(value)) return null;
  const usage = value;
  const count = (field: unknown) =>
    typeof field === "number" && Number.isFinite(field) && field >= 0 ? field : undefined;
  const parsed: OpenRouterUsage = {
    promptTokens: count(usage.prompt_tokens),
    completionTokens: count(usage.completion_tokens),
    costUsd: count(usage.cost)
  };
  // Object.values types the optional fields as present; any of them may be unset.
  const fields: (number | undefined)[] = Object.values(parsed);
  return fields.some((field) => field !== undefined) ? parsed : null;
}
