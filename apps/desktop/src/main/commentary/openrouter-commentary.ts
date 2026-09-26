import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "@chaturanga/shared/schemas";
import {
  COACH_SYSTEM_PROMPT,
  buildRetryMessage,
  buildUserMessage,
  maxTokensForDetail,
  validateProse,
  type CommentaryValidationResult
} from "@chaturanga/shared/llm/commentary";
import type { ReviewCommentary } from "@chaturanga/shared/types/engine";
import { DEFAULT_COMMENTARY_MODEL } from "@chaturanga/shared/llm/models";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 45_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type OpenRouterCommentaryOptions = {
  apiKey: string | null;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
};

export type OpenRouterCommentaryResult = {
  commentary: ReviewCommentary[];
  /** A safe, user-facing status; provider response bodies and secrets are never returned. */
  error: string | null;
};

export const NO_API_KEY_ERROR = "Add an OpenRouter API key in Settings → Commentary to get commentary.";
/** A key is saved but can't be decrypted on this computer (keychain access denied, copied profile). */
export const UNREADABLE_API_KEY_ERROR =
  "Your saved OpenRouter key couldn't be read on this computer. Add it again in Settings → Commentary.";
const UNREACHABLE_ERROR = "OpenRouter couldn't be reached. Check your connection and try again.";
const TIMEOUT_ERROR = "OpenRouter took too long to answer. Try again in a moment.";
const EMPTY_ANSWER_ERROR = "The model returned an empty answer. Try again, or pick another model.";
const INVALID_ANSWER_ERROR = "The model's answer didn't match the engine facts, even after a retry.";

/**
 * A failure with a message that is safe to show. Provider response bodies and credential-bearing
 * errors are never passed through; anything else reads as {@link UNREACHABLE_ERROR}.
 */
class CommentaryFailure extends Error {}

function httpFailure(status: number): CommentaryFailure {
  if (status === 401 || status === 403) {
    return new CommentaryFailure("OpenRouter rejected the API key. Check it in Settings → Commentary.");
  }
  if (status === 402) return new CommentaryFailure("Your OpenRouter account is out of credits.");
  if (status === 404) {
    return new CommentaryFailure("OpenRouter doesn't know this model. Check the model name in Settings → Commentary.");
  }
  if (status === 429) return new CommentaryFailure("OpenRouter is rate limiting requests. Try again in a moment.");
  return new CommentaryFailure(`OpenRouter returned an error (${status}). Try again in a moment.`);
}

/**
 * Generate a grounded batch from OpenRouter in the main process.
 *
 * Only accepted (validated) explanations are returned. A ply whose request or validation fails
 * (after the one corrective retry) is left out and `error` says why, so the renderer can offer a
 * retry for that move. The API key never leaves the main process.
 */
export async function generateOpenRouterCommentary(
  payloads: readonly ReviewInsightPayload[],
  options: OpenRouterCommentaryOptions
): Promise<OpenRouterCommentaryResult> {
  const now = options.now ?? Date.now;
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return { commentary: [], error: NO_API_KEY_ERROR };

  const model = options.model?.trim() || DEFAULT_COMMENTARY_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  let error: string | null = null;
  const results = await mapWithConcurrency(payloads, 3, async (payload) => {
    try {
      const result = await generateOne(payload, apiKey, model, fetchImpl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return { ...result, generatedAt: now() };
    } catch (failure) {
      error ??= failure instanceof CommentaryFailure ? failure.message : UNREACHABLE_ERROR;
      return null;
    }
  });

  return { commentary: results.filter((item): item is ReviewCommentary => item !== null), error };
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function accepted(
  payload: ReviewInsightPayload,
  model: string,
  check: Extract<CommentaryValidationResult, { ok: true }>
): Omit<ReviewCommentary, "generatedAt"> {
  return {
    ply: payload.game.ply,
    prose: check.prose,
    ...(check.headline ? { headline: check.headline } : {}),
    providerModel: model
  };
}

async function generateOne(
  payload: ReviewInsightPayload,
  apiKey: string,
  model: string,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<Omit<ReviewCommentary, "generatedAt">> {
  const messages: ChatMessage[] = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(payload) }
  ];
  const first = await requestCompletion(payload, apiKey, model, messages, 0.7, fetchImpl, timeoutMs);
  const firstCheck = validateProse(first, payload);
  if (firstCheck.ok) return accepted(payload, model, firstCheck);

  // One retry that tells the model exactly what was wrong with its answer.
  const retry: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first },
    { role: "user", content: buildRetryMessage(firstCheck, payload) }
  ];
  const second = await requestCompletion(payload, apiKey, model, retry, 0.3, fetchImpl, timeoutMs);
  const secondCheck = validateProse(second, payload);
  if (secondCheck.ok) return accepted(payload, model, secondCheck);
  throw new CommentaryFailure(INVALID_ANSWER_ERROR);
}

async function requestCompletion(
  payload: ReviewInsightPayload,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://chaturanga.app",
        "X-Title": "Chaturanga"
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokensForDetail(payload.commentaryDetail),
        messages
      }),
      signal: controller.signal
    });
    if (!response.ok) throw httpFailure(response.status);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new CommentaryFailure(EMPTY_ANSWER_ERROR);
    }
    return content.trim();
  } catch (error) {
    if (timedOut) throw new CommentaryFailure(TIMEOUT_ERROR);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Validate at the main-process boundary before any provider call. */
export function parseCommentaryPayloads(input: unknown): ReviewInsightPayload[] {
  return reviewInsightPayloadSchema.array().min(1).max(600).parse(input);
}
