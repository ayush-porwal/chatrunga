import { describe, expect, it, vi } from "vitest";
import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "@chaturanga/shared/schemas";
import { generateOpenRouterCommentary, parseCommentaryPayloads } from "./openrouter-commentary";

function payload(): ReviewInsightPayload {
  return reviewInsightPayloadSchema.parse({
    schemaVersion: 1,
    player: { rating: 1500, color: "white", ratingBucket: 1500 },
    game: {
      ply: 1,
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

function completion(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

const GOOD_ANSWER = JSON.stringify({
  headline: "Claiming the center at once",
  body: "e4 grabs central space right away and opens lines for your queen and bishop.",
  takeaway: "In the opening, stake a claim in the center before anything else."
});

describe("generateOpenRouterCommentary", () => {
  it("calls OpenRouter from the supplied main-process client and validates grounded prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(GOOD_ANSWER));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl,
      now: () => 123
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer unit-test-key");
    expect(String(init.body)).toContain("FACTS:");
    expect(String(init.body)).toContain("The facts are the only source of truth");
    expect(result.commentary[0]).toMatchObject({
      ply: 1,
      prose: "e4 grabs central space right away and opens lines for your queen and bishop.",
      headline: "Claiming the center at once",
      takeaway: "In the opening, stake a claim in the center before anything else.",
      source: "openrouter",
      fallback: false,
      generatedAt: 123
    });
    expect(JSON.stringify(result)).not.toContain("unit-test-key");
  });

  it("retries once, telling the model exactly what was wrong", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completion("The move loses time after Qh5."))
      .mockResolvedValueOnce(completion(GOOD_ANSWER));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchImpl.mock.calls[1]![1].body)) as { messages: { role: string; content: string }[] };
    expect(retryBody.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(retryBody.messages[2]?.content).toBe("The move loses time after Qh5.");
    expect(retryBody.messages[3]?.content).toContain("You wrote the move Qh5, which is not in the facts");
    expect(result.commentary[0]?.source).toBe("openrouter");
    expect(result.error).toBeNull();
  });

  it("uses the deterministic local fallback without exposing provider errors or keys", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network rejected unit-test-key"));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl,
      now: () => 456
    });

    expect(result.commentary[0]).toMatchObject({
      source: "local-fallback",
      fallback: true,
      providerModel: "local-template",
      generatedAt: 456
    });
    expect(result.commentary[0]?.headline).toBeTruthy();
    expect(result.commentary[0]?.takeaway).toBeTruthy();
    expect(result.error).toContain("local fallback");
    expect(JSON.stringify(result)).not.toContain("unit-test-key");
  });

  it("does not call a provider when no key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: null,
      fetchImpl,
      now: () => 789
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(result.commentary[0]?.source).toBe("local-fallback");
  });

  it("validates the renderer batch before making a provider call", () => {
    expect(() => parseCommentaryPayloads([])).toThrow();
    expect(parseCommentaryPayloads([payload()])).toHaveLength(1);
  });
});
