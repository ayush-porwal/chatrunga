/**
 * The book import's OpenRouter client: one chat request with text and image parts, a JSON-object
 * answer when asked, a time limit, cancellation, and the charge OpenRouter reports (`usage.cost`,
 * USD). No token limit, temperature or reasoning effort: a thinking model (Claude Haiku 5.5 thinks
 * by default) thinks as long as it needs to, and Haiku 5.5 rejects any temperature but 1. Errors
 * carry a message safe to show and whether trying again may help. The key is the caller's (main
 * process only).
 */
import type { BookChatMessage } from "@chaturanga/shared/books/prompts";
import { isRecord } from "@chaturanga/shared/types/guards";
import {
  OPENROUTER_ENDPOINT,
  completionHitTokenLimit,
  completionText,
  openRouterHeaders,
  openRouterHttpFailure,
  parseUsage
} from "../commentary/openrouter-http";

export type BookChatRequest = {
  model: string;
  messages: BookChatMessage[];
  /** Ask for a JSON object (OpenRouter's `response_format`). */
  json?: boolean;
  signal: AbortSignal;
};

type BookChatAnswer = { text: string; costUsd: number };

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
const RAN_OUT = "The model ran out of room before answering. Try again, or pick another model.";
/**
 * Guards against a hung request, not the model's thinking (no token limit is set). A page image
 * and a long answer, after as much thinking as the model needs (a chapter page's lines can run to
 * tens of thousands of tokens), can take minutes.
 */
const DEFAULT_TIMEOUT_MS = 300_000;

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
      // Its whole output limit went on thinking, with no answer: asking again would do the same.
      if (!text && completionHitTokenLimit(body)) throw new BookChatError(RAN_OUT, false);
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
    usage: { include: true },
    ...(request.json ? { response_format: { type: "json_object" } } : {})
  };
}
