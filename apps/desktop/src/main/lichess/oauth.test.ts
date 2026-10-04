import { describe, expect, it, vi } from "vitest";
import { fakeFetch, json } from "./__fixtures__/fake-lichess";
import {
  authorizeInBrowser,
  authorizeUrl,
  codeChallengeFor,
  createCodeVerifier,
  LICHESS_CLIENT_ID,
  OAuthCancelledError
} from "./oauth";

describe("PKCE", () => {
  it("derives the S256 challenge (RFC 7636 appendix B)", () => {
    expect(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("creates unguessable, URL-safe verifiers of a valid length", () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createCodeVerifier()).not.toBe(verifier);
  });

  it("builds the authorize URL with every required parameter", () => {
    const url = new URL(
      authorizeUrl({
        redirectUri: "http://localhost:5555/callback",
        codeChallenge: "abc",
        state: "xyz"
      })
    );
    expect(url.origin + url.pathname).toBe("https://lichess.org/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: LICHESS_CLIENT_ID,
      redirect_uri: "http://localhost:5555/callback",
      code_challenge_method: "S256",
      code_challenge: "abc",
      scope: "board:play challenge:read challenge:write",
      state: "xyz"
    });
  });
});

/** Stands in for the browser: follows the redirect the user would have approved. */
async function callback(authorize: string, params: Record<string, string>): Promise<Response> {
  const redirect = new URL(new URL(authorize).searchParams.get("redirect_uri")!);
  for (const [key, value] of Object.entries(params)) redirect.searchParams.set(key, value);
  return fetch(redirect);
}

function openedUrl(): { openExternal: (url: string) => Promise<void>; url: Promise<string> } {
  let resolve: (url: string) => void = () => undefined;
  const url = new Promise<string>((done) => {
    resolve = done;
  });
  return { openExternal: async (value) => resolve(value), url };
}

describe("authorizeInBrowser", () => {
  it("rejects a callback with the wrong state, then exchanges the right one's code", async () => {
    const { fetch: lichessFetch, requests } = fakeFetch({
      "POST /api/token": () =>
        json({ token_type: "Bearer", access_token: "test-access-token", expires_in: 31536000 })
    });
    const browser = openedUrl();
    const token = authorizeInBrowser({ openExternal: browser.openExternal, fetch: lichessFetch });
    const authorize = await browser.url;
    const state = new URL(authorize).searchParams.get("state")!;

    const forged = await callback(authorize, { code: "evil-code", state: "not-the-state" });
    expect(forged.status).toBe(400);
    expect(requests).toHaveLength(0);

    const approved = await callback(authorize, { code: "good-code", state });
    expect(approved.status).toBe(200);
    expect(await approved.text()).toContain("Connected to Chaturanga");
    expect(await token).toBe("test-access-token");

    const params = new URL(authorize).searchParams;
    const exchange = Object.fromEntries(new URLSearchParams(requests[0]!.body));
    expect(requests[0]!.url).toBe("https://lichess.org/api/token");
    expect(requests[0]!.headers.authorization).toBeUndefined();
    expect(exchange).toMatchObject({
      grant_type: "authorization_code",
      code: "good-code",
      redirect_uri: params.get("redirect_uri"),
      client_id: LICHESS_CLIENT_ID
    });
    expect(codeChallengeFor(exchange.code_verifier!)).toBe(params.get("code_challenge"));

    // The one-shot server is gone.
    await expect(callback(authorize, { code: "again", state })).rejects.toThrow(/fetch failed/);
  });

  it("tells the browser when the code exchange fails, and rejects", async () => {
    const { fetch: lichessFetch } = fakeFetch({
      "POST /api/token": () =>
        json({ error: "invalid_grant", error_description: "Code is expired" }, 400)
    });
    const browser = openedUrl();
    const token = authorizeInBrowser({ openExternal: browser.openExternal, fetch: lichessFetch });
    const outcome = token.catch((error: unknown) => error);
    const authorize = await browser.url;
    const response = await callback(authorize, {
      code: "c",
      state: new URL(authorize).searchParams.get("state")!
    });
    expect(response.status).toBe(502);
    expect(await outcome).toMatchObject({ message: "Code is expired" });
  });

  it("ends as cancelled when the user declines on Lichess", async () => {
    const browser = openedUrl();
    const token = authorizeInBrowser({
      openExternal: browser.openExternal,
      fetch: fakeFetch({}).fetch
    });
    const outcome = token.catch((error: unknown) => error);
    const authorize = await browser.url;
    await callback(authorize, {
      error: "access_denied",
      state: new URL(authorize).searchParams.get("state")!
    });
    expect(await outcome).toBeInstanceOf(OAuthCancelledError);
  });

  it("can be cancelled, and times out", async () => {
    const controller = new AbortController();
    const browser = openedUrl();
    const cancelled = authorizeInBrowser({
      openExternal: browser.openExternal,
      signal: controller.signal
    });
    await browser.url;
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);

    const openExternal = vi.fn(async () => undefined);
    await expect(authorizeInBrowser({ openExternal, timeoutMs: 20 })).rejects.toThrow(/timed out/);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
