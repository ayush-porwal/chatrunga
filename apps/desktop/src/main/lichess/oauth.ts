/**
 * Lichess sign-in: OAuth 2 Authorization Code with PKCE (S256) in the system browser. Lichess lets
 * public clients use any `client_id` without registration; the redirect goes to a one-shot HTTP
 * server on the loopback interface with an OS-assigned port.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LICHESS_ORIGIN, LichessClient, type FetchLike } from "./http";

export const LICHESS_CLIENT_ID = "chaturanga-desktop";
export const LICHESS_SCOPES = ["board:play", "challenge:read", "challenge:write"] as const;
export const OAUTH_TIMEOUT_MS = 5 * 60_000;

/** The flow ended without a token and without an error worth showing (cancelled, timed out). */
export class OAuthCancelledError extends Error {
  constructor(reason: "cancelled" | "timeout" | "denied") {
    super(
      reason === "timeout"
        ? "Lichess sign-in timed out."
        : reason === "denied"
          ? "Lichess sign-in was declined."
          : "Lichess sign-in was cancelled."
    );
    this.name = "OAuthCancelledError";
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** RFC 7636: 43–128 characters from the unreserved set; 32 random bytes give 43. */
export function createCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

export function codeChallengeFor(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(input: {
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LICHESS_CLIENT_ID,
    redirect_uri: input.redirectUri,
    code_challenge_method: "S256",
    code_challenge: input.codeChallenge,
    scope: LICHESS_SCOPES.join(" "),
    state: input.state
  });
  return `${LICHESS_ORIGIN}/oauth?${params.toString()}`;
}

export type AuthorizeOptions = {
  openExternal: (url: string) => Promise<void>;
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type Callback = { code: string } | { error: Error };

/** Opens the browser, waits for the redirect, exchanges the code; resolves the access token. */
export async function authorizeInBrowser(options: AuthorizeOptions): Promise<string> {
  const verifier = createCodeVerifier();
  const state = base64Url(randomBytes(16));
  let settle: (callback: Callback) => void = () => undefined;
  const callback = new Promise<Callback>((resolve) => {
    settle = resolve;
  });
  // The page answers the browser only once the code is exchanged, so it tells the truth.
  const browser: { respond: ((ok: boolean, message: string) => void) | null } = { respond: null };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/callback" || request.method !== "GET") {
      sendPage(response, 404, "Not found.");
      return;
    }
    // A stale tab from an earlier attempt (or anything else) can't complete this one.
    if (url.searchParams.get("state") !== state || browser.respond) {
      sendPage(response, 400, "This sign-in link is no longer valid. Start again from Chaturanga.");
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error || !code) {
      sendPage(response, 200, "Sign-in cancelled. You can close this tab.");
      settle({ error: new OAuthCancelledError("denied") });
      return;
    }
    browser.respond = (ok, message) => sendPage(response, ok ? 200 : 502, message);
    settle({ code });
  });

  const timeout = setTimeout(
    () => settle({ error: new OAuthCancelledError("timeout") }),
    options.timeoutMs ?? OAUTH_TIMEOUT_MS
  );
  const onAbort = () => settle({ error: new OAuthCancelledError("cancelled") });
  if (options.signal?.aborted) onAbort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const port = await listen(server);
    // The address the server listens on: `localhost` may resolve to IPv6 first and miss it.
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    if (!options.signal?.aborted) {
      await options.openExternal(
        authorizeUrl({ redirectUri, codeChallenge: codeChallengeFor(verifier), state })
      );
    }
    const result = await callback;
    if ("error" in result) throw result.error;
    try {
      const token = await exchangeCode({
        code: result.code,
        verifier,
        redirectUri,
        fetch: options.fetch,
        signal: options.signal
      });
      browser.respond?.(true, "Connected to Chaturanga — you can close this tab.");
      return token;
    } catch (error) {
      browser.respond?.(
        false,
        "Chaturanga couldn't finish connecting to Lichess. Return to the app and try again."
      );
      if (options.signal?.aborted) throw new OAuthCancelledError("cancelled");
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    // Idle keep-alive connections from the browser would hold the server open; the answered
    // callback closes itself (`Connection: close`), with a hard stop in case it doesn't.
    server.close();
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 2000).unref();
  }
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

async function exchangeCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}): Promise<string> {
  const client = new LichessClient({ fetch: input.fetch, getToken: async () => null });
  const body = await client.json<{ access_token?: unknown }>("/api/token", {
    method: "POST",
    auth: false,
    signal: input.signal,
    form: {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      client_id: LICHESS_CLIENT_ID
    }
  });
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Lichess didn't return an access token.");
  }
  return body.access_token;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A self-contained page (no scripts, no external resources). */
function sendPage(
  response: ServerResponse<IncomingMessage>,
  status: number,
  message: string
): void {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chaturanga</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161512;color:#e8e6e3;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}p{max-width:28rem;padding:0 1.5rem;text-align:center}</style>
</head><body><p>${escapeHtml(message)}</p></body></html>`;
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Cache-Control": "no-store",
    Connection: "close"
  });
  response.end(body);
}
