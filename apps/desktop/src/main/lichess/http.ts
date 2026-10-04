import { readNdjson } from "./ndjson";
import { isRecord } from "@chaturanga/shared/types/guards";

export const LICHESS_ORIGIN = "https://lichess.org";

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
  if (status >= 500) return `Lichess is having trouble right now (${status}). Try again later.`;
  return `Lichess refused the request (${status}).`;
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

export function formBody(form: Record<string, FormValue>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value !== null && value !== undefined) body.set(key, String(value));
  }
  return body;
}

/** Requests to lichess.org with the bearer token; refused requests throw LichessHttpError. */
export class LichessClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: LichessClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The response of a successful request (2xx); its body is the caller's to read. */
  async request(path: string, request: LichessRequest = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: request.accept ?? "application/json" };
    const usesSavedToken = request.auth !== false && request.token === undefined;
    let sentToken: string | null = null;
    if (request.auth !== false) {
      sentToken = request.token ?? (await this.options.getToken());
      if (!sentToken) throw new LichessHttpError(NOT_CONNECTED_ERROR, 401);
      headers.Authorization = `Bearer ${sentToken}`;
    }
    let body: URLSearchParams | undefined;
    if (request.form) {
      body = formBody(request.form);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
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
    request: LichessRequest & { idleTimeoutMs?: number; onOpen?: () => void },
    onLine: (value: unknown) => void
  ): Promise<void> {
    const controller = new AbortController();
    const outer = request.signal;
    const abortFromOuter = () => controller.abort(outer?.reason);
    if (outer?.aborted) controller.abort(outer.reason);
    outer?.addEventListener("abort", abortFromOuter, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let idled = false;
    const touch = () => {
      if (!request.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idled = true;
        controller.abort();
      }, request.idleTimeoutMs);
    };
    try {
      touch();
      const response = await this.request(path, {
        ...request,
        accept: request.accept ?? "application/x-ndjson",
        signal: controller.signal
      });
      touch();
      request.onOpen?.();
      if (!response.body) return;
      for await (const line of readNdjson(response.body, touch)) onLine(line);
    } catch (error) {
      if (idled && !outer?.aborted)
        throw new LichessHttpError("The Lichess stream went silent.", 0);
      throw error;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      outer?.removeEventListener("abort", abortFromOuter);
    }
  }
}
