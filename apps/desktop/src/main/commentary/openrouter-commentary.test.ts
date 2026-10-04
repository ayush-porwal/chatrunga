import { describe, expect, it, vi } from "vitest";
import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "@chaturanga/shared/schemas";
import type { PuzzleInsightPayload } from "@chaturanga/shared/schemas/puzzle-insight";
import {
  NO_API_KEY_ERROR,
  explainPuzzleWithOpenRouter,
  generateOpenRouterCommentary,
  parseCommentaryPayloads,
  parsePuzzleExplanationPayload
} from "./openrouter-commentary";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
  body: "e4 grabs central space right away and opens lines for your queen and bishop."
});

describe("generateOpenRouterCommentary", () => {
  it("calls OpenRouter from the supplied main-process client and validates grounded prose", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(completion(GOOD_ANSWER));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl,
      now: () => 123
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer unit-test-key" });
    expect(init?.body).toContain("FACTS:");
    expect(init?.body).toContain("The facts are the only source of truth");
    expect(result.commentary).toEqual([
      {
        ply: 1,
        prose: "e4 grabs central space right away and opens lines for your queen and bishop.",
        headline: "Claiming the center at once",
        providerModel: "openai/test-model",
        generatedAt: 123
      }
    ]);
    expect(result.error).toBeNull();
    expect(JSON.stringify(result)).not.toContain("unit-test-key");
  });

  it("retries once, telling the model exactly what was wrong", async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce(completion("The move loses time after Qh5."))
      .mockResolvedValueOnce(completion(GOOD_ANSWER));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryInit = fetchImpl.mock.calls[1]![1];
    const retryBody = JSON.parse(typeof retryInit?.body === "string" ? retryInit.body : "") as { messages: { role: string; content: string }[] };
    expect(retryBody.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(retryBody.messages[2]?.content).toBe("The move loses time after Qh5.");
    expect(retryBody.messages[3]?.content).toContain("You wrote the move Qh5, which is not in the facts");
    expect(result.commentary[0]?.headline).toBe("Claiming the center at once");
    expect(result.error).toBeNull();
  });

  it("returns an error, not substitute prose, when the answer fails validation twice", async () => {
    const fetchImpl = vi.fn(async () => completion("The move loses time after Qh5."));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.commentary).toEqual([]);
    expect(result.error).toBe("The model's answer didn't match the engine facts, even after a retry.");
  });

  it("reports network failures without exposing provider errors or keys", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network rejected unit-test-key"));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(result.commentary).toEqual([]);
    expect(result.error).toBe("OpenRouter couldn't be reached. Check your connection and try again.");
    expect(JSON.stringify(result)).not.toContain("unit-test-key");
  });

  it("explains HTTP failures in plain words without echoing the response body", async () => {
    const cases: Array<[number, string]> = [
      [401, "rejected the API key"],
      [402, "out of credits"],
      [429, "rate limiting"],
      [500, "error (500)"]
    ];
    for (const [status, message] of cases) {
      const fetchImpl = vi.fn(async () => new Response("secret body unit-test-key", { status }));
      const result = await generateOpenRouterCommentary([payload()], { apiKey: "unit-test-key", fetchImpl });
      expect(result.commentary).toEqual([]);
      expect(result.error).toContain(message);
      expect(JSON.stringify(result)).not.toContain("secret body");
    }
  });

  it("keeps the accepted plies of a batch when one fails", async () => {
    const second = { ...payload(), game: { ...payload().game, ply: 2 } };
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      (typeof init?.body === "string" ? init.body : "").includes('\\"ply\\": 2') ? new Response("", { status: 503 }) : completion(GOOD_ANSWER)
    );
    const result = await generateOpenRouterCommentary([payload(), second], { apiKey: "unit-test-key", fetchImpl });

    expect(result.commentary.map((item) => item.ply)).toEqual([1]);
    expect(result.error).toContain("error (503)");
  });

  it("does not call a provider when no key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: null,
      fetchImpl,
      now: () => 789
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ commentary: [], error: NO_API_KEY_ERROR });
  });

  it("validates the renderer batch before making a provider call", () => {
    expect(() => parseCommentaryPayloads([])).toThrow(/at least 1/);
    expect(parseCommentaryPayloads([payload()])).toHaveLength(1);
  });
});

const PUZZLE_START = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

/** Scholar's mate as a solved puzzle (4.Qxf7#). */
function puzzlePayload(): PuzzleInsightPayload {
  return parsePuzzleExplanationPayload({
    schemaVersion: 1,
    player: { rating: 1500 },
    puzzle: { fen: PUZZLE_START, sideToMove: "white", moveNumberSan: "4.", themes: ["mate in 1"], solutionSan: ["Qxf7#"] },
    outcome: "solved",
    engine: { assessment: "white_has_forced_mate", bestMoveSan: "Qxf7#", bestLineSan: ["Qxf7#"] },
    commentaryDetail: "concise"
  });
}

const PUZZLE_ANSWER = JSON.stringify({
  headline: "The f7 pawn had one defender",
  body: "Only the king guarded f7, and the bishop on c4 backs up your queen, so Qxf7# is mate on the spot."
});

describe("explainPuzzleWithOpenRouter", () => {
  it("sends the puzzle prompt and returns the validated explanation", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(completion(PUZZLE_ANSWER));
    const result = await explainPuzzleWithOpenRouter(puzzlePayload(), {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl,
      now: () => 42
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]![1];
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "") as { messages: { content: string }[]; max_tokens: number };
    expect(body.messages[0]!.content).toContain("tactics puzzle");
    expect(body.messages[1]!.content).toContain('"solutionSan"');
    expect(body.max_tokens).toBe(350);
    expect(result).toEqual({
      explanation: {
        headline: "The f7 pawn had one defender",
        prose: expect.stringContaining("Qxf7#"),
        providerModel: "openai/test-model",
        generatedAt: 42
      },
      error: null
    });
  });

  it("retries once with the correction, then reports an ungrounded answer", async () => {
    const bad = JSON.stringify({ headline: "Mate", body: "Bxf7+ first, then Qxf7# mates." });
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(completion(bad)).mockResolvedValueOnce(completion(PUZZLE_ANSWER));
    const retried = await explainPuzzleWithOpenRouter(puzzlePayload(), { apiKey: "unit-test-key", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]?.body).toContain("You wrote the move Bxf7+");
    expect(retried.explanation?.headline).toBe("The f7 pawn had one defender");

    const always = vi.fn().mockImplementation(async () => completion(bad));
    const failed = await explainPuzzleWithOpenRouter(puzzlePayload(), { apiKey: "unit-test-key", fetchImpl: always });
    expect(failed).toEqual({ explanation: null, error: expect.stringContaining("didn't match the engine facts") });
  });

  it("is cancelled by its signal, without an error to show", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          controller.abort();
        })
    );
    const result = await explainPuzzleWithOpenRouter(puzzlePayload(), { apiKey: "unit-test-key", fetchImpl, signal: controller.signal });
    expect(result).toEqual({ explanation: null, error: null, cancelled: true });
  });

  it("needs a key and a valid payload before any provider call", async () => {
    const fetchImpl = vi.fn();
    expect(await explainPuzzleWithOpenRouter(puzzlePayload(), { apiKey: " ", fetchImpl })).toEqual({ explanation: null, error: NO_API_KEY_ERROR });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => parsePuzzleExplanationPayload({ ...puzzlePayload(), outcome: "failed_wrong_move" })).toThrow(/mistake is required for failed_wrong_move/);
  });
});
