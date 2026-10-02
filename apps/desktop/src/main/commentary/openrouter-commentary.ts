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
  /** Monotonic clock for latencies (ms). */
  monotonic?: () => number;
  /** Told about each move's request, every HTTP attempt and the outcome (usage analytics). */
  report?: (event: CommentaryReport) => void;
};

/** Why a move's commentary failed, as a code (messages are for the UI; codes for analytics). */
export type CommentaryFailureCode =
  | "no_api_key"
  | "unreadable_key"
  | "invalid_key"
  | "insufficient_credits"
  | "invalid_model"
  | "rate_limited"
  | "provider_error"
  | "network"
  | "timeout"
  | "empty_response"
  | "validation_failed";

/** Token counts and cost as OpenRouter reported them; a field it didn't report stays unknown. */
export type CommentaryUsage = { promptTokens?: number; completionTokens?: number; costUsd?: number };

/**
 * One logical request per move (`request`), each HTTP attempt it took (`attempt`: the first, and
 * the corrective retry after a failed validation), and its single terminal `outcome`.
 */
export type CommentaryReport =
  | { type: "request"; ply: number }
  | {
      type: "attempt";
      ply: number;
      attempt: number;
      reason: "initial" | "validation_retry";
      /** `accepted` / `validation_failed` for an answer that arrived; otherwise why it didn't. */
      result: "accepted" | "validation_failed" | CommentaryFailureCode;
      httpStatus: number | null;
      latencyMs: number;
      usage: CommentaryUsage | null;
      /**
       * The request for usage analytics: the messages with player and engine names replaced
       * ({@link analyticsRedactor}), never the key.
       */
      request: { messages: readonly ChatMessage[]; temperature: number; maxTokens: number };
      /** The model's answer, when one arrived (names replaced the same way). */
      output: string | null;
    }
  | {
      type: "outcome";
      ply: number;
      ok: boolean;
      code: CommentaryFailureCode | null;
      attempts: number;
      firstAttemptValid: boolean;
      latencyMs: number;
      /** The accepted explanation (successful outcomes only; names replaced). */
      prose?: string;
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
class CommentaryFailure extends Error {
  constructor(
    message: string,
    readonly code: CommentaryFailureCode,
    readonly httpStatus: number | null = null
  ) {
    super(message);
  }
}

function httpFailure(status: number): CommentaryFailure {
  if (status === 401 || status === 403) {
    return new CommentaryFailure("OpenRouter rejected the API key. Check it in Settings → Commentary.", "invalid_key", status);
  }
  if (status === 402) return new CommentaryFailure("Your OpenRouter account is out of credits.", "insufficient_credits", status);
  if (status === 404) {
    return new CommentaryFailure(
      "OpenRouter doesn't know this model. Check the model name in Settings → Commentary.",
      "invalid_model",
      status
    );
  }
  if (status === 429) {
    return new CommentaryFailure("OpenRouter is rate limiting requests. Try again in a moment.", "rate_limited", status);
  }
  return new CommentaryFailure(`OpenRouter returned an error (${status}). Try again in a moment.`, "provider_error", status);
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
  const monotonic = options.monotonic ?? (() => performance.now());
  const report = (event: CommentaryReport) => {
    try {
      options.report?.(event);
    } catch {
      // Reporting is for analytics only; it never changes the commentary.
    }
  };
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    for (const payload of payloads) reportUnsent(report, payload.game.ply, "no_api_key");
    return { commentary: [], error: NO_API_KEY_ERROR };
  }

  const model = options.model?.trim() || DEFAULT_COMMENTARY_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  let error: string | null = null;
  const results = await mapWithConcurrency(payloads, 3, async (payload) => {
    const ply = payload.game.ply;
    const startedAt = monotonic();
    const trace: AttemptTrace = { attempts: 0, firstAttemptValid: false };
    report({ type: "request", ply });
    try {
      const result = await generateOne(payload, apiKey, model, fetchImpl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, {
        trace,
        monotonic,
        report
      });
      report({
        type: "outcome",
        ply,
        ok: true,
        code: null,
        ...trace,
        latencyMs: monotonic() - startedAt,
        prose: analyticsRedactor(payload)(result.prose)
      });
      return { ...result, generatedAt: now() };
    } catch (failure) {
      const known = failure instanceof CommentaryFailure ? failure : null;
      error ??= known ? known.message : UNREACHABLE_ERROR;
      report({ type: "outcome", ply, ok: false, code: known?.code ?? "network", ...trace, latencyMs: monotonic() - startedAt });
      return null;
    }
  });

  return { commentary: results.filter((item): item is ReviewCommentary => item !== null), error };
}

/**
 * For usage analytics: replaces the players' names (PGN headers; Lichess usernames for synced
 * games) and the engine's configured name with placeholders wherever they appear, in the prompt
 * and in the model's answer. What is sent to OpenRouter is unchanged.
 */
export function analyticsRedactor(payload: ReviewInsightPayload): (text: string) => string {
  const replacements: Array<[string, string]> = [];
  const add = (value: string | undefined, placeholder: string) => {
    // One Unicode form for names and text alike (é as one code point or e + accent).
    const trimmed = value?.normalize("NFC").trim();
    if (trimmed) replacements.push([trimmed, placeholder]);
  };
  add(payload.context?.players?.white, "[White]");
  add(payload.context?.players?.black, "[Black]");
  add(payload.engines.stockfish.engineName, "[engine]");
  if (!replacements.length) return (text) => text;
  // Longest first, so a name containing another is replaced whole; whole words only, so a short
  // name ("A") doesn't eat letters out of other words.
  replacements.sort((a, b) => b[0].length - a[0].length);
  // One group per name: the matching group picks the placeholder (re-keying the match by
  // lowercasing it would miss case-insensitive matches such as Σ / ς).
  const names = replacements.map(([value]) => `(${escapeRegExp(value)})`).join("|");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names})(?![\\p{L}\\p{N}_])`, "giu");
  return (text) =>
    text.normalize("NFC").replace(pattern, (match: string, ...groups: unknown[]) => {
      const index = groups.slice(0, replacements.length).findIndex((group) => group !== undefined);
      return index >= 0 ? replacements[index]![1] : match;
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A move whose request never reached the provider (no key): one request, no attempts, a failure. */
export function reportUnsent(report: (event: CommentaryReport) => void, ply: number, code: CommentaryFailureCode): void {
  report({ type: "request", ply });
  report({ type: "outcome", ply, ok: false, code, attempts: 0, firstAttemptValid: false, latencyMs: 0 });
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type AttemptTrace = { attempts: number; firstAttemptValid: boolean };

type Instrumentation = {
  trace: AttemptTrace;
  monotonic: () => number;
  report: (event: CommentaryReport) => void;
};

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
  timeoutMs: number,
  instrumentation: Instrumentation
): Promise<Omit<ReviewCommentary, "generatedAt">> {
  const { trace, monotonic, report } = instrumentation;
  const ply = payload.game.ply;
  const redact = analyticsRedactor(payload);
  /** One HTTP attempt, reported with its latency, outcome and (when known) usage. */
  const attempt = async (reason: "initial" | "validation_retry", messages: ChatMessage[], temperature: number) => {
    trace.attempts += 1;
    const startedAt = monotonic();
    const request = { messages, temperature, maxTokens: maxTokensForDetail(payload.commentaryDetail) };
    const reported = {
      ...request,
      messages: messages.map((message) => ({ role: message.role, content: redact(message.content) }))
    };
    const base = { type: "attempt" as const, ply, attempt: trace.attempts, reason, request: reported };
    try {
      const answer = await requestCompletion(apiKey, model, request, fetchImpl, timeoutMs);
      const check = validateProse(answer.content, payload);
      report({
        ...base,
        result: check.ok ? "accepted" : "validation_failed",
        httpStatus: 200,
        latencyMs: monotonic() - startedAt,
        usage: answer.usage,
        output: redact(answer.content)
      });
      return { content: answer.content, check };
    } catch (error) {
      const known = error instanceof CommentaryFailure ? error : null;
      report({
        ...base,
        result: known?.code ?? "network",
        httpStatus: known?.httpStatus ?? null,
        latencyMs: monotonic() - startedAt,
        usage: null,
        output: null
      });
      throw error;
    }
  };

  const messages: ChatMessage[] = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(payload) }
  ];
  const first = await attempt("initial", messages, 0.7);
  if (first.check.ok) {
    trace.firstAttemptValid = true;
    return accepted(payload, model, first.check);
  }

  // One retry that tells the model exactly what was wrong with its answer.
  const retry: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first.content },
    { role: "user", content: buildRetryMessage(first.check, payload) }
  ];
  const second = await attempt("validation_retry", retry, 0.3);
  if (second.check.ok) return accepted(payload, model, second.check);
  throw new CommentaryFailure(INVALID_ANSWER_ERROR, "validation_failed");
}

async function requestCompletion(
  apiKey: string,
  model: string,
  request: { messages: readonly ChatMessage[]; temperature: number; maxTokens: number },
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<{ content: string; usage: CommentaryUsage | null }> {
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
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        messages: request.messages
      }),
      signal: controller.signal
    });
    if (!response.ok) throw httpFailure(response.status);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new CommentaryFailure(EMPTY_ANSWER_ERROR, "empty_response", response.status);
    }
    return { content: content.trim(), usage: parseUsage(body.usage) };
  } catch (error) {
    if (timedOut) throw new CommentaryFailure(TIMEOUT_ERROR, "timeout");
    if (error instanceof CommentaryFailure) throw error;
    throw new CommentaryFailure(UNREACHABLE_ERROR, "network");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OpenRouter's usage block (`prompt_tokens`, `completion_tokens`, `cost` in USD), kept only as
 * numbers; anything missing or malformed stays unknown — never zero.
 */
export function parseUsage(value: unknown): CommentaryUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const count = (field: unknown) => (typeof field === "number" && Number.isFinite(field) && field >= 0 ? field : undefined);
  const parsed: CommentaryUsage = {
    promptTokens: count(usage.prompt_tokens),
    completionTokens: count(usage.completion_tokens),
    costUsd: count(usage.cost)
  };
  return Object.values(parsed).some((field) => field !== undefined) ? parsed : null;
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
