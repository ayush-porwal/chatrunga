import { readNdjson } from "./ndjson";
import { isRecord } from "@chaturanga/shared/types/guards";

export const LICHESS_ORIGIN = "https://lichess.org";

/** Lichess asks API clients to say who they are (a library's default agent may be refused). */
export const USER_AGENT = "Chaturanga (+https://github.com/ayush-porwal/chatrunga)";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const RATE_LIMITED_ERROR = "Lichess is limiting requests right now. Try again in a minute.";
export const TOKEN_REJECTED_ERROR =
  "Lichess no longer accepts the saved sign-in. Reconnect your account.";
export const NOT_CONNECTED_ERROR = "Connect your Lichess account first.";
const UNREACHABLE_ERROR = "Couldn't reach Lichess. Check your internet connection.";

/** A refused request: `status` is the HTTP status (0 when Lichess couldn't be reached). */
export class LichessHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LichessHttpError";
  }
}

export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

/**
 * One readable sentence for a refused request. Lichess answers `{error: "..."}`, form errors as
 * `{error: {field: ["..."]}}`, and the OAuth endpoints `{error_description: "..."}`.
 */
export function lichessErrorMessage(status: number, bodyText: string): string {
  if (status === 429) return RATE_LIMITED_ERROR;
  if (status === 401) return TOKEN_REJECTED_ERROR;
  const detail = errorDetail(bodyText);
  if (detail) return detail;
  if (status === 404) return "Lichess couldn't find that (it may have ended or been removed).";
  // A refusal that isn't Lichess's JSON (a block page): its own words say why.
  const page = pageText(bodyText);
  if (status === 403 && page) return `Lichess refused the request (403): ${page}`;
  if (status >= 500) return `Lichess is having trouble right now (${status}). Try again later.`;
  return `Lichess refused the request (${status}).`;
}

/** A short plain-text excerpt of an HTML or text answer, or null for none. */
function pageText(bodyText: string): string | null {
  const text = bodyText
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function errorDetail(bodyText: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  const { error, error_description: description } = body;
  if (typeof description === "string" && description.trim()) return description.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (isRecord(error)) {
    const messages = Object.values(error)
      .flat()
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (messages.length) return messages.join(" ");
  }
  return null;
}

type FormValue = string | number | boolean | null | undefined;

export type LichessRequest = {
  method?: "GET" | "POST" | "DELETE";
  /** Sent as application/x-www-form-urlencoded; null / undefined fields are left out. */
  form?: Record<string, FormValue>;
  /** Sent as text/plain (when there is no `form`). */
  text?: string;
  accept?: string;
  signal?: AbortSignal;
  /** Explicit token (the OAuth flow, before it is saved); otherwise `getToken()`. */
  token?: string;
  /** False for the unauthenticated OAuth token exchange. */
  auth?: boolean;
};

export type LichessClientOptions = {
  fetch?: FetchLike;
  /** The saved access token; null when not connected. */
  getToken: () => Promise<string | null>;
  /** Lichess answered 401 to the saved token (revoked or expired); `token` is the one it refused. */
  onTokenRejected?: (token: string) => void;
};

function formBody(form: Record<string, FormValue>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value !== null && value !== undefined) body.set(key, String(value));
  }
  return body;
}

/** A long-lived request: how long it may stay silent, and a call once it opens. */
type StreamRequest = LichessRequest & { idleTimeoutMs?: number; onOpen?: () => void };

/** Requests to lichess.org with the bearer token; refused requests throw LichessHttpError. */
export class LichessClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: LichessClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The response of a successful request (2xx); its body is the caller's to read. */
  async request(path: string, request: LichessRequest = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: request.accept ?? "application/json",
      "User-Agent": USER_AGENT
    };
    const usesSavedToken = request.auth !== false && request.token === undefined;
    const sentToken = await this.tokenFor(request);
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
    let body: URLSearchParams | string | undefined;
    if (request.form) {
      body = formBody(request.form);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (request.text !== undefined) {
      body = request.text;
      headers["Content-Type"] = "text/plain";
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${LICHESS_ORIGIN}${path}`, {
        method: request.method ?? "GET",
        headers,
        body,
        signal: request.signal
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new LichessHttpError(UNREACHABLE_ERROR, 0);
    }
    if (response.ok) return response;
    const text = await response.text().catch(() => "");
    if (response.status === 401 && usesSavedToken && sentToken)
      this.options.onTokenRejected?.(sentToken);
    throw new LichessHttpError(lichessErrorMessage(response.status, text), response.status);
  }

  /** The token a request sends (its own, else the saved one); null when it is unauthenticated. */
  private async tokenFor(request: LichessRequest): Promise<string | null> {
    if (request.auth === false) return null;
    const token = request.token ?? (await this.options.getToken());
    if (!token) throw new LichessHttpError(NOT_CONNECTED_ERROR, 401);
    return token;
  }

  /** The answer's fields, unchecked (an answer that isn't an object has none). */
  async json(path: string, request: LichessRequest = {}): Promise<Record<string, unknown>> {
    const response = await this.request(path, request);
    const body: unknown = await response.json();
    return isRecord(body) ? body : {};
  }

  /** For actions whose answer carries nothing we need (`{ok: true}`). */
  async send(path: string, request: LichessRequest = {}): Promise<void> {
    const response = await this.request(path, { method: "POST", ...request });
    await response.body?.cancel().catch(() => undefined);
  }

  /**
   * Streams an NDJSON endpoint, calling `onLine` per object, until the server closes it. With
   * `idleTimeoutMs`, a connection that sends nothing (not even Lichess's keep-alive newline) for
   * that long is treated as dead and throws, so the caller reconnects instead of hanging forever.
   */
  async stream(
    path: string,
    request: StreamRequest,
    onLine: (value: unknown) => void
  ): Promise<void> {
    await this.streamBody(
      path,
      { ...request, accept: request.accept ?? "application/x-ndjson" },
      async (body, touch) => {
        for await (const line of readNdjson(body, touch)) onLine(line);
      }
    );
  }

  /**
   * A long-lived response handed to `read` with `touch` (call it per chunk: it keeps the idle
   * timeout from firing), until the server closes it. Aborting `request.signal` ends it; going
   * silent past `idleTimeoutMs` throws (see `stream`).
   */
  async streamBody(
    path: string,
    request: StreamRequest,
    read: (body: ReadableStream<Uint8Array>, touch: () => void) => Promise<void>
  ): Promise<void> {
    const controller = new AbortController();
    const outer = request.signal;
    const abortFromOuter = () => controller.abort(outer?.reason);
    if (outer?.aborted) controller.abort(outer.reason);
    outer?.addEventListener("abort", abortFromOuter, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      if (!request.idleTimeoutMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), request.idleTimeoutMs);
    };
    try {
      touch();
      const response = await this.request(path, { ...request, signal: controller.signal });
      touch();
      request.onOpen?.();
      if (!response.body) return;
      await read(response.body, touch);
    } catch (error) {
      // Aborted, but not by the caller: the idle timer did it.
      if (controller.signal.aborted && !outer?.aborted)
        throw new LichessHttpError("The Lichess stream went silent.", 0);
      throw error;
    } finally {
      clearTimeout(idleTimer);
      outer?.removeEventListener("abort", abortFromOuter);
    }
  }
}
