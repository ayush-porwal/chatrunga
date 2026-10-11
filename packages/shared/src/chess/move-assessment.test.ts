import { describe, expect, it } from "vitest";
import type { RatingPrediction } from "../types/engine";
import {
  MOVE_ASSESSMENT_POLICY,
  assessMove,
  sacrificedMaterial,
  severityFor,
  severityForLoss,
  verificationNeed,
  winPercent
} from "./move-assessment";
import { START_FEN } from "./position";
import { parseLine } from "./__fixtures__/trap-game";
import {
  AFTER_E4,
  GREEK_GIFT,
  ONE_LEGAL_MOVE,
  ONLY_PROMOTION,
  ROYAL_FORK,
  PINNED_KNIGHT,
  TRAPPED_BISHOP,
  QUEEN_ATTACKED,
  cp,
  mate,
  position,
  verified,
  previousWith,
  previousInto
} from "./__fixtures__/assessable-moves";

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
});

describe("severityFor", () => {
  type SeverityResult = ReturnType<typeof severityFor>;
  const outcome = (
    severity: SeverityResult["severity"],
    mateTag: SeverityResult["mateTag"] = null
  ): SeverityResult => ({ severity, mateTag });
  it.each([
    ["no change", cp(50), cp(50), outcome(null)],
    ["a small drop", cp(50), cp(20), outcome(null)],
    ["an inaccuracy", cp(50), cp(-30), outcome("inaccuracy")],
    ["a mistake", cp(100), cp(-50), outcome("mistake")],
    ["a blunder", cp(100), cp(-150), outcome("blunder")],
    ["a gain (the opponent's error)", cp(-100), cp(200), outcome(null)],
    ["drops inside a decided game", cp(1500), cp(1100), outcome(null)],
    // Mate transitions (Lichess MateAdvice).
    ["a mate that only gets longer", mate(true), mate(true), outcome(null)],
    ["a mate let slip, still +12", mate(true), cp(1200), outcome("inaccuracy", "mate_lost")],
    ["a mate let slip at exactly +10", mate(true), cp(1000), outcome("inaccuracy", "mate_lost")],
    ["a mate let slip at +9.99", mate(true), cp(999), outcome("mistake", "mate_lost")],
    ["a mate let slip at +7.01", mate(true), cp(701), outcome("mistake", "mate_lost")],
    ["a mate let slip at +7", mate(true), cp(700), outcome("blunder", "mate_lost")],
    ["a mate turned into being mated", mate(true), mate(false), outcome("blunder", "mate_lost")],
    ["a mate allowed from -10", cp(-1000), mate(false), outcome("inaccuracy", "mate_created")],
    ["a mate allowed from -9.99", cp(-999), mate(false), outcome("mistake", "mate_created")],
    ["a mate allowed from -7.01", cp(-701), mate(false), outcome("mistake", "mate_created")],
    ["a mate allowed from -7", cp(-700), mate(false), outcome("blunder", "mate_created")],
    ["a mate allowed from equality", cp(0), mate(false), outcome("blunder", "mate_created")],
    ["a mate found", cp(300), mate(true), outcome(null)],
    ["being mated anyway", mate(false), mate(false), outcome(null)],
    ["being mated, then not", mate(false), cp(-500), outcome(null)]
  ] as const)("%s", (_name, before, after, expected) => {
    expect(severityFor(before, after)).toStrictEqual(expected);
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
    expect(assessMove(move, { playerRating: 1500 }).tags).toStrictEqual(
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

  // 1... a6 after 1. e4, where 1... e5 keeps a clear edge (or only a small one).
  const clearEdgeThrownAway = [
    ["e7e5", "cp 150"],
    ["a7a6", "cp 10"]
  ] as const;
  const smallEdgeThrownAway = [
    ["e7e5", "cp 40"],
    ["a7a6", "cp -90"]
  ] as const;
  it.each([
    [
      "the opponent's blunder gave a clear edge",
      "miss",
      previousInto(AFTER_E4, "blunder"),
      clearEdgeThrownAway
    ],
    [
      "the opponent's mistake gave a clear edge",
      "miss",
      previousInto(AFTER_E4, "mistake"),
      clearEdgeThrownAway
    ],
    [
      "the opponent's error left only a small edge",
      "mistake",
      previousInto(AFTER_E4, "blunder"),
      smallEdgeThrownAway
    ],
    [
      "the opponent's inaccuracy",
      "mistake",
      previousInto(AFTER_E4, "inaccuracy"),
      clearEdgeThrownAway
    ],
    [
      "the opponent was already lost",
      "mistake",
      previousInto(AFTER_E4, "blunder", 5),
      clearEdgeThrownAway
    ]
  ] as const)("a mistake after %s is a %s", (_name, annotation, previous, lines) => {
    const result = assessMove(position(AFTER_E4, "a6", lines), { previous });
    expect(result.severity).toBe("mistake");
    expect(result.annotation).toBe(annotation);
    expect(result.tags.includes("missed_chance")).toBe(annotation === "miss");
  });

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
    ).toStrictEqual(["incomplete"]);
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

  it("counts each promotion piece as its own move, so an underpromotion can still be the find", () => {
    const move = verified(
      position(ONLY_PROMOTION, "a8=R", [
        ["a7a8r", "cp 50"],
        ["a7a8q", "cp -150"]
      ])
    );
    expect(assessMove(move).tags).not.toContain("forced");
    expect(assessMove(move).annotation).toBe("great");
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

  it.each([2, 8, 16])(
    "praises a critical find at ply %i of a balanced game: only the opening book rules early moves out",
    (ply) => {
      const move = verified(
        position(
          START_FEN,
          "e4",
          [
            ["e2e4", "cp 10"],
            ["d2d4", "cp -600"]
          ],
          { ply }
        )
      );
      expect(assessMove(move).annotation).toBe("great");
      expect(assessMove(move, { book: true }).annotation).toBe("book");
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

  it("records the gap the deeper search found, not the first search's", () => {
    const deeper = {
      ...white,
      verification: {
        deeperLines: [
          parseLine("cp 150 pv e2e4", 1, START_FEN),
          parseLine("cp -150 pv d2d4", 2, START_FEN)
        ]
      }
    };
    expect(assessMove(deeper)).toMatchObject({ annotation: "great", alternativeGap: 26.9 });
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

  describe("a move that only keeps material the others lose", () => {
    const rescue = verified(
      position(QUEEN_ATTACKED, "Qe3", [
        ["d4e3 h7h6 h2h3", "cp 50"],
        ["g1h1 c5d4 h2h3", "cp -800"]
      ])
    );

    it("is not Great without Maia evidence (or with only an older review's)", () => {
      expect(assessMove(rescue).annotation).toBeNull();
      expect(assessMove(rescue).tags).toContain("saves_material");
      const unusual: RatingPrediction[] = [
        { rating: 1500, topMoves: [{ uci: "g1h1", prob: 0.4 }], playedProb: 0.05 }
      ];
      expect(
        assessMove({ ...rescue, humanPredictions: unusual }, { trustMaia: false }).annotation
      ).toBeNull();
      // Nor does it cost a deeper search.
      expect(verificationNeed(rescue)).toBeNull();
    });

    it("is Great when Maia says it was not the natural move, or when it is itself a tactic", () => {
      const unusual: RatingPrediction[] = [
        { rating: 1500, topMoves: [{ uci: "g1h1", prob: 0.4 }], playedProb: 0.05 }
      ];
      expect(
        assessMove({ ...rescue, humanPredictions: unusual }, { playerRating: 1500 }).annotation
      ).toBe("great");
      expect(
        verificationNeed({ ...rescue, humanPredictions: unusual }, { playerRating: 1500 })
      ).toBe("candidate");
      expect(assessMove({ ...rescue, motifs: ["fork"] }).annotation).toBe("great");
      const natural: RatingPrediction[] = [
        { rating: 1500, topMoves: [{ uci: "d4e3", prob: 0.8 }], playedProb: 0.8 }
      ];
      expect(
        assessMove({ ...rescue, humanPredictions: natural }, { playerRating: 1500 }).annotation
      ).toBeNull();
    });
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

  const castle = ["e1g1", "c7c5"];
  it.each([
    ["a bishop for a pawn, not won back", "d3h7 g8h7 f3g5", [castle], 2],
    ["a trade", "d3h7 f8h8", [castle], 0],
    ["a line too short to tell", "d3h7 g8h7", [castle], 0],
    ["a line that doesn't fit", "d3h7 a1a8 f3g5", [castle], 0],
    ["no capture at all", "e1g1 c7c5 d1e2", [["d3h7", "g8h7", "f3g5"]], 0],
    ["no other candidate to compare", "d3h7 g8h7 f3g5", [], 0],
    ["the other candidate loses as much", "d3h7 g8h7 f3g5", [["d3h7", "g8h7", "d1d3"]], 0]
  ] as const)("sacrificedMaterial: %s", (_name, line, alternatives, expected) => {
    expect(sacrificedMaterial(GREEK_GIFT, line.split(" "), alternatives)).toBe(expected);
  });

  it("compares only other candidates whose line shows the reply", () => {
    // 1. e4 d5 2. d4 dxe4 3. Nc3 gives a pawn; exd5 alone shows the pawn it takes, not Qxd5.
    const scandinavian = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const gambit = ["d2d4", "d5e4", "b1c3"];
    expect(sacrificedMaterial(scandinavian, gambit, [["e4d5"]])).toBe(0);
    expect(sacrificedMaterial(scandinavian, gambit, [["e4d5"], ["e4d5", "d8d5"]])).toBe(1);
  });

  it("counts a sacrifice won straight back as none", () => {
    // 1. e4 e5 2. Nf3 Nc6 3. Nxe5 Nxe5 4. d4: the knight is gone, and d4 doesn't win it back.
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    expect(sacrificedMaterial(fen, ["f3e5", "c6e5", "d2d4"], [["d2d3", "f8c5"]])).toBe(2);
    expect(
      sacrificedMaterial("8/8/8/8/8/2k5/1p6/K1R5 w - - 0 1", ["c1c3", "b2b1q", "a1b1"], [["c1c2"]])
    ).toBe(0);
    expect(sacrificedMaterial("not a fen", ["e2e4", "e7e5", "g1f3"], [["d2d4"]])).toBe(0);
  });

  // Material every candidate loses is a forced loss, never a sacrifice.
  it.each([
    [
      "a royal fork (every king move loses the queen to Nxc3)",
      ROYAL_FORK,
      "Kf1",
      [
        ["g1f1 e2c3 b2c3 g8f8", "cp 480"],
        ["g1h1 e2c3 b2c3 g8f8", "cp 470"]
      ]
    ],
    [
      "a pinned knight (dxc3 wins it whatever White plays)",
      PINNED_KNIGHT,
      "h4",
      [
        ["h2h4 d4c3 b2c3", "cp 300"],
        ["e1g1 d4c3 b2c3", "cp 290"],
        ["a2a3 d4c3 b2c3", "cp 280"]
      ]
    ],
    [
      "a trapped bishop (lost to the rook, or for a pawn on b6)",
      TRAPPED_BISHOP,
      "h3",
      [
        ["h2h3 a8a7 h3h4", "cp 200"],
        ["a7b6 c7b6 h2h3", "cp 190"],
        ["a7b8 a8b8 h2h3", "cp 120"]
      ]
    ]
  ] as const)("is not Brilliant: %s", (_name, fen, san, lines) => {
    const move = verified(position(fen, san, lines));
    const assessment = assessMove(move);
    expect(assessment.annotation).not.toBe("brilliant");
    expect(assessment.tags).not.toContain("sacrifice");
    const played = move.topLines[0];
    // Less than the exchange (the bishop for b6's pawn was the least loss on offer).
    expect(
      sacrificedMaterial(
        fen,
        played.pv,
        move.topLines.slice(1).map((line) => line.pv)
      )
    ).toBeLessThan(2);
  });

  it("still counts giving up a piece another candidate keeps", () => {
    // a3 would win the pinning bishop back after dxc3; h4 lets the knight go for a pawn.
    const lines = [
      ["h2h4 d4c3 b2c3", "cp 300"],
      ["a2a3 d4c3 a3b4", "cp 290"]
    ] as const;
    expect(
      sacrificedMaterial(PINNED_KNIGHT, lines[0][0].split(" "), [lines[1][0].split(" ")])
    ).toBe(2);
    expect(assessMove(verified(position(PINNED_KNIGHT, "h4", lines))).annotation).toBe("brilliant");
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
