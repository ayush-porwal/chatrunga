import { describe, expect, it } from "vitest";
import { reviewInsightPayloadSchema, type ReviewInsightPayload } from "../schemas/review-insight";
import {
  COACH_SYSTEM_PROMPT,
  COMMENTARY_LIMITS,
  answerTokensForDetail,
  buildRetryMessage,
  buildUserMessage,
  groundedSanTokens,
  parseCoachResponse,
  validateCommentary,
  validateProse,
  type CommentaryValidationFailure,
  type CommentaryValidationResult
} from "./commentary";

/** Mid-game mistake (4.Nxe5? in the Blackburne Shilling trap) with full context. */
function payload(overrides: Partial<ReviewInsightPayload> = {}): ReviewInsightPayload {
  return reviewInsightPayloadSchema.parse({
    schemaVersion: 3,
    player: { rating: 1500, color: "white" },
    game: {
      ply: 7,
      moveNumberSan: "4.",
      san: "Nxe5",
      mover: "white",
      fenBefore: "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      fenAfter: "r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4",
      phase: "opening"
    },
    engines: {
      stockfish: {
        evalBefore: "+0.90",
        evalAfter: "-1.80",
        evalLossCp: 270,
        bestMoveSan: "Nxd4",
        bestLineSan: ["Nxd4", "exd4", "c3"],
        evalPerspective: "white",
        bestEvalAfter: "+0.90",
        assessment: {
          before: "white_slightly_better",
          after: "black_clearly_better",
          afterBest: "white_slightly_better"
        },
        alternatives: [
          { rank: 1, san: "Nxd4", eval: "+0.90", lineSan: ["Nxd4", "exd4", "c3", "dxc3"] },
          { rank: 2, san: "O-O", eval: "+0.60", lineSan: ["O-O", "Nf6", "Nxd4"] }
        ],
        replyLineSan: ["Qg5", "Nxf7", "Qxg2", "Rf1", "Qxe4+", "Be2", "Nf3#"]
      },
      maia: {
        model: "maia3",
        rating: 1500,
        playedProb: 0.3,
        playedRank: 1,
        playedLikelihood: "most_likely",
        bestProb: 0.22,
        bestRank: 2,
        bestLikelihood: "common",
        topMoves: [
          { san: "Nxe5", prob: 0.3 },
          { san: "Nc3", prob: 0.2 }
        ],
        whiteWinPct: 56
      },
      maiaCurve: {
        ratings: [1100, 1300, 1500, 1700, 1900],
        playedProb: [0.4, 0.35, 0.3, 0.2, 0.1],
        bestProb: [0.2, 0.25, 0.3, 0.35, 0.4],
        interpretation: { label: "neutral" },
        userRatingBucket: 1500,
        bestLikelyFrom: 1500
      }
    },
    annotation: "blunder",
    severity: "blunder",
    curatorReason: "mistake",
    tacticalFacts: [],
    engineSignals: [],
    bestMoveMotifs: ["capture"],
    clock: { moverRemainingSec: 284, moverSpentSec: 8 },
    context: {
      players: { white: "Alice", black: "Bob" },
      opening: "C50 Italian Game",
      totalPlies: 40,
      recentMoves: [
        {
          moveNumberSan: "3.",
          san: "Bc4",
          mover: "white",
          evalAfter: "+0.25"
        },
        {
          moveNumberSan: "3...",
          san: "Nd4",
          mover: "black",
          annotation: "inaccuracy",
          evalAfter: "+0.90"
        }
      ],
      trend: "stable",
      mistakesSoFar: {
        white: { inaccuracies: 0, mistakes: 0, blunders: 0 },
        black: { inaccuracies: 1, mistakes: 0, blunders: 0 }
      },
      actualReply: {
        moveNumberSan: "4...",
        san: "Qg5",
        annotation: "great",
        matchesEngine: true
      }
    },
    commentaryDetail: "balanced",
    ...overrides
  });
}

/** The failure a validation must be (throws when it passed). */
function failureOf(result: CommentaryValidationResult): CommentaryValidationFailure {
  if (result.ok) throw new Error(`expected a failure, got "${result.prose}"`);
  return result;
}

function withDetail(detail: ReviewInsightPayload["commentaryDetail"]): ReviewInsightPayload {
  return { ...payload(), commentaryDetail: detail };
}

describe("review insight payload schema", () => {
  it("accepts the full context payload and strips nothing it knows", () => {
    const parsed = payload();
    expect(parsed.context?.recentMoves).toHaveLength(2);
    expect(parsed.engines.stockfish.replyLineSan).toHaveLength(7);
    expect(parsed.engines.maia?.topMoves?.[0]?.san).toBe("Nxe5");
    expect(parsed.engines.maiaCurve?.bestLikelyFrom).toBe(1500);
  });

  it("still accepts a legacy payload without any of the new fields", () => {
    const legacy = payload();
    delete legacy.context;
    delete legacy.clock;
    delete legacy.bestMoveMotifs;
    delete legacy.engines.maia;
    delete legacy.engines.maiaCurve;
    const stockfish = legacy.engines.stockfish;
    delete stockfish.alternatives;
    delete stockfish.replyLineSan;
    delete stockfish.assessment;
    delete stockfish.evalPerspective;
    delete stockfish.bestEvalAfter;
    expect(() => reviewInsightPayloadSchema.parse(legacy)).not.toThrow();
  });

  it("bounds the size of context arrays", () => {
    const base = payload();
    const tooManyAlternatives = Array.from({ length: 4 }, (_, index) => ({
      rank: index + 1,
      san: "Nc3",
      eval: "+0.10",
      lineSan: []
    }));
    expect(() =>
      reviewInsightPayloadSchema.parse({
        ...base,
        engines: {
          ...base.engines,
          stockfish: { ...base.engines.stockfish, alternatives: tooManyAlternatives }
        }
      })
    ).toThrow(/at most 3/);
    const recent = Array.from({ length: 9 }, () => ({
      moveNumberSan: "3.",
      san: "Bc4",
      mover: "white"
    }));
    expect(() =>
      reviewInsightPayloadSchema.parse({
        ...base,
        context: { ...base.context, recentMoves: recent }
      })
    ).toThrow(/at most 8/);
    expect(() =>
      reviewInsightPayloadSchema.parse({
        ...base,
        context: { ...base.context, event: "x".repeat(81) }
      })
    ).toThrow(/at most 80/);
  });

  it("accepts terminal checkmate payloads with an M0 evaluation", () => {
    const base = payload();
    const mate = reviewInsightPayloadSchema.parse({
      ...base,
      game: { ...base.game, san: "Rd8#", terminal: "checkmate", givesCheck: true },
      engines: {
        ...base.engines,
        stockfish: { ...base.engines.stockfish, evalAfter: "M0", evalLossCp: 0 }
      }
    });
    expect(mate.game.terminal).toBe("checkmate");
  });

  it("takes a Maia 3 curve over 21 ratings and refuses a curve that doesn't line up", () => {
    const base = payload();
    const ratings = Array.from({ length: 21 }, (_, index) => 600 + index * 100);
    const curve = {
      ratings,
      playedProb: ratings.map(() => 0.1),
      bestProb: ratings.map(() => 0.4),
      interpretation: { label: "neutral" },
      userRatingBucket: 1500
    };
    const withCurve = (maiaCurve: Record<string, unknown>) =>
      reviewInsightPayloadSchema.safeParse({ ...base, engines: { ...base.engines, maiaCurve } });
    expect(withCurve(curve).success).toBe(true);
    expect(withCurve({ ...curve, playedProb: [0.1, 0.2] }).success).toBe(false);
    expect(withCurve({ ...curve, ratings: [...ratings].reverse() }).success).toBe(false);
    expect(withCurve({ ...curve, userRatingBucket: 1550 }).success).toBe(false);
    expect(
      withCurve({ ...curve, ratings: [...ratings, 2700], playedProb: [], bestProb: [] }).success
    ).toBe(false);
  });

  it("rejects payloads of an earlier version", () => {
    expect(reviewInsightPayloadSchema.safeParse({ ...payload(), schemaVersion: 2 }).success).toBe(
      false
    );
  });
});

describe("coach prompt", () => {
  it("asks for a coach voice, ideas and structured output while keeping the grounding contract", () => {
    for (const field of [
      "replyLineSan",
      "alternatives",
      "recentMoves",
      "actualReply",
      "terminal",
      "assessment",
      "clock",
      "ideas.played.facts",
      "ideas.best.facts",
      "ideas.reply.facts",
      "ideas.position",
      "engines.maia",
      "winChance"
    ]) {
      expect(COACH_SYSTEM_PROMPT).toContain(field);
    }
    expect(COACH_SYSTEM_PROMPT).toContain("The facts are the only source of truth");
    expect(COACH_SYSTEM_PROMPT).toContain("Never invent a tactic");
    expect(COACH_SYSTEM_PROMPT).toContain('NEVER write "the engine recommends');
    expect(COACH_SYSTEM_PROMPT).toContain('{"headline": "...", "body": "..."}');
    expect(COACH_SYSTEM_PROMPT).not.toContain("takeaway");
    expect(COACH_SYSTEM_PROMPT).toContain(
      `detailed = ${COMMENTARY_LIMITS.detailed.targetSentences} sentences`
    );
    // Three few-shot examples, each a valid JSON answer.
    const examples = COACH_SYSTEM_PROMPT.split("\n")
      .filter((line) => line.startsWith('{"headline"'))
      .filter((line) => !line.includes('"..."'));
    expect(examples).toHaveLength(3);
    for (const example of examples) {
      const parts = parseCoachResponse(example);
      expect(parts.headline).toBeTruthy();
      expect(Object.keys(parts).sort()).toStrictEqual(["body", "headline"]);
    }
  });

  it("describes Maia 3 as one rating-conditioned model and its win % as a human forecast", () => {
    const maiaLines = COACH_SYSTEM_PROMPT.split("\n").filter((line) =>
      line.startsWith("- engines.maia")
    );
    expect(maiaLines).toHaveLength(2);
    const [maia, curve] = maiaLines;
    expect(maia).toContain("model maia3 is one model covering ratings 600-2600");
    expect(maia).toContain("engines.maia.rating (the mover's rating");
    expect(maia).toContain("model maia1 (older reviews) is five networks for 1100-1900");
    expect(maia).toContain("whiteWinPct (maia3 only)");
    expect(maia).toContain("not an evaluation of the position");
    expect(maia).toContain("not counts of real games");
    expect(curve).toContain("engines.maiaCurve (only when present)");
    expect(curve).toContain("bestLikelyFrom");
    expect(curve).toContain("only with ratings from the curve");
    // The old per-level fields are gone from the contract.
    expect(COACH_SYSTEM_PROMPT).not.toMatch(/humanTopMoves|playedAtPlayerLevel/);
  });

  it("scales the answer's token allowance with the requested detail", () => {
    expect(answerTokensForDetail("concise")).toBeLessThan(answerTokensForDetail("balanced"));
    expect(answerTokensForDetail("balanced")).toBeLessThan(answerTokensForDetail("detailed"));
    expect(answerTokensForDetail(undefined)).toBe(answerTokensForDetail("balanced"));
  });

  it("sends the facts, the move and the requested length in the user message", () => {
    const message = buildUserMessage(withDetail("detailed"));
    expect(message).toContain('"replyLineSan"');
    expect(message).toContain("4. Nxe5");
    expect(message).toContain("detailed, 5-7 sentences");
    expect(message).toContain('{"headline": "...", "body": "..."}');
    expect(message).not.toContain("takeaway");
  });

  it("builds a retry turn that names the exact problem", () => {
    const failure = failureOf(validateProse("Nxe5 lost to Bxf7+.", payload()));
    const retry = buildRetryMessage(failure, payload());
    expect(retry).toContain("You wrote the move Bxf7+");
    expect(retry).not.toContain("STRICTER");
    expect(retry).not.toContain("takeaway");
  });
});

describe("parseCoachResponse", () => {
  const json = '{"headline": "Knight grab walks into Qg5", "body": "Nxe5 looks like a free pawn."}';

  it("parses the JSON object, fenced or surrounded by stray text", () => {
    expect(parseCoachResponse(json)).toStrictEqual({
      headline: "Knight grab walks into Qg5",
      body: "Nxe5 looks like a free pawn."
    });
    expect(parseCoachResponse("```json\n" + json + "\n```").headline).toBe(
      "Knight grab walks into Qg5"
    );
    expect(parseCoachResponse("Here you go:\n" + json + "\nHope it helps").body).toBe(
      "Nxe5 looks like a free pawn."
    );
  });

  it("ignores a takeaway from models that still send one", () => {
    const withTakeaway = JSON.stringify({
      headline: "A free pawn",
      body: "Nxe5 wins it.",
      takeaway: "Look first."
    });
    expect(parseCoachResponse(withTakeaway)).toStrictEqual({
      headline: "A free pawn",
      body: "Nxe5 wins it."
    });
  });

  it("falls back to plain text as the body", () => {
    expect(parseCoachResponse("Nxe5 walks into Qg5.")).toStrictEqual({
      body: "Nxe5 walks into Qg5."
    });
    expect(parseCoachResponse('{"oops": 1}').body).toBe('{"oops": 1}');
  });
});

describe("validateProse with context", () => {
  it("grounds SAN from alternatives, the reply line, history, the actual reply and Maia", () => {
    expect([...groundedSanTokens(payload())]).toStrictEqual(
      expect.arrayContaining(["Nxd4", "O-O", "dxc3", "Qg5", "Qxe4+", "Nf3#", "Bc4", "Nd4", "Nc3"])
    );
    const prose =
      "After 3...Nd4, 4. Nxe5 walks into Qg5, which hits g2; Nxf7 then runs into Qxg2 and Qxe4+. Nxd4 or O-O kept White slightly better.";
    expect(validateProse(prose, payload())).toStrictEqual({ ok: true, prose });
  });

  it("returns the headline from a JSON answer", () => {
    const answer = JSON.stringify({
      headline: "The e5 pawn was poisoned",
      body: "Nxe5 grabs a pawn, but Qg5 hits your knight and g2 at the same time. Nxd4 first kept White slightly better."
    });
    expect(validateProse(answer, payload())).toStrictEqual({
      ok: true,
      headline: "The e5 pawn was poisoned",
      prose:
        "Nxe5 grabs a pawn, but Qg5 hits your knight and g2 at the same time. Nxd4 first kept White slightly better."
    });
  });

  it("treats check and mate suffixes as the same grounded move", () => {
    expect(validateProse("The reply line ends with Nf3 and mate.", payload()).ok).toBe(true);
    expect(
      validateProse("Nxd4+ was never on the board, but Nxd4 was the best move.", payload()).ok
    ).toBe(true);
    const mate = payload({
      game: { ...payload().game, san: "Rd8#", terminal: "checkmate" }
    });
    expect(validateProse("Rd8# ends the game.", mate).ok).toBe(true);
    expect(validateProse("Rd8 ends the game.", mate).ok).toBe(true);
  });

  it("allows squares of pieces on the board and piece references, but still rejects ungrounded SAN and empty squares", () => {
    // c4 bishop, d4 knight and f3 knight stand on the board before the move.
    expect(
      validateProse("The bishop on c4 and your knight on f3 were both active.", payload()).ok
    ).toBe(true);
    expect(validateProse("Your Bc4 was aiming at f7.", payload()).ok).toBe(true);
    const badSan = validateProse("Nxe5 lost to Bxf7+.", payload());
    expect(badSan).toMatchObject({ ok: false, reason: "BAD_SAN", details: "Bxf7+" });
    const badMove = validateProse("Nd5 was better.", payload());
    expect(badMove).toMatchObject({ ok: false, reason: "BAD_SAN", details: "Nd5" });
    const badSquare = validateProse("Nxe5 left the h6 square weak.", payload());
    expect(badSquare).toMatchObject({ ok: false, reason: "BAD_SQUARE", details: "h6" });
  });

  it("allows squares and SAN that only appear in the idea facts", () => {
    const withIdeas = payload({
      ideas: {
        board: {
          white: "K e1; Q d1; R a1 h1; B c1 c4; N b1 f3; P a2 b2 c2 d2 e4 f2 g2 h2",
          black: "K e8; Q d8"
        },
        played: { san: "Nxe5", facts: ["attacks the pawn on f7 (defended once)"] },
        reply: {
          san: "Qg5",
          facts: [
            "forks the knight on e5 and the pawn on g2",
            "sets up Qxg2 after Nxf7, capturing the pawn on g2"
          ]
        }
      }
    });
    expect(
      validateProse("Qg5 forks the knight and g2; Qxg2 follows. The h6 square is empty.", withIdeas)
    ).toMatchObject({
      ok: false,
      details: "h6"
    });
    expect(
      validateProse("Qg5 forks the knight and the pawn on g2, and Qxg2 follows.", withIdeas).ok
    ).toBe(true);
  });

  it("rejects engine-authority narration, hype and raw evaluations", () => {
    expect(validateProse("The engine recommends Nxd4.", payload())).toMatchObject({
      ok: false,
      reason: "BANNED_PHRASE"
    });
    expect(validateProse("Instead, the engine suggested Nxd4.", payload())).toMatchObject({
      ok: false,
      reason: "BANNED_PHRASE"
    });
    expect(validateProse("This was a crucial error.", payload())).toMatchObject({
      ok: false,
      reason: "BANNED_PHRASE"
    });
    expect(validateProse("Nxe5 drops the evaluation to -1.80.", payload())).toMatchObject({
      ok: false,
      reason: "RAW_EVAL"
    });
    expect(validateProse("Nxe5 was a good try but Nxd4 was stronger.", payload()).ok).toBe(true);
  });

  it("validates the headline shape", () => {
    const base = { body: "Nxe5 walks into Qg5." };
    expect(
      validateCommentary(
        { ...base, headline: "one two three four five six seven eight nine" },
        payload()
      )
    ).toMatchObject({
      ok: false,
      reason: "BAD_HEADLINE"
    });
    expect(validateCommentary({ ...base, headline: "Qxh7 was the idea" }, payload())).toMatchObject(
      {
        ok: false,
        reason: "BAD_SAN",
        part: "headline"
      }
    );
  });

  it("applies per-detail sentence and length limits to the body", () => {
    const sentences = (count: number) =>
      Array.from({ length: count }, () => "Nxe5 lost material.").join(" ");
    const { concise, balanced, detailed } = COMMENTARY_LIMITS;
    expect(validateProse(sentences(concise.maxSentences), withDetail("concise")).ok).toBe(true);
    expect(validateProse(sentences(concise.maxSentences + 1), withDetail("concise"))).toMatchObject(
      { ok: false, reason: "TOO_MANY_SENTENCES" }
    );
    expect(validateProse(sentences(balanced.maxSentences), withDetail("balanced")).ok).toBe(true);
    expect(
      validateProse(sentences(balanced.maxSentences + 1), withDetail("balanced"))
    ).toMatchObject({ ok: false, reason: "TOO_MANY_SENTENCES" });
    expect(validateProse(sentences(detailed.maxSentences), withDetail("detailed")).ok).toBe(true);
    expect(
      validateProse(sentences(detailed.maxSentences + 1), withDetail("detailed"))
    ).toMatchObject({ ok: false, reason: "TOO_MANY_SENTENCES" });
    const long = `Nxe5 lost material ${"because the knight was loose ".repeat(30)}.`;
    expect(validateProse(long, withDetail("balanced"))).toMatchObject({
      ok: false,
      reason: "TOO_LONG"
    });
    expect(validateProse(long, withDetail("detailed")).ok).toBe(true);
  });

  it("does not count move numbers as sentence breaks", () => {
    const prose = "After 3... Nd4, 4. Nxe5 allowed Qg5. Nxd4 was stronger. It kept the balance.";
    expect(validateProse(prose, withDetail("concise")).ok).toBe(true);
  });
});
