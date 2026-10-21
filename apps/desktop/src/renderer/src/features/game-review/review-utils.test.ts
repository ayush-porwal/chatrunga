import { describe, expect, it } from "vitest";
import { applySan, statusForFen } from "@chaturanga/shared/chess/position";
import { reviewInsightPayloadSchema } from "@chaturanga/shared/schemas";
import { validateProse } from "@chaturanga/shared/llm/commentary";
import { MAIA3_RATINGS } from "@chaturanga/shared/engine/maia3";
import type {
  AnalysisLine,
  EngineScore,
  ErrorSeverity,
  MoveAnnotation,
  MoveAssessment,
  MoveReview,
  RatingPrediction
} from "@chaturanga/shared/types/engine";
import {
  buildInsightPayload,
  buildRatingCurveForMove,
  countBySeverity,
  hasUsableMaiaData,
  mainlineReviewInput,
  numberedLine,
  uciLineSteps
} from "./review-utils";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const cp = (value: number): EngineScore => ({ type: "cp", value });

type PlySpec = {
  san: string;
  evalBefore: EngineScore;
  evalAfter: EngineScore;
  severity?: ErrorSeverity;
  annotation?: MoveAnnotation;
  evalLoss: number;
  best: string[];
  topLines?: { pv: string[]; scoreWhite: EngineScore }[];
  clockRemainingMs?: number;
};

/** An assessment with the given verdict (the coach payload reads only these fields' meaning). */
function assessed(
  severity: ErrorSeverity | null,
  annotation: MoveAnnotation | null
): MoveAssessment {
  return {
    policy: 1,
    winBefore: 50,
    winAfter: 50,
    winLoss: 0,
    alternativeGap: null,
    severity,
    annotation,
    tags: []
  };
}

/** Plays SAN moves from the start position and attaches engine data to each ply. */
function buildGame(plies: PlySpec[]): MoveReview[] {
  let fen = START_FEN;
  return plies.map((spec, index) => {
    const played = applySan(fen, spec.san);
    if (!played) throw new Error(`illegal ${spec.san} in ${fen}`);
    const turn = statusForFen(fen).turn;
    const topLines: AnalysisLine[] = (spec.topLines ?? []).map((line, lineIndex) => ({
      multipv: lineIndex + 1,
      depth: 18,
      scoreWhite: line.scoreWhite,
      score:
        turn === "white" ? line.scoreWhite : { ...line.scoreWhite, value: -line.scoreWhite.value },
      pv: line.pv
    }));
    const move: MoveReview = {
      nodeId: `n${index + 1}`,
      ply: index + 1,
      san: played.san,
      playedMove: played.uci,
      fenBefore: fen,
      fenAfter: played.fen,
      evalBefore: spec.evalBefore,
      evalAfter: spec.evalAfter,
      bestEvalAfter: spec.evalBefore,
      evalLoss: spec.evalLoss,
      assessment: assessed(spec.severity ?? null, spec.annotation ?? null),
      bestMove: spec.best[0] ?? null,
      bestLine: spec.best,
      topLines,
      motifs: [],
      clockRemainingMs: spec.clockRemainingMs
    };
    fen = played.fen;
    return move;
  });
}

/** 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5? Qg5 — the Blackburne Shilling trap. */
function trapGame(): MoveReview[] {
  const ok = { evalLoss: 5 };
  return buildGame([
    {
      san: "e4",
      evalBefore: cp(20),
      evalAfter: cp(30),
      best: ["e2e4", "e7e5"],
      clockRemainingMs: 300_000,
      ...ok
    },
    {
      san: "e5",
      evalBefore: cp(30),
      evalAfter: cp(30),
      best: ["e7e5", "g1f3"],
      clockRemainingMs: 300_000,
      ...ok
    },
    {
      san: "Nf3",
      evalBefore: cp(30),
      evalAfter: cp(30),
      best: ["g1f3", "b8c6"],
      clockRemainingMs: 297_000,
      ...ok
    },
    {
      san: "Nc6",
      evalBefore: cp(30),
      evalAfter: cp(30),
      best: ["b8c6", "f1b5"],
      clockRemainingMs: 296_000,
      ...ok
    },
    {
      san: "Bc4",
      evalBefore: cp(30),
      evalAfter: cp(25),
      best: ["f1b5", "a7a6"],
      clockRemainingMs: 290_000,
      ...ok
    },
    {
      san: "Nd4",
      evalBefore: cp(25),
      evalAfter: cp(90),
      best: ["g8f6", "d2d3"],
      severity: "inaccuracy",
      annotation: "inaccuracy",
      evalLoss: 65,
      clockRemainingMs: 280_000
    },
    {
      san: "Nxe5",
      evalBefore: cp(90),
      evalAfter: cp(-180),
      best: ["f3d4", "e5d4", "c2c3"],
      topLines: [
        { pv: ["f3d4", "e5d4", "c2c3", "d4c3"], scoreWhite: cp(90) },
        { pv: ["e1g1", "g8f6", "f3d4"], scoreWhite: cp(60) },
        { pv: ["c2c3", "d4f3", "d1f3"], scoreWhite: cp(50) }
      ],
      severity: "mistake",
      annotation: "mistake",
      evalLoss: 270,
      clockRemainingMs: 284_000
    },
    {
      san: "Qg5",
      evalBefore: cp(-180),
      evalAfter: cp(-190),
      best: ["d8g5", "e5f7", "g5g2", "h1f1", "g2e4", "c4e2", "d4f3"],
      clockRemainingMs: 275_000,
      ...ok
    },
    {
      san: "Nxf7",
      evalBefore: cp(-190),
      evalAfter: cp(-600),
      best: ["c4f7", "e8e7"],
      severity: "blunder",
      annotation: "blunder",
      evalLoss: 400
    }
  ]);
}

function move(overrides: Partial<MoveReview> = {}): MoveReview {
  return {
    nodeId: "n1",
    ply: 1,
    san: "e4",
    playedMove: "e2e4",
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    evalBefore: { type: "cp", value: 20 },
    evalAfter: { type: "cp", value: 15 },
    bestEvalAfter: { type: "cp", value: 25 },
    evalLoss: 10,
    bestMove: "e2e4",
    bestLine: ["e2e4", "e7e5"],
    topLines: [],
    motifs: [],
    ...overrides
  };
}

describe("game review utilities", () => {
  it("converts engine UCI into SAN before building the coach payload", () => {
    const payload = buildInsightPayload(move(), { userRating: 1500 });
    expect(payload?.engines.stockfish.bestMoveSan).toBe("e4");
    expect(payload?.engines.stockfish.bestLineSan).toStrictEqual(["e4", "e5"]);
    // An ordinary engine match carries no mark, and the coach is told so.
    expect(payload?.annotation).toBeNull();
    expect(payload?.severity).toBeUndefined();
  });

  it("tells the coach a verified find was one, and an error what it cost", () => {
    const great = buildInsightPayload(move({ assessment: assessed(null, "great") }), {
      userRating: 1500
    });
    expect(great).toMatchObject({ annotation: "great", curatorReason: "difficult_find" });
    const good = buildInsightPayload(move({ assessment: assessed(null, "good") }), {
      userRating: 1500
    });
    expect(good).toMatchObject({ annotation: "good", curatorReason: "move_review" });
    // An inaccuracy left unmarked (a decided game) is still explained as an error.
    const unmarked = buildInsightPayload(
      move({ assessment: { ...assessed("inaccuracy", null), tags: ["decided"] } }),
      { userRating: 1500 }
    );
    expect(unmarked).toMatchObject({
      annotation: null,
      severity: "inaccuracy",
      curatorReason: "mistake",
      assessmentTags: ["decided"]
    });
    expect(() => reviewInsightPayloadSchema.parse(unmarked)).not.toThrow();
  });

  it("counts errors by severity, marked or not", () => {
    const moves = trapGame();
    expect(countBySeverity(moves)).toStrictEqual({ inaccuracy: 1, mistake: 1, blunder: 1 });
    expect(
      countBySeverity([
        move({ assessment: { ...assessed("inaccuracy", null), tags: ["decided"] } }),
        move()
      ])
    ).toStrictEqual({
      inaccuracy: 1,
      mistake: 0,
      blunder: 0
    });
  });

  it("uses a neutral review reason when no Maia data is available", () => {
    const payload = buildInsightPayload(move({ humanPredictions: undefined }), {
      userRating: 1500
    });
    expect(payload?.curatorReason).toBe("move_review");
    expect(payload?.engines.maia).toBeUndefined();
    expect(payload?.engines.maiaCurve).toBeUndefined();
  });

  it("adds history, alternatives, the reply line and game context for a mid-game mistake", () => {
    const moves = trapGame();
    const mistake = moves[6];
    const payload = buildInsightPayload(mistake, {
      userRating: 1500,
      commentaryDetail: "detailed",
      playerColor: "white",
      context: {
        moves,
        headers: {
          white: "Alice",
          black: "Bob",
          event: "Club game",
          eco: "C50",
          opening: "Italian Game",
          timeControl: "300+2",
          result: null
        }
      }
    });
    expect(payload).not.toBeNull();
    expect(() => reviewInsightPayloadSchema.parse(payload)).not.toThrow();
    const stockfish = payload!.engines.stockfish;
    expect(payload!.game).toMatchObject({
      moveNumberSan: "4.",
      san: "Nxe5",
      mover: "white",
      phase: "opening"
    });
    expect(stockfish.evalPerspective).toBe("white");
    expect(stockfish.assessment).toStrictEqual({
      before: "white_slightly_better",
      after: "black_clearly_better",
      afterBest: "white_slightly_better"
    });
    expect(stockfish.alternatives?.map((item) => item.san)).toStrictEqual(["Nxd4", "O-O", "c3"]);
    expect(stockfish.alternatives?.[0]).toMatchObject({
      rank: 1,
      eval: "+0.90",
      lineSan: ["Nxd4", "exd4", "c3", "dxc3"]
    });
    expect(stockfish.playedMoveRank).toBeUndefined();
    expect(stockfish.replyLineSan).toStrictEqual([
      "Qg5",
      "Nxf7",
      "Qxg2",
      "Rf1",
      "Qxe4+",
      "Be2",
      "Nf3#"
    ]);
    expect(payload!.context?.recentMoves?.map((item) => item.san)).toStrictEqual([
      "e4",
      "e5",
      "Nf3",
      "Nc6",
      "Bc4",
      "Nd4"
    ]);
    expect(payload!.context?.recentMoves?.at(-1)).toMatchObject({
      moveNumberSan: "3...",
      mover: "black",
      annotation: "inaccuracy",
      evalAfter: "+0.90"
    });
    expect(payload!.context?.mistakesSoFar).toStrictEqual({
      white: { inaccuracies: 0, mistakes: 0, blunders: 0 },
      black: { inaccuracies: 1, mistakes: 0, blunders: 0 }
    });
    expect(payload!.context?.actualReply).toStrictEqual({
      moveNumberSan: "4...",
      san: "Qg5",
      matchesEngine: true
    });
    expect(payload).toMatchObject({
      annotation: "mistake",
      severity: "mistake",
      curatorReason: "mistake"
    });
    expect(payload!.context).toMatchObject({
      players: { white: "Alice", black: "Bob" },
      opening: "C50 Italian Game",
      totalPlies: 9
    });
    // Own clock went 290s -> 284s with a 2s increment: 8s spent.
    expect(payload!.clock).toStrictEqual({
      moverRemainingSec: 284,
      moverSpentSec: 8,
      opponentRemainingSec: 280
    });
    // The coach may cite the grounded reply line, history and alternatives.
    expect(
      validateProse(
        "4. Nxe5 walks into Qg5, hitting g2 while Nxf7 runs into Qxg2. Nxd4 or O-O kept White slightly better after 3...Nd4.",
        payload!
      ).ok
    ).toBe(true);
  });

  it("prefers the stored reply search when the review has one", () => {
    const moves = trapGame();
    const last = {
      ...moves[6],
      replyLines: [
        { multipv: 1, depth: 18, score: cp(180), scoreWhite: cp(-180), pv: ["d8g5", "e5f7"] }
      ]
    };
    const payload = buildInsightPayload(last, { userRating: 1500 });
    expect(payload?.engines.stockfish.replyLineSan).toStrictEqual(["Qg5", "Nxf7"]);
  });

  it("builds the payload without game context", () => {
    const moves = trapGame();
    const payload = buildInsightPayload(moves[6], {
      userRating: 1500,
      commentaryDetail: "balanced",
      playerColor: "white"
    });
    expect(payload?.context).toBeUndefined();
    expect(payload?.engines.stockfish.replyLineSan).toBeUndefined();
    expect(payload?.engines.stockfish.alternatives).toHaveLength(3);
    expect(payload?.clock).toStrictEqual({ moverRemainingSec: 284 });
    expect(() => reviewInsightPayloadSchema.parse(payload)).not.toThrow();
  });

  it("lists Maia's expected moves only when the distribution is informative", () => {
    const moves = trapGame();
    const predictions = (probs: number[]) =>
      ([1100, 1300, 1500, 1700, 1900] as const).map((rating) => ({
        rating,
        topMoves: [
          { uci: "f3e5", prob: probs[0] },
          { uci: "e1g1", prob: probs[1] },
          { uci: "f3d4", prob: probs[2] }
        ]
      }));
    const trusted = { moves, review: { schemaVersion: 2 } };
    const informative = buildInsightPayload(
      { ...moves[6], humanPredictions: predictions([0.6, 0.3, 0.1]) },
      { userRating: 1500, commentaryDetail: "balanced", playerColor: "white", context: trusted }
    );
    expect(informative?.engines.maia).toMatchObject({
      model: "maia1",
      rating: 1500,
      topMoves: [
        { san: "Nxe5", prob: 0.6 },
        { san: "O-O", prob: 0.3 },
        { san: "Nxd4", prob: 0.1 }
      ]
    });
    // Maia 1's five levels make a complete curve.
    expect(informative?.engines.maiaCurve?.ratings).toStrictEqual([1100, 1300, 1500, 1700, 1900]);
    const flat = buildInsightPayload(
      { ...moves[6], humanPredictions: predictions([0.2, 0.2, 0.2]) },
      { userRating: 1500, commentaryDetail: "balanced", playerColor: "white", context: trusted }
    );
    expect(flat?.engines.maia?.topMoves).toBeUndefined();
    // Reviews older than schemaVersion 2 stored fake policies: no Maia data at all.
    const legacy = buildInsightPayload(
      { ...moves[6], humanPredictions: predictions([0.6, 0.3, 0.1]) },
      { userRating: 1500, commentaryDetail: "balanced", playerColor: "white", context: { moves } }
    );
    expect(legacy?.engines.maia).toBeUndefined();
    expect(legacy?.engines.maiaCurve).toBeUndefined();
  });

  it("sends Maia 1's level nearest the player, engine identity and win chances for schemaVersion 2 reviews", () => {
    const moves = trapGame();
    const mistake: MoveReview = {
      ...moves[6],
      wdlBefore: { win: 450, draw: 400, loss: 150 },
      wdlAfter: { win: 700, draw: 200, loss: 100 },
      humanPredictions: [
        {
          rating: 1100,
          topMoves: [
            { uci: "f3e5", prob: 0.65 },
            { uci: "e1g1", prob: 0.2 }
          ],
          playedProb: 0.65,
          playedRank: 1,
          bestProb: 0.05,
          bestRank: 4
        },
        {
          rating: 1500,
          topMoves: [
            { uci: "f3e5", prob: 0.5 },
            { uci: "f3d4", prob: 0.3 }
          ],
          playedProb: 0.5,
          playedRank: 1,
          bestProb: 0.3,
          bestRank: 2
        },
        {
          rating: 1900,
          topMoves: [
            { uci: "f3d4", prob: 0.55 },
            { uci: "f3e5", prob: 0.25 }
          ],
          playedProb: 0.25,
          playedRank: 2,
          bestProb: 0.55,
          bestRank: 1
        }
      ]
    };
    const payload = buildInsightPayload(mistake, {
      userRating: 1400,
      commentaryDetail: "balanced",
      playerColor: "white",
      context: {
        moves,
        review: {
          schemaVersion: 2,
          engineName: "Stockfish 17",
          engineSettings: { multipv: 3, moveTimeMs: 250, depth: null }
        }
      }
    });
    expect(() => reviewInsightPayloadSchema.parse(payload)).not.toThrow();
    expect(payload!.engines.stockfish).toMatchObject({
      engineName: "Stockfish 17",
      depth: 18,
      moveTimeMs: 250,
      winChance: { before: { win: 45, draw: 40, loss: 15 }, after: { win: 10, draw: 20, loss: 70 } }
    });
    expect(payload!.engines.maia).toStrictEqual({
      model: "maia1",
      rating: 1500,
      playedProb: 0.5,
      playedRank: 1,
      playedLikelihood: "most_likely",
      bestProb: 0.3,
      bestRank: 2,
      bestLikelihood: "common",
      topMoves: [
        { san: "Nxe5", prob: 0.5 },
        { san: "Nxd4", prob: 0.3 }
      ]
    });
    // Three of Maia 1's five levels are no curve.
    expect(payload!.engines.maiaCurve).toBeUndefined();
  });

  it("sends Maia 3's prediction at the mover's rating, and its curve once the move has one", () => {
    const moves = trapGame();
    /** Maia 3 at `rating`: the played move first, the best second. */
    const prediction = (rating: number, played: number, best: number): RatingPrediction => ({
      rating,
      topMoves: [
        { uci: "f3e5", prob: played },
        { uci: "f3d4", prob: best },
        { uci: "e1g1", prob: 0.05 },
        { uci: "c2c3", prob: 0.03 },
        { uci: "d2d3", prob: 0.02 }
      ],
      playedProb: played,
      playedRank: 1,
      bestProb: best,
      bestRank: 2,
      whiteWinProb: 0.5612
    });
    const mistake: MoveReview = {
      ...moves[6],
      moverPrediction: prediction(1800, 0.4123, 0.3311)
    };
    const options = {
      userRating: 1400,
      commentaryDetail: "balanced" as const,
      playerColor: "white" as const,
      context: { moves, review: { schemaVersion: 4 } }
    };
    const payload = buildInsightPayload(mistake, options)!;
    expect(() => reviewInsightPayloadSchema.parse(payload)).not.toThrow();
    expect(payload.schemaVersion).toBe(3);
    expect(payload.player).toStrictEqual({ rating: 1400, color: "white" });
    expect(payload.engines.maia).toStrictEqual({
      model: "maia3",
      rating: 1800,
      playedProb: 0.41,
      playedRank: 1,
      playedLikelihood: "most_likely",
      bestProb: 0.33,
      bestRank: 2,
      bestLikelihood: "common",
      topMoves: [
        { san: "Nxe5", prob: 0.41 },
        { san: "Nxd4", prob: 0.33 },
        { san: "O-O", prob: 0.05 }
      ],
      whiteWinPct: 56
    });
    expect(payload.engines.maiaCurve).toBeUndefined();

    // Opened in the Engine tab: the 21-point curve, eloSelf = eloOppo = each rating.
    const curve = MAIA3_RATINGS.map((rating) =>
      prediction(rating, 0.75 - (rating - 600) / 2500, 0.05 + (rating - 600) / 2500)
    );
    const opened = buildInsightPayload({ ...mistake, humanPredictions: curve }, options)!;
    expect(() => reviewInsightPayloadSchema.parse(opened)).not.toThrow();
    expect(opened.engines.maia?.rating).toBe(1800);
    const maiaCurve = opened.engines.maiaCurve!;
    expect(maiaCurve.ratings).toStrictEqual(MAIA3_RATINGS);
    expect(maiaCurve.userRatingBucket).toBe(1800);
    expect(maiaCurve.playedProb.slice(0, 3)).toStrictEqual([0.75, 0.71, 0.67]);
    // Played by most players up to 700, by fewer than 30% from 1900.
    expect(maiaCurve.interpretation).toStrictEqual({ label: "trap_at_low_rating" });
    expect(maiaCurve.bestLikelyFrom).toBe(1300);
    expect(JSON.stringify(opened).length).toBeLessThan(6 * 1024);
  });

  it("adds board-derived idea facts and keeps the payload compact", () => {
    const moves = trapGame();
    const payload = buildInsightPayload(moves[6], {
      userRating: 1500,
      commentaryDetail: "detailed",
      playerColor: "white",
      context: {
        moves,
        review: { schemaVersion: 2 }
      }
    })!;
    expect(payload.ideas?.board.white).toContain("B c1 c4");
    expect(payload.ideas?.played.san).toBe("Nxe5");
    expect(payload.ideas?.played.facts[0]).toMatch(/^captures the pawn on e5/);
    expect(payload.ideas?.reply?.san).toBe("Qg5");
    expect(payload.ideas?.reply?.facts.join(" ")).toContain("knight on e5");
    expect(payload.ideas?.best?.san).toBe("Nxd4");
    expect(payload.ideas?.position?.after.material).toBeTruthy();
    expect(JSON.stringify(payload).length).toBeLessThan(6 * 1024);
    // Every idea fact stays inside the validator's grounding.
    const text = `${payload.ideas!.played.facts[0]}. ${payload.ideas!.reply!.facts[0]}.`;
    expect(validateProse(`Nxe5 ${text}`.slice(0, 700), payload).ok).toBe(true);
  });

  it("produces a payload for a mating move instead of dropping it", () => {
    const mate = move({
      ply: 41,
      san: "Rd8#",
      playedMove: "d1d8",
      fenBefore: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 21",
      fenAfter: "3R2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 1 21",
      evalBefore: { type: "mate", value: 1 },
      evalAfter: null,
      bestEvalAfter: null,
      evalLoss: null,
      bestMove: "d1d8",
      bestLine: ["d1d8"]
    });
    const payload = buildInsightPayload(mate, {
      userRating: 1500,
      commentaryDetail: "balanced",
      playerColor: "white",
      context: { moves: [mate] }
    });
    expect(payload).not.toBeNull();
    expect(() => reviewInsightPayloadSchema.parse(payload)).not.toThrow();
    expect(payload!.game).toMatchObject({
      terminal: "checkmate",
      givesCheck: true,
      phase: "endgame"
    });
    expect(payload!.engines.stockfish).toMatchObject({
      evalAfter: "M0",
      evalLossCp: 0,
      assessment: { before: "white_has_forced_mate", after: "white_won" }
    });
    expect(payload!.context?.result).toBe("1-0");
  });

  it("marks a stalemate that threw away a win", () => {
    const stalemate = move({
      ply: 61,
      san: "Qb6",
      playedMove: "b5b6",
      fenBefore: "k7/8/8/1Q6/8/8/8/7K w - - 0 31",
      fenAfter: "k7/8/1Q6/8/8/8/8/7K b - - 1 31",
      evalBefore: { type: "mate", value: 9 },
      evalAfter: null,
      bestEvalAfter: { type: "mate", value: 8 },
      evalLoss: null,
      bestMove: "h1g2",
      bestLine: ["h1g2", "a8a7"]
    });
    const payload = buildInsightPayload(stalemate, { userRating: 1500 });
    expect(payload?.game.terminal).toBe("stalemate");
    expect(payload?.engines.stockfish).toMatchObject({
      evalAfter: "0.00",
      evalLossCp: 1000,
      assessment: { after: "draw", afterBest: "white_has_forced_mate" },
      bestMoveSan: "Kg2"
    });
  });

  it("extracts the first-child review line, not a variation", () => {
    const tree = [
      {
        id: "root",
        parentId: null,
        san: null,
        uci: null,
        fenBefore: "",
        fenAfter: "start",
        ply: 0,
        nags: [],
        comment: null,
        arrows: [],
        highlights: [],
        children: ["n1", "v1"]
      },
      {
        id: "n1",
        parentId: "root",
        san: "e4",
        uci: "e2e4",
        fenBefore: "start",
        fenAfter: "after",
        ply: 1,
        nags: [],
        comment: null,
        arrows: [],
        highlights: [],
        children: ["n2"]
      },
      {
        id: "v1",
        parentId: "root",
        san: "d4",
        uci: "d2d4",
        fenBefore: "start",
        fenAfter: "after-d4",
        ply: 1,
        nags: [],
        comment: null,
        arrows: [],
        highlights: [],
        children: []
      },
      {
        id: "n2",
        parentId: "n1",
        san: "e5",
        uci: "e7e5",
        fenBefore: "after",
        fenAfter: "after-e5",
        ply: 2,
        nags: [],
        comment: null,
        arrows: [],
        highlights: [],
        children: []
      }
    ];
    expect(mainlineReviewInput(tree).map((move) => move.uci)).toStrictEqual(["e2e4", "e7e5"]);
  });
});

describe("Maia data of a move", () => {
  const level = (rating: number, played = 0.3): RatingPrediction => ({
    rating,
    topMoves: [{ uci: "e2e4", prob: played }],
    playedProb: played
  });

  it("is usable with Maia 3's prediction, a complete curve, or Maia 1's five levels", () => {
    const maia3Curve = MAIA3_RATINGS.map((rating) => level(rating));
    expect(hasUsableMaiaData(move())).toBe(false);
    expect(hasUsableMaiaData(move({ moverPrediction: level(1500) }))).toBe(true);
    expect(hasUsableMaiaData(move({ humanPredictions: maia3Curve }))).toBe(true);
    expect(hasUsableMaiaData(move({ humanPredictions: maia3Curve.slice(1) }))).toBe(false);
    const levels = [1100, 1300, 1500, 1700, 1900].map((rating) => level(rating));
    expect(hasUsableMaiaData(move({ humanPredictions: levels }))).toBe(true);
    expect(hasUsableMaiaData(move({ humanPredictions: levels.slice(1) }))).toBe(false);
  });

  it("reads Maia 1's curve at the player's level and Maia 3's at the mover's rating", () => {
    // Maia 1's levels, unsorted as saved: the same curve as before Maia 3.
    const levels = [1900, 1100, 1500, 1300, 1700].map((rating) =>
      level(rating, { 1100: 0.62, 1300: 0.55, 1500: 0.45, 1700: 0.18, 1900: 0.04 }[rating])
    );
    const legacy = buildRatingCurveForMove(
      move({ playedMove: "e2e4", bestMove: "d2d4", humanPredictions: levels }),
      1290
    );
    expect(legacy).toMatchObject({
      ratings: [1100, 1300, 1500, 1700, 1900],
      playedProb: [0.62, 0.55, 0.45, 0.18, 0.04],
      bestProb: [0, 0, 0, 0, 0],
      interpretation: { label: "rating_cliff", cliffRating: 1700 },
      userRatingBucket: 1300
    });
    const maia3 = buildRatingCurveForMove(
      move({
        moverPrediction: level(2100),
        humanPredictions: MAIA3_RATINGS.map((rating) => level(rating))
      }),
      1290
    );
    expect(maia3?.ratings).toHaveLength(21);
    expect(maia3?.userRatingBucket).toBe(2100);
    expect(buildRatingCurveForMove(move({ moverPrediction: level(2100) }), 1290)).toBeNull();
  });
});

describe("engine line steps", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("gives the position after each move, stopping at one that doesn't fit", () => {
    const steps = uciLineSteps(START, ["e2e4", "e7e5", "e1e5", "g1f3"]);
    expect(steps.map((step) => step.san)).toStrictEqual(["e4", "e5"]);
    expect(steps[1].fenAfter).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
  });

  it("numbers a line from either side to move", () => {
    expect(numberedLine(START, ["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
    expect(
      numberedLine("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12", ["e5", "Nf3"])
    ).toBe("12… e5 13. Nf3");
  });
});
