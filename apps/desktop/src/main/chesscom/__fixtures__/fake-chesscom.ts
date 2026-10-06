import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "../client";

/** A recorded chess.com API fixture (`__fixtures__/<name>.json`), parsed. */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, `${name}.json`), "utf8"));
}

/** A route answering with an HTTP error status. */
export class Refusal {
  constructor(readonly status: number) {}
}

/** A route whose answer is read at request time. */
export class Live {
  constructor(readonly answer: () => unknown) {}
}

/**
 * A fetch that answers chess.com API paths (`/pub/player/…`) from a table (JSON, a Refusal or a
 * Live answer); anything else is a 404. It records each request, and how many were in flight at
 * once (chess.com refuses parallel ones).
 */
export function fakeChesscom(routes: Record<string, unknown>) {
  const requests: { path: string; userAgent: string | null }[] = [];
  let inFlight = 0;
  const state = { maxInFlight: 0 };
  const fetch: FetchLike = async (input, init) => {
    const path = new URL(input).pathname;
    requests.push({ path, userAgent: new Headers(init?.headers).get("User-Agent") });
    inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      // Yield once while in flight: requests sent without waiting would overlap here.
      await Promise.resolve();
      init?.signal?.throwIfAborted();
      const route = routes[path];
      const answer = route instanceof Live ? route.answer() : route;
      if (answer === undefined)
        return new Response('{"code":0,"message":"not found"}', { status: 404 });
      if (answer instanceof Refusal) return new Response("{}", { status: answer.status });
      return new Response(JSON.stringify(answer), { status: 200 });
    } finally {
      inFlight -= 1;
    }
  };
  return { fetch, requests, state };
}
