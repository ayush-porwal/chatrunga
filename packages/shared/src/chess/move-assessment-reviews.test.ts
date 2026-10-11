import { describe, expect, it } from "vitest";
import type { MoveReview, RatingPrediction } from "../types/engine";
import {
  MOVE_ASSESSMENT_POLICY,
  annotationGlyph,
  annotationLabel,
  annotationOf,
  assessMove,
  assessMoves,
  severityOf,
  summarizeMoves,
  verificationNeed,
  withCurrentAssessments
} from "./move-assessment";
import { parseOpeningBook, type OpeningBook } from "./opening-book";
import { openingBookText } from "./opening-book-data";
import { START_FEN } from "./position";
import { parseLine, trapReviewMoves } from "./__fixtures__/trap-game";
import { GREEK_GIFT, ONE_LEGAL_MOVE, position, verified } from "./__fixtures__/assessable-moves";

/** A copy of `items` with the one at `index` replaced. */
function replacedAt<T>(items: readonly T[], index: number, replace: (item: T) => T): T[] {
  const copy = [...items];
  copy[index] = replace(copy[index]);
  return copy;
}

/** The trap game's moves with a deeper search that confirms 4... Qg5 (its eighth ply). */
function trapReviewMovesVerifyingQg5(): MoveReview[] {
  return replacedAt(trapReviewMoves(), 7, (move) => ({
    ...move,
    verification: { deeperLines: move.topLines }
  }));
}

/** The assessed move as if assessed under another policy. */
function withPolicy(move: MoveReview, policy: number): MoveReview {
  if (!move.assessment) throw new Error(`move ${move.san} isn't assessed`);
  return { ...move, assessment: { ...move.assessment, policy } };
}

let bundledBook: OpeningBook | null = null;
/** The bundled opening book (read once for the file). */
function openingBook(): OpeningBook {
  bundledBook ??= parseOpeningBook(openingBookText());
  return bundledBook;
}

describe("verificationNeed", () => {
  it("asks for a deeper search for a Great or Brilliant candidate only", () => {
    expect(
      verificationNeed(
        position(START_FEN, "e4", [
          ["e2e4", "cp 150"],
          ["d2d4", "cp -50"]
        ])
      )
    ).toBe("candidate");
    expect(
      verificationNeed(
        position(GREEK_GIFT, "Bxh7+", [
          ["d3h7 g8h7 f3g5", "cp 250"],
          ["e1g1 c7c5", "cp 60"]
        ])
      )
    ).toBe("candidate");
    expect(
      verificationNeed(position(GREEK_GIFT, "Bxh7+", [["d3h7 g8h7 f3g5", "cp 250"]]))
    ).toBeNull();
    expect(
      verificationNeed(
        position(START_FEN, "e4", [
          ["e2e4", "cp 30"],
          ["d2d4", "cp 25"]
        ])
      )
    ).toBeNull();
    expect(
      verificationNeed(
        position(START_FEN, "e4", [
          ["e2e4", "cp 800"],
          ["d2d4", "cp 0"]
        ])
      )
    ).toBeNull();
    expect(verificationNeed(position(ONE_LEGAL_MOVE, "Kxb2", [["a1b2", "cp 0"]]))).toBeNull();
  });

  it("runs no deeper search for a move the exclusions rule out", () => {
    // 1. e4 d5 2. exd5 Qxd5: a recapture, however critical, is never praised, so it isn't searched.
    const afterTake = "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";
    const capture = position(
      "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      "exd5",
      [["e4d5", "cp 30"]]
    );
    // Maia says Qxd5 was no natural move, so only the recapture rule stands in the way.
    const unusual: RatingPrediction[] = [
      { rating: 1500, topMoves: [{ uci: "g8f6", prob: 0.5 }], playedProb: 0.05 }
    ];
    const recapture = position(
      afterTake,
      "Qxd5",
      [
        ["d8d5 b1c3 d5a5", "cp 0"],
        ["g8f6 c2c4 e7e6", "cp -300"]
      ],
      {
        ply: 30,
        humanPredictions: unusual
      }
    );
    const previous = { move: capture, assessment: assessMove(capture) };
    expect(verificationNeed(recapture)).toBe("candidate");
    expect(verificationNeed(recapture, { previous })).toBeNull();
    expect(assessMove(verified(recapture), { previous }).annotation).toBeNull();
    // A book move (opening theory): no search either, however early or late.
    const early = position(
      START_FEN,
      "e4",
      [
        ["e2e4", "cp 50"],
        ["d2d4", "cp -62"]
      ],
      { ply: 4 }
    );
    expect(verificationNeed(early, { book: true })).toBeNull();
    expect(verificationNeed(early)).toBe("candidate");
    // Nor a recheck for a book move whose loss sits on a severity boundary.
    const near = position(START_FEN, "a3", [["e2e4", "cp 120"]], { reply: "cp 51 pv e7e5" });
    expect(verificationNeed(near)).toBe("recheck");
    expect(verificationNeed(near, { book: true })).toBeNull();
  });

  it.each([
    ["a loss right at the Blunder line", "cp 51", "recheck"],
    ["a loss well past it", "cp 200", null],
    ["a loss between lines", "cp 20", null]
  ] as const)(
    "asks for the played move alone near a severity boundary: %s",
    (_name, reply, need) => {
      // Before: cp 120 (60.8%). Reply cp 51 → 45.3% (15.5 points lost).
      expect(
        verificationNeed(
          position(START_FEN, "a3", [["e2e4", "cp 120"]], { reply: `${reply} pv e7e5` })
        )
      ).toBe(need);
    }
  );

  it("needs nothing once rechecked, after a terminal move, or without data", () => {
    const near = position(START_FEN, "a3", [["e2e4", "cp 120"]], { reply: "cp 51 pv e7e5" });
    const checked = {
      ...near,
      verification: { playedLine: parseLine("cp -30 pv a2a3", 1, START_FEN) }
    };
    expect(verificationNeed(checked)).toBeNull();
    expect(assessMove(checked)).toMatchObject({ severity: "mistake", winLoss: 13.6 });
    expect(verificationNeed({ ...near, terminal: "draw" })).toBeNull();
    expect(verificationNeed(position(START_FEN, "a3", []))).toBeNull();
    expect(
      verificationNeed(position(START_FEN, "a3", [["e2e4", "mate 3"]], { reply: "cp 51 pv e7e5" }))
    ).toBeNull();
  });
});

describe("book moves", () => {
  it("marks a book move Book and never an error, whatever the engine thinks of it", () => {
    const dubious = position(START_FEN, "a3", [
      ["e2e4", "cp 40"],
      ["a2a3", "cp -400"]
    ]);
    expect(assessMove(dubious).severity).toBe("blunder");
    const book = assessMove(dubious, { book: true });
    expect(book).toMatchObject({ severity: null, annotation: "book", winLoss: expect.any(Number) });
    expect(book.tags).toContain("book");
  });

  it("is never praised either, and stays Book without the evaluations to assess it", () => {
    const find = verified(
      position(START_FEN, "e4", [
        ["e2e4", "cp 10"],
        ["d2d4", "cp -600"]
      ])
    );
    expect(assessMove(find, { book: true }).annotation).toBe("book");
    expect(assessMove(position(START_FEN, "e4", []), { book: true })).toMatchObject({
      annotation: "book",
      severity: null,
      tags: ["book", "incomplete"]
    });
  });

  it("marks the trap game's moves Book while it is in the book, then judges the rest", () => {
    const moves = trapReviewMovesVerifyingQg5();
    const assessments = assessMoves(moves, { openingBook: openingBook() });
    // 3… Nd4 is the Blackburne–Kostić Gambit: theory, no longer an inaccuracy.
    expect(assessments.map((item) => item.annotation)).toStrictEqual([
      "book",
      "book",
      "book",
      "book",
      "book",
      "book",
      "blunder",
      "great",
      "blunder",
      "good",
      null,
      null,
      "mistake",
      null
    ]);
    expect(
      summarizeMoves(moves.map((move, index) => ({ ...move, assessment: assessments[index] })))
    ).toMatchObject({ book: 6, inaccuracies: 0, mistakes: 1, blunders: 2 });
  });
});

describe("the trap game (regression)", () => {
  it("marks only the moves that matter, as the live review does", () => {
    const moves = trapReviewMovesVerifyingQg5();
    const assessments = assessMoves(moves);
    expect(moves.map((move, index) => [move.san, assessments[index]?.annotation])).toStrictEqual([
      ["e4", null],
      ["e5", null],
      ["Nf3", null],
      ["Nc6", null],
      ["Bc4", null],
      ["Nd4", "inaccuracy"],
      ["Nxe5", "blunder"],
      ["Qg5", "great"],
      ["Nxf7", "blunder"],
      ["Qxg2", "good"],
      ["Rf1", null],
      ["Qxe4+", null],
      ["Be2", "mistake"],
      ["Nf3#", null]
    ]);
  });
});

describe("saved reviews", () => {
  function storedReview(): { schemaVersion: number; moves: MoveReview[] } & Omit<
    Parameters<typeof withCurrentAssessments>[0],
    "moves"
  > {
    return {
      schemaVersion: 2,
      engineId: "sf",
      depth: null,
      moveTimeMs: 100,
      createdAt: 1,
      summary: {
        totalMoves: 14,
        best: 14,
        excellent: 0,
        good: 0,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
        missedTactics: 0,
        averageCentipawnLoss: 0
      },
      moves: trapReviewMoves().map((move) => ({ ...move, classification: "best" as const }))
    };
  }

  it("re-assesses a review from an older policy from its stored evaluations, and says so", () => {
    const review = withCurrentAssessments(storedReview());
    expect(review.assessmentPolicy).toBe(MOVE_ASSESSMENT_POLICY);
    expect(review.assessmentsRecomputed).toBe(true);
    // Errors come back; Qg5 had no deeper search, so it is only Good (it punished Nxe5), not Great.
    expect(review.moves.map((move) => annotationOf(move))).toStrictEqual([
      null,
      null,
      null,
      null,
      null,
      "inaccuracy",
      "blunder",
      "good",
      "blunder",
      "good",
      null,
      null,
      "mistake",
      null
    ]);
    expect(review.moves[7]?.assessment?.tags).toStrictEqual(
      expect.arrayContaining(["unverified", "punishes_error"])
    );
    expect(review.summary).toMatchObject({
      inaccuracies: 1,
      mistakes: 1,
      blunders: 2,
      good: 2,
      great: 0
    });
    // The stored legacy verdict is kept as it was, never shown.
    expect(review.moves[6]?.classification).toBe("best");
  });

  it("keeps the marks of the other moves when one stored move is too damaged to assess", () => {
    const stored = storedReview();
    const damaged = { ...stored.moves[6], motifs: undefined } as unknown as MoveReview;
    const review = withCurrentAssessments({
      ...stored,
      moves: replacedAt(stored.moves, 6, () => damaged)
    });
    expect(review.assessmentsRecomputed).toBe(true);
    expect(review.moves[6]?.assessment).toBeUndefined();
    expect(review.moves.map((move) => annotationOf(move))).toStrictEqual([
      null,
      null,
      null,
      null,
      null,
      "inaccuracy",
      null,
      null,
      "blunder",
      "good",
      null,
      null,
      "mistake",
      null
    ]);
    expect(review.summary).toMatchObject({ inaccuracies: 1, mistakes: 1, blunders: 1 });
  });

  it("classifies the book moves and the opening of a review it re-assesses", () => {
    const review = withCurrentAssessments(storedReview(), { openingBook: openingBook() });
    expect(review.moves.map((move) => annotationOf(move))).toStrictEqual([
      "book",
      "book",
      "book",
      "book",
      "book",
      "book",
      "blunder",
      "good",
      "blunder",
      "good",
      null,
      null,
      "mistake",
      null
    ]);
    expect(review.opening).toStrictEqual({
      eco: "C50",
      name: "Italian Game: Blackburne-Kostić Gambit",
      ply: 6,
      bookEndPly: 6,
      firstNonBookMove: { ply: 7, san: "Nxe5" }
    });
    expect(review.summary).toMatchObject({ book: 6, inaccuracies: 0, mistakes: 1, blunders: 2 });
    // Without a book, its opening stays as it was saved.
    expect(withCurrentAssessments(storedReview())).not.toHaveProperty("opening");
  });

  it("leaves a review on the current policy as it is", () => {
    const current = withCurrentAssessments(storedReview());
    const again = { ...current, assessmentsRecomputed: undefined };
    expect(withCurrentAssessments(again)).toBe(again);
  });

  it("re-assesses one with any move from another policy", () => {
    const current = withCurrentAssessments(storedReview());
    const mixed = {
      ...current,
      moves: replacedAt(current.moves, 0, (move) => withPolicy(move, 0))
    };
    expect(withCurrentAssessments(mixed)).not.toBe(mixed);
  });

  it("distrusts the Maia data of reviews before schemaVersion 2", () => {
    const hard: RatingPrediction[] = [
      { rating: 1500, topMoves: [{ uci: "d2d4", prob: 0.6 }], playedProb: 0.04 }
    ];
    const move = {
      ...position(START_FEN, "e4", [
        ["e2e4", "cp 100"],
        ["d2d4", "cp 20"]
      ]),
      humanPredictions: hard
    };
    const asReview = (schemaVersion: number) =>
      withCurrentAssessments({
        ...storedReview(),
        schemaVersion,
        moves: [
          { ...move, nodeId: "n1", san: "e4", evalBefore: null, evalLoss: null, bestLine: [] }
        ]
      });
    expect(annotationOf(asReview(2).moves[0])).toBe("excellent");
    expect(annotationOf(asReview(1).moves[0])).toBeNull();
  });
});

describe("summary and labels", () => {
  it("counts errors by severity whether or not they are marked, and positives by mark", () => {
    const review = withCurrentAssessments({
      engineId: "sf",
      depth: null,
      moveTimeMs: null,
      createdAt: 1,
      summary: {
        totalMoves: 0,
        best: 0,
        excellent: 0,
        good: 0,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
        missedTactics: 0,
        averageCentipawnLoss: null
      },
      moves: [
        ...trapReviewMoves().map((move) => ({ ...move, evalLoss: 10 })),
        { ...trapReviewMoves()[0], nodeId: "extra", evalLoss: null }
      ]
    });
    expect(review.summary).toStrictEqual({
      totalMoves: 15,
      book: 0,
      best: 10,
      brilliant: 0,
      great: 0,
      excellent: 0,
      good: 2,
      misses: 0,
      inaccuracies: 1,
      mistakes: 1,
      blunders: 2,
      missedTactics: 0,
      humanErrors: 0,
      averageCentipawnLoss: 10
    });
    expect(summarizeMoves([{ ...trapReviewMoves()[0], assessment: undefined }])).toMatchObject({
      totalMoves: 1,
      best: 0,
      averageCentipawnLoss: null
    });
  });

  it.each([
    ["book", "Book", "📖"],
    ["brilliant", "Brilliant", "!!"],
    ["great", "Great", "!"],
    ["excellent", "Excellent", "★"],
    ["good", "Good", "✓"],
    ["miss", "Miss", "✗"],
    ["inaccuracy", "Inaccuracy", "?!"],
    ["mistake", "Mistake", "?"],
    ["blunder", "Blunder", "??"]
  ] as const)("%s reads %s with glyph %s", (annotation, label, glyph) => {
    expect(annotationLabel(annotation)).toBe(label);
    expect(annotationGlyph(annotation)).toBe(glyph);
  });

  it("never gives Excellent the brilliant glyph", () => {
    expect(annotationGlyph("excellent")).not.toBe("!!");
  });

  it("reads severities and marks off moves", () => {
    expect(severityOf(null)).toBeNull();
    expect(annotationOf(undefined)).toBeNull();
  });
});
