import { describe, expect, it, vi } from "vitest";
import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "@chaturanga/shared/schemas";
import {
  analyticsRedactor,
  generateOpenRouterCommentary,
  parseUsage
} from "../commentary/openrouter-commentary";
import { commentaryReporter } from "./commentary";
import { makeService, telemetryDatabase } from "./__fixtures__/telemetry-fixtures";

type Recorded = { event: string; [property: string]: unknown };

const REVIEW = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const GOOD_ANSWER = JSON.stringify({
  headline: "Claiming the center at once",
  body: "e4 grabs central space right away and opens lines for your queen and bishop."
});
const INVALID_ANSWER = "The move loses time after Qh5.";

function payload(ply: number, extra: Record<string, unknown> = {}): ReviewInsightPayload {
  return reviewInsightPayloadSchema.parse({
    ...extra,
    schemaVersion: 1,
    player: { rating: 1500, color: "white", ratingBucket: 1500 },
    game: {
      ply,
      moveNumberSan: "1.",
      san: "e4",
      mover: "white",
      fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      phase: "opening"
    },
    engines: {
      stockfish: {
        evalBefore: "+0.2",
        evalAfter: "+0.1",
        evalLossCp: 10,
        bestMoveSan: "e4",
        bestLineSan: ["e4", "e5"]
      },
      maiaCurve: {
        ratings: [1100, 1300, 1500, 1700, 1900],
        playedProb: [0.2, 0.25, 0.3, 0.35, 0.4],
        bestProb: [0.2, 0.25, 0.3, 0.35, 0.4],
        interpretation: { label: "neutral" },
        userRatingBucket: 1500
      }
    },
    classification: "best",
    curatorReason: "move_review",
    tacticalFacts: [],
    engineSignals: []
  });
}

function completion(text: string, usage?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }], ...(usage ? { usage } : {}) }),
    { status: 200 }
  );
}

async function run(
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>,
  payloads: ReviewInsightPayload[],
  trigger: "auto" | "user_retry" = "auto"
) {
  const db = telemetryDatabase();
  const service = makeService({ db });
  service.start();
  let clock = 0;
  const result = await generateOpenRouterCommentary(payloads, {
    apiKey: "unit-test-key",
    model: "anthropic/claude-sonnet-4.6",
    fetchImpl,
    monotonic: () => (clock += 100),
    report: commentaryReporter(
      service,
      { reviewId: REVIEW, gameId: "g1", trigger },
      { model: "anthropic/claude-sonnet-4.6", detail: "balanced" }
    )
  });
  const events = (
    db.prepare("SELECT event, payload_json FROM telemetry_outbox ORDER BY rowid").all() as {
      event: string;
      payload_json: string;
    }[]
  ).map(
    (row): Recorded => ({
      event: row.event,
      ...(JSON.parse(row.payload_json) as Record<string, unknown>)
    })
  );
  return { result, events, of: (name: string) => events.filter((event) => event.event === name) };
}

describe("commentary analytics", () => {
  it("a corrective validation retry is one logical request with two provider attempts", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        completion(INVALID_ANSWER, { prompt_tokens: 900, completion_tokens: 80, cost: 0.004 })
      )
      .mockResolvedValueOnce(
        completion(GOOD_ANSWER, { prompt_tokens: 1000, completion_tokens: 90, cost: 0.005 })
      );
    const { result, of } = await run(fetchImpl, [payload(1)]);
    expect(result.commentary).toHaveLength(1);

    const [requested] = of("commentary_requested");
    expect(of("commentary_requested")).toHaveLength(1);
    expect(requested).toMatchObject({
      trigger: "auto",
      ply: 1,
      review_id: REVIEW,
      model_vendor: "anthropic",
      model_is_default: true
    });
    expect(
      of("$ai_generation").map((generation) => [
        generation.attempt,
        generation.reason,
        generation.result,
        generation.$ai_trace_id,
        generation.$ai_is_error
      ])
    ).toEqual([
      [1, "initial", "validation_failed", requested.request_id, false],
      [2, "validation_retry", "accepted", requested.request_id, false]
    ]);
    const [first, retry] = of("$ai_generation");
    expect(first).toMatchObject({
      $ai_model: "anthropic/claude-sonnet-4.6",
      $ai_provider: "openrouter",
      $ai_input_tokens: 900,
      $ai_output_tokens: 80,
      $ai_total_cost_usd: 0.004,
      $ai_latency: 0.1,
      $ai_http_status: 200,
      $ai_temperature: 0.7,
      $ai_output_choices: [{ role: "assistant", content: INVALID_ANSWER }]
    });
    // The retry's prompt carries the rejected answer and the correction.
    expect((retry.$ai_input as { role: string }[]).map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user"
    ]);
    expect(of("$ai_trace")).toEqual([
      expect.objectContaining({
        $ai_trace_id: requested.request_id,
        $ai_is_error: false,
        $ai_input_state: first.$ai_input,
        $ai_output_state: expect.stringContaining("grabs central space")
      })
    ]);
    expect(of("commentary_completed")).toEqual([
      expect.objectContaining({
        request_id: requested.request_id,
        attempts: 2,
        validation_retried: true,
        first_attempt_valid: false,
        // Usage summed over both attempts, the rejected one included.
        prompt_tokens_total: 1900,
        completion_tokens_total: 170,
        cost_usd_total: 0.009,
        tokens_complete: true,
        cost_complete: true
      })
    ]);
    expect(of("commentary_failed")).toEqual([]);
  });

  it("a batch with one success and one failure counts each move once", async () => {
    const payloads = [payload(1), payload(2)];
    // The first move's request succeeds; the second is refused (out of credits).
    let call = 0;
    const alternating = vi.fn(async () =>
      call++ === 0 ? completion(GOOD_ANSWER) : new Response("", { status: 402 })
    );
    const { result, of } = await run(alternating, payloads);
    expect(result.commentary).toHaveLength(1);
    expect(of("commentary_requested")).toHaveLength(2);
    expect(of("commentary_completed")).toHaveLength(1);
    expect(of("commentary_failed")).toEqual([
      expect.objectContaining({ error_code: "insufficient_credits", attempts: 1 })
    ]);
    // Each terminal event belongs to its own request.
    const ids = new Set(
      [...of("commentary_completed"), ...of("commentary_failed")].map((event) => event.request_id)
    );
    expect(ids.size).toBe(2);
  });

  it("missing usage stays unknown, never zero", async () => {
    const { of } = await run(
      vi.fn(async () => completion(GOOD_ANSWER)),
      [payload(1)]
    );
    const [completed] = of("commentary_completed");
    expect(completed).not.toHaveProperty("prompt_tokens_total");
    expect(completed).not.toHaveProperty("cost_usd_total");
    expect(completed).toMatchObject({
      tokens_complete: false,
      cost_complete: false,
      first_attempt_valid: true,
      attempts: 1
    });
    expect(of("$ai_generation")[0]).not.toHaveProperty("$ai_input_tokens");
    expect(of("$ai_generation")[0]).not.toHaveProperty("$ai_total_cost_usd");

    // Tokens reported but no cost: cost stays unknown.
    expect(parseUsage({ prompt_tokens: 10, completion_tokens: 2 })).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      costUsd: undefined
    });
    expect(parseUsage({ prompt_tokens: "10" })).toBeNull();
    expect(parseUsage(undefined)).toBeNull();
  });

  it("a user's Retry is its own trigger and counts as activity; provider failures are coded", async () => {
    const { of } = await run(
      vi.fn(async () => new Response("secret body", { status: 429 })),
      [payload(1)],
      "user_retry"
    );
    expect(of("commentary_requested")[0]).toMatchObject({ trigger: "user_retry" });
    expect(of("$ai_generation")[0]).toMatchObject({
      result: "rate_limited",
      $ai_http_status: 429,
      $ai_is_error: true,
      $ai_error: "rate_limited"
    });
    expect(of("$ai_generation")[0]).not.toHaveProperty("$ai_output_choices");
    expect(JSON.stringify(of("$ai_generation"))).not.toContain("secret body");
    expect(of("commentary_failed")[0]).toMatchObject({
      error_code: "rate_limited",
      trigger: "user_retry"
    });
    expect(of("user_active")).toHaveLength(1);
  });

  it("records prompts and answers for LLM analytics, but never the API key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(completion(INVALID_ANSWER))
      .mockResolvedValueOnce(completion(GOOD_ANSWER));
    const { events, of } = await run(fetchImpl, [payload(1)]);
    const stored = JSON.stringify(events);
    expect(stored).not.toContain("unit-test-key");
    expect(stored).not.toContain('g1"');
    const generations = JSON.stringify(of("$ai_generation"));
    for (const recorded of ["Qh5", "grabs central space", "rnbqkbnr"]) {
      expect(generations).toContain(recorded);
    }
    // Only the AI events carry the conversation; the product events stay small.
    expect(JSON.stringify(of("commentary_completed"))).not.toContain("rnbqkbnr");
  });

  it("replaces player and engine names in what it records, not in what it sends", async () => {
    const named = payload(1, { context: { players: { white: "MagnusFan", black: "kakashi__ofleaf" } } });
    named.engines.stockfish.engineName = "My Secret Engine";
    const sent: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sent.push(String(init?.body));
      return completion(GOOD_ANSWER);
    });
    const { events, of } = await run(fetchImpl, [named]);
    expect(sent.join()).toContain("kakashi__ofleaf");
    const stored = JSON.stringify(events);
    for (const name of ["MagnusFan", "kakashi__ofleaf", "My Secret Engine"]) {
      expect(stored).not.toContain(name);
    }
    expect(JSON.stringify(of("$ai_generation"))).toContain("[Black]");

    const redact = analyticsRedactor(named);
    expect(redact("magnusfan (White) vs KAKASHI__OFLEAF, by my secret engine")).toBe(
      "[White] (White) vs [Black], by [engine]"
    );
    expect(analyticsRedactor(payload(1))("unchanged")).toBe("unchanged");

    // A one-letter name is replaced too, as a whole word only.
    const short = analyticsRedactor(payload(1, { context: { players: { white: "A", black: "Bo" } } }));
    expect(short('{"white":"A","black":"Bo"} A and Bo play a Bongcloud')).toBe(
      '{"white":"[White]","black":"[Black]"} [White] and [Black] play [White] Bongcloud'
    );
  });
});
