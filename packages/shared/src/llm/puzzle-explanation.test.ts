import { describe, expect, it } from "vitest";
import { puzzleInsightPayloadSchema, type PuzzleInsightPayload } from "../schemas/puzzle-insight";
import { buildRetryMessage } from "./commentary";
import {
  PUZZLE_COACH_SYSTEM_PROMPT,
  buildPuzzleUserMessage,
  puzzleGroundedSanTokens,
  validatePuzzleProse
} from "./puzzle-explanation";

const START = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const AFTER_QXE5 = "r1bqkb1r/pppp1ppp/2n2n2/4Q3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4";

/** Scholar's mate as a puzzle (4.Qxf7#), failed by 4.Qxe5+? (the knight on c6 takes the queen). */
function payload(overrides: Partial<PuzzleInsightPayload> = {}): PuzzleInsightPayload {
  return puzzleInsightPayloadSchema.parse({
    schemaVersion: 1,
    player: { rating: 1300 },
    puzzle: {
      fen: START,
      sideToMove: "white",
      moveNumberSan: "4.",
      rating: 1500,
      themes: ["mate", "mate in 1"],
      opening: "Italian Game",
      solutionSan: ["Qxf7#"]
    },
    outcome: "failed_wrong_move",
    engine: {
      engineName: "Stockfish 17",
      assessment: "white_has_forced_mate",
      bestMoveSan: "Qxf7#",
      bestLineSan: ["Qxf7#"],
      alternatives: [{ rank: 2, san: "Qe2", lineSan: ["Qe2", "Bc5"], assessment: "equal" }]
    },
    mistake: {
      moveNumberSan: "4.",
      san: "Qxe5+",
      playedBeforeSan: [],
      solutionSan: "Qxf7#",
      fenBefore: START,
      fenAfter: AFTER_QXE5,
      refutationSan: ["Nxe5"],
      assessmentBefore: "white_has_forced_mate",
      assessmentAfter: "black_winning",
      swing: "decisive",
      stillWinning: false
    },
    ideas: {
      board: {
        white: "K e1; Q e5; R a1 h1; B c1 c4; N b1 g1; P a2 b2 c2 d2 e4 f2 g2 h2",
        black: "K e8; Q d8; R a8 h8; B c8 f8; N c6 f6; P a7 b7 c7 d7 f7 g7 h7"
      },
      played: { san: "Qxe5+", facts: ["takes the pawn on e5, with check"] },
      best: { san: "Qxf7#", facts: ["takes the pawn on f7, checkmate"] },
      reply: { san: "Nxe5", facts: ["takes the queen on e5"] }
    },
    commentaryDetail: "concise",
    ...overrides
  });
}

const good = JSON.stringify({
  headline: "The f7 pawn was the target",
  body: "Qxe5+ grabs a pawn with check, but the knight on c6 simply answers Nxe5 and your queen is gone. The real weakness was f7, guarded only by the king, and with the bishop on c4 behind it Qxf7# is mate at once."
});

describe("puzzle explanation contract", () => {
  it("accepts a grounded answer and keeps headline and body", () => {
    expect(validatePuzzleProse(good, payload())).toEqual({
      ok: true,
      headline: "The f7 pawn was the target",
      prose: expect.stringContaining("Qxf7#")
    });
  });

  it("grounds the solution, engine lines, the wrong move, its refutation and SAN in the ideas", () => {
    expect([...puzzleGroundedSanTokens(payload())].sort()).toEqual([
      "Bc5",
      "Nxe5",
      "Qe2",
      "Qxe5+",
      "Qxf7#"
    ]);
  });

  it("rejects a move the facts don't contain", () => {
    const answer = JSON.stringify({
      headline: "Mate on f7",
      body: "After Bxf7+ the king walks, but Qxf7# is mate."
    });
    expect(validatePuzzleProse(answer, payload())).toMatchObject({
      ok: false,
      reason: "BAD_SAN",
      details: "Bxf7+"
    });
  });

  it("rejects an empty square no fact names", () => {
    const answer = JSON.stringify({
      headline: "Mate on f7",
      body: "The square a5 matters, but Qxf7# is mate."
    });
    expect(validatePuzzleProse(answer, payload())).toMatchObject({
      ok: false,
      reason: "BAD_SQUARE",
      details: "a5"
    });
  });

  it("accepts a square occupied after the wrong move (the queen on e5)", () => {
    const answer = JSON.stringify({
      headline: "Mate on f7",
      body: "Your queen on e5 is lost to Nxe5, while Qxf7# was mate."
    });
    expect(validatePuzzleProse(answer, payload())).toMatchObject({ ok: true });
  });

  it("rejects raw evaluations and engine-authority phrasing like the review coach", () => {
    const raw = JSON.stringify({
      headline: "Mate on f7",
      body: "Qxf7# wins, while after Nxe5 Black is +5.2."
    });
    expect(validatePuzzleProse(raw, payload())).toMatchObject({ ok: false, reason: "RAW_EVAL" });
    const engine = JSON.stringify({
      headline: "Mate on f7",
      body: "The engine recommends Qxf7# here."
    });
    expect(validatePuzzleProse(engine, payload())).toMatchObject({
      ok: false,
      reason: "BANNED_PHRASE"
    });
  });

  it("caps the body by the requested detail", () => {
    const long = JSON.stringify({
      headline: "Mate on f7",
      body: "Qxf7# is mate. ".repeat(30).trim()
    });
    expect(validatePuzzleProse(long, payload())).toMatchObject({ ok: false, reason: "TOO_LONG" });
    expect(
      buildRetryMessage({ ok: false, reason: "TOO_LONG", details: "len=500" }, payload())
    ).toContain("under 330 characters");
  });

  it("only grounds the start position for a solved puzzle (no mistake facts)", () => {
    const solved = payload({ outcome: "solved", mistake: undefined, ideas: undefined });
    const answer = JSON.stringify({
      headline: "Mate on f7",
      body: "Nxe5 was never on the table; Qxf7# mates."
    });
    expect(validatePuzzleProse(answer, solved)).toMatchObject({
      ok: false,
      reason: "BAD_SAN",
      details: "Nxe5"
    });
  });

  it("needs the mistake exactly when a wrong move failed the puzzle", () => {
    expect(() => payload({ outcome: "solved" })).toThrow(
      /mistake is required for failed_wrong_move/
    );
    expect(() => payload({ mistake: undefined })).toThrow(
      /mistake is required for failed_wrong_move/
    );
    expect(() => payload({ outcome: "failed_solution_viewed", mistake: undefined })).not.toThrow();
  });

  it("never grounds a reply to a wrong move that ended the game, and allows none in the facts", () => {
    const mate = payload({
      mistake: {
        ...payload().mistake!,
        san: "Qh8#",
        fenAfter: START,
        ends: "checkmate",
        refutationSan: [],
        assessmentAfter: "white_won",
        swing: undefined,
        stillWinning: undefined
      },
      ideas: undefined
    });
    expect(puzzleGroundedSanTokens(mate).has("Nxe5")).toBe(false);
    const answer = JSON.stringify({
      headline: "Two ways to mate",
      body: "Qh8# is mate as well, but Nxe5 was coming."
    });
    expect(validatePuzzleProse(answer, mate)).toMatchObject({
      ok: false,
      reason: "BAD_SAN",
      details: "Nxe5"
    });
    expect(() => payload({ mistake: { ...payload().mistake!, ends: "stalemate" } })).toThrow(
      /no refutation/
    );
  });

  it("asks a mate to be called a mate, and a stalemate or draw to be called one, not refuted", () => {
    const base = payload().mistake!;
    const ending = (ends: "checkmate" | "stalemate" | "draw") =>
      payload({ mistake: { ...base, san: "Qh8#", ends, refutationSan: [] } });
    expect(buildPuzzleUserMessage(ending("checkmate"))).toContain(
      "Qh8# is checkmate too: say so, and explain the idea of the line the puzzle expected (Qxf7#) now."
    );
    expect(buildPuzzleUserMessage(ending("stalemate"))).toContain(
      "Qh8# stalemates your opponent, throwing the win away"
    );
    expect(buildPuzzleUserMessage(ending("draw"))).toContain(
      "Qh8# draws the game at once, throwing the win away"
    );
    expect(buildPuzzleUserMessage(ending("checkmate"))).not.toContain("does not work");
    expect(PUZZLE_COACH_SYSTEM_PROMPT).toContain("do NOT call it a mistake");
  });

  it("asks for the case the outcome describes", () => {
    expect(buildPuzzleUserMessage(payload())).toContain("Explain why Qxe5+ does not work");
    expect(buildPuzzleUserMessage(payload({ outcome: "solved", mistake: undefined }))).toContain(
      "Explain the idea of the position and why the solution works now."
    );
    expect(buildPuzzleUserMessage(payload())).toMatch(/^FACTS:\n\{/);
    expect(PUZZLE_COACH_SYSTEM_PROMPT).toContain("failed_solution_viewed");
  });
});
