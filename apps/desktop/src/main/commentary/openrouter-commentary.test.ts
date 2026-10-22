import { describe, expect, it, vi } from "vitest";
import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "@chaturanga/shared/schemas";
import type { PuzzleInsightPayload } from "@chaturanga/shared/schemas/puzzle-insight";
import { COMMENTARY_LIMITS, COMMENTARY_REASONING_TOKENS } from "@chaturanga/shared/llm/commentary";
import {
  NO_API_KEY_ERROR,
  type CommentaryReport,
  explainPuzzleWithOpenRouter,
  generateOpenRouterCommentary,
  parseCommentaryPayloads,
  parsePuzzleExplanationPayload
} from "./openrouter-commentary";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function payload(): ReviewInsightPayload {
  return reviewInsightPayloadSchema.parse({
    schemaVersion: 3,
    player: { rating: 1500, color: "white" },
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
    annotation: null,
    curatorReason: "move_review",
    tacticalFacts: [],
    engineSignals: []
  });
}

/** A request's body as text (empty without one). */
function bodyText(init?: RequestInit): string {
  return typeof init?.body === "string" ? init.body : "";
}

/** A provider that is down (503) for the request about `ply`, and answers the others. */
function failingForPly(ply: number) {
  return async (_url: string | URL, init?: RequestInit) =>
    bodyText(init).includes(`\\"ply\\": ${ply}`)
      ? new Response("", { status: 503 })
      : completion(GOOD_ANSWER);
}

function completion(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

/** The body settings that decide how much a request may think and answer. */
type SentBudget = { max_tokens: number; reasoning: unknown };

function sentBudget(init?: RequestInit): SentBudget {
  const { max_tokens, reasoning } = JSON.parse(bodyText(init)) as SentBudget;
  return { max_tokens, reasoning };
}

/** What a thinking model returns when its reasoning used all of `max_tokens`: no answer. */
function thoughtOut(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "length",
          message: {
            role: "assistant",
            content: null,
            reasoning_details: [{ type: "reasoning.text", text: "Let me weigh e4 against d4..." }]
          }
        }
      ],
      usage: {
        prompt_tokens: 900,
        completion_tokens: 2598,
        completion_tokens_details: { reasoning_tokens: 2598 },
        cost: 0.013
      }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const THOUGHT_OUT_ERROR =
  "The model used its whole budget thinking and gave no answer. Try again, or pick another model.";

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
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer unit-test-key" });
    expect(init?.body).toContain("FACTS:");
    expect(init?.body).toContain("The facts are the only source of truth");
    expect(result.commentary).toStrictEqual([
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
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(completion("The move loses time after Qh5."))
      .mockResolvedValueOnce(completion(GOOD_ANSWER));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryInit = fetchImpl.mock.calls[1][1];
    const retryBody = JSON.parse(bodyText(retryInit)) as {
      messages: { role: string; content: string }[];
    };
    expect(retryBody.messages.map((message) => message.role)).toStrictEqual([
      "system",
      "user",
      "assistant",
      "user"
    ]);
    expect(retryBody.messages[2]?.content).toBe("The move loses time after Qh5.");
    expect(retryBody.messages[3]?.content).toContain(
      "You wrote the move Qh5, which is not in the facts"
    );
    expect(result.commentary[0]?.headline).toBe("Claiming the center at once");
    expect(result.error).toBeNull();
  });

  it("lets the model think on a budget of its own, on top of the answer's allowance", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(completion(GOOD_ANSWER));
    await generateOpenRouterCommentary([{ ...payload(), commentaryDetail: "detailed" }], {
      apiKey: "unit-test-key",
      fetchImpl
    });

    expect(sentBudget(fetchImpl.mock.calls[0][1])).toStrictEqual({
      max_tokens: COMMENTARY_LIMITS.detailed.answerTokens + COMMENTARY_REASONING_TOKENS,
      reasoning: { max_tokens: COMMENTARY_REASONING_TOKENS, exclude: true }
    });
  });

  it("asks again with twice the thinking room when the model thought until it ran out", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(thoughtOut())
      .mockResolvedValueOnce(completion(GOOD_ANSWER));
    const events: CommentaryReport[] = [];
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      fetchImpl,
      report: (event) => events.push(event)
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = fetchImpl.mock.calls.map(([, init]) => init);
    const answerTokens = COMMENTARY_LIMITS.balanced.answerTokens;
    expect(sentBudget(second)).toStrictEqual({
      max_tokens: answerTokens + 2 * COMMENTARY_REASONING_TOKENS,
      reasoning: { max_tokens: 2 * COMMENTARY_REASONING_TOKENS, exclude: true }
    });
    // The same question, not a correction.
    const messages = (init?: RequestInit) =>
      (JSON.parse(bodyText(init)) as { messages: unknown }).messages;
    expect(messages(second)).toStrictEqual(messages(first));
    expect(result.commentary[0]?.headline).toBe("Claiming the center at once");
    expect(result.error).toBeNull();
    expect(events).toMatchObject([
      { type: "request" },
      {
        type: "attempt",
        reason: "initial",
        result: "reasoning_exhausted",
        usage: { costUsd: 0.013 }
      },
      { type: "attempt", reason: "reasoning_retry", result: "accepted" },
      { type: "outcome", ok: true, attempts: 2 }
    ]);
  });

  it("says the model only thought when it runs out a second time", async () => {
    const fetchImpl = vi.fn(async () => thoughtOut());
    const events: CommentaryReport[] = [];
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      fetchImpl,
      report: (event) => events.push(event)
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toStrictEqual({ commentary: [], error: THOUGHT_OUT_ERROR });
    expect(events.at(-1)).toMatchObject({
      type: "outcome",
      ok: false,
      code: "reasoning_exhausted"
    });
  });

  it("keeps the plain empty-answer error when the model stopped without running out", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null } }] }),
          { status: 200 }
        )
    );
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(
      "The model returned an empty answer. Try again, or pick another model."
    );
  });

  it("returns an error, not substitute prose, when the answer fails validation twice", async () => {
    const fetchImpl = vi.fn(async () => completion("The move loses time after Qh5."));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.commentary).toStrictEqual([]);
    expect(result.error).toBe(
      "The model's answer didn't match the engine facts, even after a retry."
    );
  });

  it("reports network failures without exposing provider errors or keys", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network rejected unit-test-key"));
    const result = await generateOpenRouterCommentary([payload()], {
      apiKey: "unit-test-key",
      model: "openai/test-model",
      fetchImpl
    });

    expect(result.commentary).toStrictEqual([]);
    expect(result.error).toBe(
      "OpenRouter couldn't be reached. Check your connection and try again."
    );
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
      const result = await generateOpenRouterCommentary([payload()], {
        apiKey: "unit-test-key",
        fetchImpl
      });
      expect(result.commentary).toStrictEqual([]);
      expect(result.error).toContain(message);
      expect(JSON.stringify(result)).not.toContain("secret body");
    }
  });

  it("keeps the accepted plies of a batch when one fails", async () => {
    const second = { ...payload(), game: { ...payload().game, ply: 2 } };
    const fetchImpl = vi.fn(failingForPly(2));
    const result = await generateOpenRouterCommentary([payload(), second], {
      apiKey: "unit-test-key",
      fetchImpl
    });

    expect(result.commentary.map((item) => item.ply)).toStrictEqual([1]);
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
    expect(result).toStrictEqual({ commentary: [], error: NO_API_KEY_ERROR });
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
    puzzle: {
      fen: PUZZLE_START,
      sideToMove: "white",
      moveNumberSan: "4.",
      themes: ["mate in 1"],
      solutionSan: ["Qxf7#"]
    },
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
    const init = fetchImpl.mock.calls[0][1];
    const body = JSON.parse(bodyText(init)) as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain("tactics puzzle");
    expect(body.messages[1].content).toContain('"solutionSan"');
    expect(sentBudget(init)).toStrictEqual({
      max_tokens: COMMENTARY_LIMITS.concise.answerTokens + COMMENTARY_REASONING_TOKENS,
      reasoning: { max_tokens: COMMENTARY_REASONING_TOKENS, exclude: true }
    });
    expect(result).toStrictEqual({
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
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(completion(bad))
      .mockResolvedValueOnce(completion(PUZZLE_ANSWER));
    const retried = await explainPuzzleWithOpenRouter(puzzlePayload(), {
      apiKey: "unit-test-key",
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]?.body).toContain("You wrote the move Bxf7+");
    expect(retried.explanation?.headline).toBe("The f7 pawn had one defender");

    const always = vi.fn().mockImplementation(async () => completion(bad));
    const failed = await explainPuzzleWithOpenRouter(puzzlePayload(), {
      apiKey: "unit-test-key",
      fetchImpl: always
    });
    expect(failed).toStrictEqual({
      explanation: null,
      error: expect.stringContaining("didn't match the engine facts")
    });
  });

  it("asks again with more thinking room, then says the model only thought", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(thoughtOut())
      .mockResolvedValueOnce(completion(PUZZLE_ANSWER));
    const retried = await explainPuzzleWithOpenRouter(puzzlePayload(), {
      apiKey: "unit-test-key",
      fetchImpl
    });
    expect(sentBudget(fetchImpl.mock.calls[1][1]).max_tokens).toBe(
      COMMENTARY_LIMITS.concise.answerTokens + 2 * COMMENTARY_REASONING_TOKENS
    );
    expect(retried.explanation?.headline).toBe("The f7 pawn had one defender");

    const always = vi.fn(async () => thoughtOut());
    expect(
      await explainPuzzleWithOpenRouter(puzzlePayload(), {
        apiKey: "unit-test-key",
        fetchImpl: always
      })
    ).toStrictEqual({ explanation: null, error: THOUGHT_OUT_ERROR });
    expect(always).toHaveBeenCalledTimes(2);
  });

  it("is cancelled by its signal, without an error to show", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
          controller.abort();
        })
    );
    const result = await explainPuzzleWithOpenRouter(puzzlePayload(), {
      apiKey: "unit-test-key",
      fetchImpl,
      signal: controller.signal
    });
    expect(result).toStrictEqual({ explanation: null, error: null, cancelled: true });
  });

  it("needs a key and a valid payload before any provider call", async () => {
    const fetchImpl = vi.fn();
    expect(
      await explainPuzzleWithOpenRouter(puzzlePayload(), { apiKey: " ", fetchImpl })
    ).toStrictEqual({
      explanation: null,
      error: NO_API_KEY_ERROR
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() =>
      parsePuzzleExplanationPayload({ ...puzzlePayload(), outcome: "failed_wrong_move" })
    ).toThrow(/mistake is required for failed_wrong_move/);
  });
});
