import { describe, expect, it } from "vitest";
import type { MoveAssessment, MoveReview, RatingPrediction } from "../types/engine";
import {
  MOVE_ASSESSMENT_POLICY,
  SEVERITY_THRESHOLDS,
  annotationGlyph,
  annotationLabel,
  annotationOf,
  assessMove,
  assessMoves,
  assessmentReason,
  sacrificedMaterial,
  severityFor,
  severityForLoss,
  severityLabel,
  severityOf,
  summarizeMoves,
  verificationNeed,
  winPercent,
  withCurrentAssessments,
  type AssessableMove,
  type MoverEval
} from "./move-assessment";
import { applySan, START_FEN } from "./position";
import { parseLine, trapReviewMoves } from "./__fixtures__/trap-game";

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
/** Greek gift: Bxh7+ Kxh7 Ng5+ gives a bishop for a pawn. */
const GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8";
/** White's king on a1 is checked by the queen on b2; Kxb2 is the only legal move. */
const ONE_LEGAL_MOVE = "k7/8/8/8/8/8/1q6/K7 w - - 0 1";

const cp = (cp: number): MoverEval => ({ kind: "cp", cp });
const mate = (moverMates: boolean): MoverEval => ({ kind: "mate", moverMates });

/**
 * A move with its before-search lines (`[uci or pv, "cp 30" | "mate 2"]`, mover's view, best
 * first). The played move's own score comes from its line when it has one, else from `reply` (the
 * opponent's view of the position after it).
 */
function position(
  fen: string,
  playedSan: string,
  lines: readonly (readonly [string, string])[],
  extra: Partial<AssessableMove> & { reply?: string } = {}
): AssessableMove {
  const played = applySan(fen, playedSan);
  if (!played) throw new Error(`illegal ${playedSan}`);
  const { reply, ...rest } = extra;
  const topLines = lines.map(([pv, score], index) =>
    parseLine(`${score} pv ${pv}`, index + 1, fen)
  );
  return {
    ply: 30,
    fenBefore: fen,
    fenAfter: played.fen,
    playedMove: played.uci,
    bestMove: topLines[0]?.pv[0] ?? null,
    topLines,
    replyLines: reply ? [parseLine(reply, 1, played.fen)] : [],
    evalAfter: null,
    motifs: [],
    ...rest
  };
}

/** The same move with a deeper search that agrees with its lines. */
function verified(move: AssessableMove): AssessableMove {
  return { ...move, verification: { deeperLines: move.topLines } };
}

function previousWith(severity: MoveAssessment["severity"], winBefore = 50, move?: AssessableMove) {
  return {
    move: move ?? position(START_FEN, "e4", [["e2e4", "cp 0"]]),
    assessment: {
      policy: 1,
      winBefore,
      winAfter: 20,
      winLoss: 30,
      alternativeGap: null,
      severity,
      annotation: severity,
      tags: []
    }
  };
}

/** A previous move that ends in `fen`, so the context applies. */
function previousInto(fen: string, severity: MoveAssessment["severity"], winBefore = 50) {
  const context = previousWith(severity, winBefore);
  return { ...context, move: { ...context.move, fenAfter: fen } };
}

describe("winning chances (Lichess WinPercent)", () => {
  it.each([
    [0, 50],
    [100, 59.1],
    [-100, 40.9],
    [300, 75.1],
    [1000, 97.5],
    [5000, 97.5],
    [-5000, 2.5]
  ])("cp %i is %f%%", (score, expected) => {
    expect(winPercent(score)).toBeCloseTo(expected, 1);
  });

  it.each([
    [0, null],
    [4.99, null],
    [5, "inaccuracy"],
    [9.99, "inaccuracy"],
    [10, "mistake"],
    [14.99, "mistake"],
    [15, "blunder"],
    [60, "blunder"]
  ] as const)("a drop of %f points is %s", (loss, severity) => {
    expect(severityForLoss(loss)).toBe(severity);
  });

  it("uses Lichess's 0.1 / 0.2 / 0.3 thresholds on the [-1, 1] scale", () => {
    expect(SEVERITY_THRESHOLDS).toEqual({ inaccuracy: 5, mistake: 10, blunder: 15 });
  });
});

describe("severityFor", () => {
  it.each([
    ["no change", cp(50), cp(50), null, null],
    ["a small drop", cp(50), cp(20), null, null],
    ["an inaccuracy", cp(50), cp(-30), "inaccuracy", null],
    ["a mistake", cp(100), cp(-50), "mistake", null],
    ["a blunder", cp(100), cp(-150), "blunder", null],
    ["a gain (the opponent's error)", cp(-100), cp(200), null, null],
    ["drops inside a decided game", cp(1500), cp(1100), null, null],
    // Mate transitions (Lichess MateAdvice).
    ["a mate that only gets longer", mate(true), mate(true), null, null],
    ["a mate let slip, still +12", mate(true), cp(1200), "inaccuracy", "mate_lost"],
    ["a mate let slip at exactly +10", mate(true), cp(1000), "inaccuracy", "mate_lost"],
    ["a mate let slip at +9.99", mate(true), cp(999), "mistake", "mate_lost"],
    ["a mate let slip at +7.01", mate(true), cp(701), "mistake", "mate_lost"],
    ["a mate let slip at +7", mate(true), cp(700), "blunder", "mate_lost"],
    ["a mate turned into being mated", mate(true), mate(false), "blunder", "mate_lost"],
    ["a mate allowed from -10", cp(-1000), mate(false), "inaccuracy", "mate_created"],
    ["a mate allowed from -9.99", cp(-999), mate(false), "mistake", "mate_created"],
    ["a mate allowed from -7.01", cp(-701), mate(false), "mistake", "mate_created"],
    ["a mate allowed from -7", cp(-700), mate(false), "blunder", "mate_created"],
    ["a mate allowed from equality", cp(0), mate(false), "blunder", "mate_created"],
    ["a mate found", cp(300), mate(true), null, null],
    ["being mated anyway", mate(false), mate(false), null, null],
    ["being mated, then not", mate(false), cp(-500), null, null]
  ] as const)("%s", (_name, before, after, severity, mateTag) => {
    expect(severityFor(before, after)).toEqual({ severity, mateTag });
  });
});

describe("assessMove: errors", () => {
  const whiteBlunder = position(
    START_FEN,
    "f3",
    [
      ["e2e4", "cp 100"],
      ["d2d4", "cp 90"]
    ],
    { reply: "cp 150 pv e7e5" }
  );
  const blackBlunder = position(
    AFTER_E4,
    "f6",
    [
      ["c7c5", "cp 100"],
      ["e7e5", "cp 90"]
    ],
    { reply: "cp 150 pv d2d4" }
  );

  it.each([
    ["White", whiteBlunder],
    ["Black", blackBlunder]
  ])("judges a %s move from the mover's own point of view", (_side, move) => {
    expect(assessMove(move)).toMatchObject({
      policy: MOVE_ASSESSMENT_POLICY,
      winBefore: 59.1,
      winAfter: 36.5,
      winLoss: 22.6,
      severity: "blunder",
      annotation: "blunder"
    });
  });

  it("prefers the played move's own line from the same search over the reply search", () => {
    const move = position(
      START_FEN,
      "a3",
      [
        ["e2e4", "cp 40"],
        ["a2a3", "cp -70"]
      ],
      { reply: "cp 900 pv e7e5" }
    );
    expect(assessMove(move)).toMatchObject({
      severity: "mistake",
      winLoss: 10.1,
      alternativeGap: -10.1
    });
  });

  it("falls back to the stored White-perspective evaluation of older reviews", () => {
    const white = position(START_FEN, "f3", [["e2e4", "cp 100"]], {
      evalAfter: { type: "cp", value: -150 }
    });
    const black = position(AFTER_E4, "f6", [["c7c5", "cp 100"]], {
      evalAfter: { type: "cp", value: 150 }
    });
    expect(assessMove(white).severity).toBe("blunder");
    expect(assessMove(black).severity).toBe("blunder");
  });

  it("marks a stalemate that threw away a forced mate as a blunder", () => {
    const fen = "k7/8/8/1Q6/8/8/8/7K w - - 0 31";
    const move = position(fen, "Qb6", [["h1g2", "mate 9"]], { terminal: "stalemate" });
    expect(assessMove(move)).toMatchObject({
      severity: "blunder",
      annotation: "blunder",
      winAfter: 50
    });
    expect(assessMove(move).tags).toContain("mate_lost");
  });

  it("tells why: the better move had a tactic, or the error was the natural move", () => {
    const predictions: RatingPrediction[] = [
      { rating: 1500, topMoves: [{ uci: "f2f3", prob: 0.4 }], playedProb: 0.4 }
    ];
    const move = { ...whiteBlunder, motifs: ["fork"], humanPredictions: predictions };
    expect(assessMove(move, { playerRating: 1500 }).tags).toEqual(
      expect.arrayContaining(["missed_tactic", "natural_move"])
    );
    expect(assessMove(move, { trustMaia: false }).tags).not.toContain("natural_move");
  });

  it("leaves an inaccuracy unmarked when the game was already decided, but keeps its severity", () => {
    const winning = position(START_FEN, "a3", [
      ["e2e4", "cp 1000"],
      ["a2a3", "cp 650"]
    ]);
    expect(assessMove(winning)).toMatchObject({ severity: "inaccuracy", annotation: null });
    expect(assessMove(winning).tags).toContain("decided");
    const lost = position(START_FEN, "a3", [
      ["e2e4", "cp -620"],
      ["a2a3", "cp -1000"]
    ]);
    expect(assessMove(lost)).toMatchObject({ severity: "inaccuracy", annotation: null });
    // A mistake there still counts and shows.
    const mistake = position(START_FEN, "a3", [
      ["e2e4", "cp 1000"],
      ["a2a3", "cp 480"]
    ]);
    expect(assessMove(mistake)).toMatchObject({ severity: "mistake", annotation: "mistake" });
  });

  it.each([
    ["the opponent's blunder gave a clear edge", "blunder", 50, "cp 150", "miss"],
    ["the opponent's mistake gave a clear edge", "mistake", 50, "cp 150", "miss"],
    ["the opponent's error left only a small edge", "blunder", 50, "cp 40", "mistake"],
    ["the opponent's inaccuracy", "inaccuracy", 50, "cp 150", "mistake"],
    ["the opponent was already lost", "blunder", 5, "cp 150", "mistake"]
  ] as const)(
    "a mistake after %s is %s",
    (_name, previousSeverity, previousWinBefore, best, annotation) => {
      const move = position(AFTER_E4, "a6", [
        ["e7e5", best],
        ["a7a6", best === "cp 150" ? "cp 10" : "cp -90"]
      ]);
      const result = assessMove(move, {
        previous: previousInto(AFTER_E4, previousSeverity, previousWinBefore)
      });
      expect(result.severity).toBe("mistake");
      expect(result.annotation).toBe(annotation);
      expect(result.tags.includes("missed_chance")).toBe(annotation === "miss");
    }
  );

  it("ignores a previous move that doesn't lead into this position", () => {
    const move = position(AFTER_E4, "a6", [
      ["e7e5", "cp 150"],
      ["a7a6", "cp 10"]
    ]);
    const elsewhere = previousWith("blunder", 50, position(AFTER_E4, "e5", [["e7e5", "cp 0"]]));
    expect(assessMove(move, { previous: elsewhere }).annotation).toBe("mistake");
    expect(assessMove(move, { previous: previousInto(AFTER_E4, "blunder") }).annotation).toBe(
      "miss"
    );
  });

  it("gives no assessment without evaluations", () => {
    const empty = position(START_FEN, "e4", []);
    expect(assessMove(empty)).toMatchObject({
      winLoss: null,
      severity: null,
      annotation: null,
      tags: ["incomplete"]
    });
    expect(
      assessMove({
        ...position(START_FEN, "e4", [["e2e4", "cp 20"]]),
        topLines: [],
        replyLines: []
      }).tags
    ).toEqual(["incomplete"]);
  });
});

describe("assessMove: no praise for routine moves", () => {
  it("leaves the engine's top move unmarked when other moves were as good", () => {
    const move = verified(
      position(START_FEN, "e4", [
        ["e2e4", "cp 30"],
        ["d2d4", "cp 25"],
        ["g1f3", "cp 20"]
      ])
    );
    const result = assessMove(move);
    expect(result).toMatchObject({ severity: null, annotation: null });
    expect(result.tags).toContain("engine_top");
  });

  it("never praises the only legal move", () => {
    const move = verified(position(ONE_LEGAL_MOVE, "Kxb2", [["a1b2", "cp 0"]]));
    expect(assessMove(move)).toMatchObject({ annotation: null, tags: ["engine_top", "forced"] });
  });

  it("never praises a recapture, however critical", () => {
    const afterTake = "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";
    const capture = position(
      "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      "exd5",
      [["e4d5", "cp 30"]]
    );
    const recapture = verified(
      position(afterTake, "Qxd5", [
        ["d8d5", "cp 0"],
        ["g8f6", "cp -300"]
      ])
    );
    const result = assessMove(recapture, {
      previous: { move: capture, assessment: assessMove(capture) }
    });
    expect(result.annotation).toBeNull();
    expect(result.tags).toContain("recapture");
  });

  it.each([
    [8, "cp 10", null],
    [16, "cp 10", null],
    [17, "cp 10", "great"],
    [8, "cp 400", "great"]
  ] as const)(
    "at ply %i with %s, a critical find is %s (early balanced positions count as opening theory)",
    (ply, best, annotation) => {
      const move = verified(
        position(
          START_FEN,
          "e4",
          [
            ["e2e4", best],
            ["d2d4", "cp -600"]
          ],
          { ply }
        )
      );
      expect(assessMove(move).annotation).toBe(annotation);
      expect(assessMove(move).tags.includes("opening")).toBe(annotation === null);
    }
  );

  it("does not praise converting a decided game", () => {
    const move = verified(
      position(START_FEN, "e4", [
        ["e2e4", "cp 700"],
        ["d2d4", "cp 0"]
      ])
    );
    expect(assessMove(move).annotation).toBeNull();
    expect(assessMove(move).tags).toContain("decided");
  });
});

describe("assessMove: critical finds (Great)", () => {
  const white = position(START_FEN, "e4", [
    ["e2e4", "cp 150"],
    ["d2d4", "cp -50"],
    ["g1f3", "cp -80"]
  ]);
  const black = position(AFTER_E4, "e5", [
    ["e7e5", "cp 150"],
    ["c7c5", "cp -50"],
    ["e7e6", "cp -80"]
  ]);

  it.each([
    ["White", white],
    ["Black", black]
  ])("marks a %s only move Great once a deeper search agrees", (_side, move) => {
    expect(assessMove(verified(move))).toMatchObject({ annotation: "great", alternativeGap: 18.1 });
    expect(assessMove(verified(move)).tags).toContain("only_move");
  });

  it("abstains without a deeper search, or when the deeper search disagrees", () => {
    expect(assessMove(white).annotation).toBeNull();
    expect(assessMove(white).tags).toContain("unverified");
    const disagreeing = {
      ...white,
      verification: { deeperLines: black.topLines.map((line) => ({ ...line, pv: ["d2d4"] })) }
    };
    const reordered = {
      ...white,
      verification: {
        deeperLines: [
          parseLine("cp 150 pv d2d4", 1, START_FEN),
          parseLine("cp 140 pv e2e4", 2, START_FEN)
        ]
      }
    };
    expect(assessMove(disagreeing).annotation).toBeNull();
    expect(assessMove(reordered).annotation).toBeNull();
    expect(assessMove(reordered).tags).toContain("unstable");
  });

  it.each([
    ["the next best is 9.9 points worse", "cp -58", null],
    ["the next best is 10.1 points worse", "cp -60", "great"]
  ] as const)("needs every other candidate a Mistake worse: %s", (_name, second, annotation) => {
    const move = verified(
      position(START_FEN, "e4", [
        ["e2e4", "cp 50"],
        ["d2d4", second]
      ])
    );
    expect(assessMove(move).annotation).toBe(annotation);
  });

  it("needs the played move to keep a fighting game", () => {
    const lost = verified(
      position(START_FEN, "e4", [
        ["e2e4", "cp -250"],
        ["d2d4", "cp -700"]
      ])
    );
    expect(assessMove(lost).annotation).toBeNull();
    const holding = verified(
      position(START_FEN, "e4", [
        ["e2e4", "cp -200"],
        ["d2d4", "cp -700"]
      ])
    );
    expect(assessMove(holding).annotation).toBe("great");
  });

  it("does not call the most natural move at the player's level a find", () => {
    const natural: RatingPrediction[] = [
      { rating: 1500, topMoves: [{ uci: "e2e4", prob: 0.7 }], playedProb: 0.7 }
    ];
    expect(
      assessMove({ ...verified(white), humanPredictions: natural }, { playerRating: 1500 })
        .annotation
    ).toBeNull();
    expect(
      assessMove({ ...verified(white), humanPredictions: natural }, { trustMaia: false }).annotation
    ).toBe("great");
  });
});

describe("assessMove: sacrifices (Brilliant)", () => {
  const sound = position(GREEK_GIFT, "Bxh7+", [
    ["d3h7 g8h7 f3g5", "cp 250"],
    ["e1g1 c7c5", "cp 60"]
  ]);

  it("marks a sound sacrifice Brilliant once a deeper search agrees", () => {
    expect(assessMove(verified(sound))).toMatchObject({ annotation: "brilliant" });
    expect(assessMove(verified(sound)).tags).toContain("sacrifice");
    expect(assessMove(sound).annotation).toBeNull();
  });

  it("never marks an unsound sacrifice", () => {
    const unsound = position(GREEK_GIFT, "Bxh7+", [
      ["e1g1 c7c5", "cp 60"],
      ["d3h7 g8h7 f3g5", "cp -150"]
    ]);
    expect(assessMove(verified(unsound))).toMatchObject({
      severity: "blunder",
      annotation: "blunder"
    });
    const dubious = position(GREEK_GIFT, "Bxh7+", [
      ["d3h7 g8h7 f3g5", "cp -40"],
      ["e1g1 c7c5", "cp -45"]
    ]);
    expect(assessMove(verified(dubious)).annotation).toBeNull();
  });

  it.each([
    ["a bishop for a pawn, not won back", "d3h7 g8h7 f3g5", 2],
    ["a trade", "d3h7 f8h8", 0],
    ["a line too short to tell", "d3h7 g8h7", 0],
    ["a line that doesn't fit", "d3h7 a1a8 f3g5", 0],
    ["no capture at all", "e1g1 c7c5 d1e2", 0]
  ] as const)("sacrificedMaterial: %s", (_name, line, expected) => {
    expect(sacrificedMaterial(GREEK_GIFT, line.split(" "))).toBe(expected);
  });

  it("counts a sacrifice won straight back as none", () => {
    // 1. e4 e5 2. Nf3 Nc6 3. Nxe5 Nxe5 4. d4: the knight is gone, and d4 doesn't win it back.
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    expect(sacrificedMaterial(fen, ["f3e5", "c6e5", "d2d4"])).toBe(2);
    expect(sacrificedMaterial("8/8/8/8/8/2k5/1p6/K1R5 w - - 0 1", ["c1c3", "b2b1q", "a1b1"])).toBe(
      0
    );
    expect(sacrificedMaterial("not a fen", ["e2e4", "e7e5", "g1f3"])).toBe(0);
  });
});

describe("assessMove: other praise", () => {
  const punish = position(AFTER_E4, "e5", [
    ["e7e5", "cp 300"],
    ["c7c5", "cp 200"]
  ]);

  it("marks punishing the opponent's mistake Good, but only when the choice mattered", () => {
    expect(assessMove(punish, { previous: previousInto(AFTER_E4, "blunder") })).toMatchObject({
      annotation: "good"
    });
    expect(assessMove(punish, { previous: previousInto(AFTER_E4, "blunder") }).tags).toContain(
      "punishes_error"
    );
    expect(
      assessMove(punish, { previous: previousInto(AFTER_E4, "inaccuracy") }).annotation
    ).toBeNull();
    const anyMove = position(AFTER_E4, "e5", [
      ["e7e5", "cp 300"],
      ["c7c5", "cp 290"]
    ]);
    expect(
      assessMove(anyMove, { previous: previousInto(AFTER_E4, "blunder") }).annotation
    ).toBeNull();
    // Taking what was left loose counts too, even in a game the error decided.
    const capture = {
      ...anyMove,
      topLines: anyMove.topLines.map((line) => ({
        ...line,
        score: { type: "cp" as const, value: 900 }
      })),
      motifs: ["hanging"]
    };
    expect(assessMove(capture, { previous: previousInto(AFTER_E4, "blunder") })).toMatchObject({
      annotation: "good"
    });
    expect(assessMove(capture, { previous: previousInto(AFTER_E4, "blunder") }).tags).toContain(
      "decided"
    );
  });

  it("marks a found tactic or a hard-to-find move Excellent when the alternatives were clearly worse", () => {
    const base = position(START_FEN, "e4", [
      ["e2e4", "cp 100"],
      ["d2d4", "cp 20"]
    ]);
    expect(assessMove({ ...base, motifs: ["fork"] })).toMatchObject({
      annotation: "excellent",
      tags: ["engine_top", "tactic"]
    });
    expect(assessMove({ ...base, motifs: ["hanging"] }).annotation).toBeNull();
    const hard: RatingPrediction[] = [
      { rating: 1500, topMoves: [{ uci: "d2d4", prob: 0.6 }], playedProb: 0.04 }
    ];
    expect(assessMove({ ...base, humanPredictions: hard }, { playerRating: 1500 }).annotation).toBe(
      "excellent"
    );
    expect(
      assessMove({ ...base, humanPredictions: hard }, { trustMaia: false }).annotation
    ).toBeNull();
    const easy: RatingPrediction[] = [
      { rating: 1500, topMoves: [{ uci: "e2e4", prob: 0.3 }], playedProb: 0.3 }
    ];
    expect(
      assessMove({ ...base, humanPredictions: easy }, { playerRating: 1500 }).annotation
    ).toBeNull();
    const close = position(
      START_FEN,
      "e4",
      [
        ["e2e4", "cp 100"],
        ["d2d4", "cp 90"]
      ],
      { motifs: ["fork"] }
    );
    expect(assessMove(close).annotation).toBeNull();
  });

  it("reads the Maia level nearest the player's rating", () => {
    const base = position(START_FEN, "e4", [
      ["e2e4", "cp 100"],
      ["d2d4", "cp 20"]
    ]);
    const levels: RatingPrediction[] = [
      { rating: 1100, topMoves: [{ uci: "d2d4", prob: 0.5 }], playedProb: 0.02 },
      { rating: 1900, topMoves: [{ uci: "e2e4", prob: 0.5 }], playedProb: 0.5 }
    ];
    expect(
      assessMove({ ...base, humanPredictions: levels }, { playerRating: 1200 }).annotation
    ).toBe("excellent");
    expect(
      assessMove({ ...base, humanPredictions: levels }, { playerRating: 1800 }).annotation
    ).toBeNull();
    expect(assessMove({ ...base, humanPredictions: levels }).annotation).toBe("excellent");
  });
});

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
    expect(verificationNeed(position(GREEK_GIFT, "Bxh7+", [["d3h7 g8h7 f3g5", "cp 250"]]))).toBe(
      "candidate"
    );
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

describe("the trap game (regression)", () => {
  it("marks only the moves that matter, as the live review does", () => {
    const moves = trapReviewMoves().map((move, index) =>
      index === 7 ? { ...move, verification: { deeperLines: move.topLines } } : move
    );
    const assessments = assessMoves(moves);
    expect(moves.map((move, index) => [move.san, assessments[index]?.annotation])).toEqual([
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
    expect(review.moves.map((move) => annotationOf(move))).toEqual([
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
    expect(review.moves[7]?.assessment?.tags).toEqual(
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

  it("leaves a review on the current policy as it is", () => {
    const current = withCurrentAssessments(storedReview());
    const again = { ...current, assessmentsRecomputed: undefined };
    expect(withCurrentAssessments(again)).toBe(again);
  });

  it("re-assesses one with any move from another policy", () => {
    const current = withCurrentAssessments(storedReview());
    const mixed = {
      ...current,
      moves: current.moves.map((move, index) =>
        index === 0 && move.assessment
          ? { ...move, assessment: { ...move.assessment, policy: 0 } }
          : move
      )
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
        { ...trapReviewMoves()[0]!, nodeId: "extra", evalLoss: null }
      ]
    });
    expect(review.summary).toEqual({
      totalMoves: 15,
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
    expect(summarizeMoves([{ ...trapReviewMoves()[0]!, assessment: undefined }])).toMatchObject({
      totalMoves: 1,
      best: 0,
      averageCentipawnLoss: null
    });
  });

  it.each([
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

  it("labels severities and reads them off moves", () => {
    expect(
      ["inaccuracy", "mistake", "blunder"].map((item) => severityLabel(item as "mistake"))
    ).toEqual(["Inaccuracy", "Mistake", "Blunder"]);
    expect(severityOf(null)).toBeNull();
    expect(annotationOf(undefined)).toBeNull();
  });

  const assessment = (overrides: Partial<MoveAssessment>): MoveAssessment => ({
    policy: 1,
    winBefore: 60,
    winAfter: 40,
    winLoss: 20.4,
    alternativeGap: 12.6,
    severity: null,
    annotation: null,
    tags: [],
    ...overrides
  });

  it.each([
    [assessment({ annotation: "brilliant" }), /sound sacrifice/],
    [assessment({ annotation: "great" }), /at least 13% worse/],
    [assessment({ annotation: "great", alternativeGap: null }), /at least 10% worse/],
    [assessment({ annotation: "excellent", tags: ["tactic"] }), /Finds the tactic/],
    [assessment({ annotation: "excellent", tags: ["hard_to_find"] }), /hard to find/],
    [assessment({ annotation: "good" }), /Punishes/],
    [assessment({ annotation: "miss", severity: "blunder" }), /cost 20% of the winning chances/],
    [assessment({ annotation: "blunder", severity: "blunder", winLoss: 0.4 }), /cost <1%/],
    [
      assessment({ annotation: "mistake", severity: "mistake", tags: ["mate_created"] }),
      /Allows a forced mate/
    ],
    [
      assessment({ annotation: "blunder", severity: "blunder", tags: ["mate_lost"] }),
      /Lets a forced mate slip/
    ],
    [assessment({ annotation: "inaccuracy", severity: "inaccuracy", winLoss: null }), /cost <1%/],
    [assessment({ severity: "inaccuracy", tags: ["decided"] }), /already decided/]
  ])("explains %o", (item, reason) => {
    expect(assessmentReason(item)).toMatch(reason);
  });

  it("explains nothing for an unmarked move", () => {
    expect(assessmentReason(assessment({ tags: ["engine_top"] }))).toBeNull();
    expect(assessmentReason(undefined)).toBeNull();
  });
});
