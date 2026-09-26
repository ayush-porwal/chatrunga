import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "@chaturanga/shared/schemas";
import {
  COACH_SYSTEM_PROMPT,
  buildRetryMessage,
  buildUserMessage,
  coachFallback,
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

/**
 * Generate a grounded batch from OpenRouter in the main process.
 *
 * Missing credentials and every provider/validation failure resolve to the
 * deterministic local template. The caller can therefore keep the review
 * usable without exposing an API key to the renderer.
 */
export async function generateOpenRouterCommentary(
  payloads: readonly ReviewInsightPayload[],
  options: OpenRouterCommentaryOptions
): Promise<OpenRouterCommentaryResult> {
  const now = options.now ?? Date.now;
  if (!options.apiKey?.trim()) {
    return {
      commentary: payloads.map((payload) => ({ ...localCommentary(payload), generatedAt: now() })),
      error: null
    };
  }

  const model = options.model?.trim() || DEFAULT_COMMENTARY_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  let providerFailed = false;
  const commentary = await mapWithConcurrency(payloads, 3, async (payload) => {
    const result = await generateOne(payload, options.apiKey as string, model, fetchImpl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (result.source === "local-fallback") providerFailed = true;
    return { ...result, generatedAt: now() };
  });

  return {
    commentary,
    error: providerFailed
      ? "OpenRouter commentary was unavailable or invalid; local fallback is shown."
      : null
  };
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
    ...(check.takeaway ? { takeaway: check.takeaway } : {}),
    providerModel: model,
    fallback: false,
    source: "openrouter"
  };
}

async function generateOne(
  payload: ReviewInsightPayload,
  apiKey: string,
  model: string,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<Omit<ReviewCommentary, "generatedAt">> {
  try {
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
  } catch {
    // Never propagate upstream response bodies or credential-bearing errors.
  }
  return localCommentary(payload);
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
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    if (!response.ok) throw new Error(`OpenRouter request failed: ${response.status}`);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenRouter returned no prose");
    }
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function localCommentary(payload: ReviewInsightPayload): Omit<ReviewCommentary, "generatedAt"> {
  const parts = coachFallback(payload);
  return {
    ply: payload.game.ply,
    prose: parts.body,
    ...(parts.headline ? { headline: parts.headline } : {}),
    ...(parts.takeaway ? { takeaway: parts.takeaway } : {}),
    providerModel: "local-template",
    fallback: true,
    source: "local-fallback"
  };
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
