/**
 * The book import's OpenRouter client: one chat request with text and image parts, a JSON-object
 * answer when asked, a reasoning effort, a time limit, cancellation, and the charge OpenRouter
 * reports (`usage.cost`, USD). Errors carry a message safe to show and whether trying again may
 * help. The key is the caller's (main process only).
 */
import type { BookChatMessage } from "@chaturanga/shared/books/prompts";
import { isRecord } from "@chaturanga/shared/types/guards";
import {
  OPENROUTER_ENDPOINT,
  completionText,
  openRouterHeaders,
  openRouterHttpFailure,
  parseUsage
} from "../commentary/openrouter-http";

export type BookChatRequest = {
  model: string;
  messages: BookChatMessage[];
  maxTokens: number;
  /** Ask for a JSON object (OpenRouter's `response_format`). */
  json?: boolean;
  /** Reasoning effort; models that don't reason ignore it. */
  reasoning?: "low" | "medium" | "high";
  signal: AbortSignal;
};

export type BookChatAnswer = { text: string; costUsd: number };

export type BookChat = (request: BookChatRequest) => Promise<BookChatAnswer>;

/** A failed request: `message` is safe to show; `retryable` when trying again later may work. */
export class BookChatError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

const UNREACHABLE = "OpenRouter couldn't be reached. Check your connection and try again.";
const TIMEOUT = "OpenRouter took too long to answer.";
const EMPTY = "The model returned an empty answer.";
/** A page image and a long answer (with reasoning) can take a while. */
const DEFAULT_TIMEOUT_MS = 180_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A chat function on `apiKey`'s account. */
export function openRouterChat(options: {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): BookChat {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (request) => {
    request.signal.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      const response = await fetchImpl(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: openRouterHeaders(options.apiKey),
        body: JSON.stringify(requestBody(request)),
        signal
      });
      if (!response.ok) {
        const { message, code } = openRouterHttpFailure(response.status);
        throw new BookChatError(message, code === "rate_limited" || code === "provider_error");
      }
      const body: unknown = await response.json();
      const text = completionText(body);
      if (!text) throw new BookChatError(EMPTY, true);
      const usage = parseUsage(isRecord(body) ? body.usage : undefined);
      return { text, costUsd: usage?.costUsd ?? 0 };
    } catch (error) {
      // The caller's cancel goes up as it is (the import pauses); the time limit is a failure.
      request.signal.throwIfAborted();
      if (timeout.aborted) throw new BookChatError(TIMEOUT, true);
      if (error instanceof BookChatError) throw error;
      throw new BookChatError(UNREACHABLE, true);
    }
  };
}

function requestBody(request: BookChatRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    temperature: 0,
    max_tokens: request.maxTokens,
    usage: { include: true },
    ...(request.json ? { response_format: { type: "json_object" } } : {}),
    ...(request.reasoning ? { reasoning: { effort: request.reasoning } } : {})
  };
}
