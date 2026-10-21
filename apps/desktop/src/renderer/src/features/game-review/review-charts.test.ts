import { describe, expect, it } from "vitest";
import { trapReviewMoves } from "@chaturanga/shared/chess/__fixtures__/trap-game";
import { assessMoves } from "@chaturanga/shared/chess/move-assessment";
import type { MoveReview, RatingPrediction } from "@chaturanga/shared/types/engine";
import {
  buildReviewChartData,
  chartMark,
  chartTooltip,
  chartTooltipText,
  difficultyTitle,
  nearestPointIndex,
  winningChancesTitle,
  type ChartPoint,
  type ReviewChartInput
} from "./review-charts";
import { moverWinChances } from "./review-score";

/** The trap game's 14 plies with 3+2 clocks: White thinks 10 s a move, Black 4 s. */
const CLOCKS = Array.from({ length: 14 }, (_, index) => {
  const white = index % 2 === 0;
  const own = Math.floor(index / 2) + 1;
  const left = 180 - own * (white ? 10 : 4) + own * 2;
  return `0:0${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
});

function input(moves: MoveReview[], overrides: Partial<ReviewChartInput> = {}): ReviewChartInput {
  return {
    moves,
    opening: { eco: "C50", name: "Italian Game", ply: 5, bookEndPly: 5, firstNonBookMove: null },
    mainline: moves.map((move, index) => ({
      nodeId: move.nodeId,
      ply: move.ply,
      san: move.san,
      fenBefore: move.fenBefore,
      clockAfter: CLOCKS[index]
    })),
    timeControl: "180+2",
    maia: { model: 1500, rating: 1500, trusted: true },
    ...overrides
  };
}

/** The moves with Maia data on the one at `index`. */
function withMaiaAt(moves: readonly MoveReview[], index: number, bestProb: number): MoveReview[] {
  return moves.map((move, at) => (at === index ? withMaia(move, bestProb) : move));
}

function withMaia(move: MoveReview, bestProb: number): MoveReview {
  const prediction: RatingPrediction = { rating: 1500, topMoves: [], bestProb };
  return { ...move, humanPredictions: [prediction] };
}

describe("review chart data", () => {
  const raw = trapReviewMoves();
  const trap = assessMoves(raw).map((assessment, index) => ({ ...raw[index], assessment }));

  it("plots White's winning chances from the start, with a checkmate decided", () => {
    const { points } = buildReviewChartData(input(trap));
    expect(points).toHaveLength(15);
    expect(points[0]).toMatchObject({ ply: 0, nodeId: "root", label: "Start", mover: null });
    // +0.3 before 1. e4: a touch over even, by Lichess's WinPercent.
    expect(points[0].whiteWin).toBeCloseTo(52.76, 1);
    expect(points[7]).toMatchObject({ label: "4. Nxe5", annotation: "blunder", mover: "white" });
    expect(points[7].whiteWin).toBeLessThan(30);
    // 7… Nf3#: Black mated White.
    expect(points[14].whiteWin).toBe(0);
  });

  it("splits the phases at the book's end and rings the key moments", () => {
    const data = buildReviewChartData(input(trap, { keyMomentIds: new Set(["n7"]) }));
    expect(data.phases).toStrictEqual({ openingEnd: 5, endgameStart: null });
    expect(data.points.filter((point) => point.key).map((point) => point.label)).toStrictEqual([
      "4. Nxe5"
    ]);
  });

  it("times each move from the clocks, increment included", () => {
    const data = buildReviewChartData(input(trap));
    expect(data.hasTimes).toBe(true);
    expect(data.points.slice(1, 5).map((point) => point.spentMs)).toStrictEqual([
      10_000, 4000, 10_000, 4000
    ]);
    const noClocks = buildReviewChartData(
      input(trap, { mainline: input(trap).mainline.map((move) => ({ ...move, clockAfter: null })) })
    );
    expect(noClocks.hasTimes).toBe(false);
  });

  it("has a point per main-line move, with only the clocks' times for an unreviewed game", () => {
    const unreviewed = buildReviewChartData({ ...input(trap), moves: [] });
    expect(unreviewed.points).toHaveLength(15);
    expect(unreviewed.points[7]).toMatchObject({
      label: "4. Nxe5",
      whiteWin: null,
      annotation: null,
      spentMs: 10_000,
      mover: "white"
    });
    expect(unreviewed).toMatchObject({ hasEvals: false, hasDifficulty: false, hasTimes: true });
    expect(chartTooltip(unreviewed.points[7], "white")).toStrictEqual({
      title: "4. Nxe5",
      rows: [{ label: "Time spent", value: "0:10" }]
    });
    // A review still running: the moves it has reached have evaluations, the rest wait.
    const running = buildReviewChartData({ ...input(trap), moves: trap.slice(0, 4) });
    expect(running.points[4].whiteWin).not.toBeNull();
    expect(running.points[5].whiteWin).toBeNull();
    expect(running.hasEvals).toBe(true);
  });

  it("puts each move's point where the Engine tab's chances end, not at the assessment's reading", () => {
    // The assessment reads a move in the search before it (its mark and loss do); the points and
    // the Engine tab's chances read the positions either side of it (as its Eval and the eval bar).
    const nxe5: MoveReview = { ...trap[6], assessment: { ...trap[6].assessment, winAfter: 99 } };
    const qg5 = trap[7];
    const { points } = buildReviewChartData(input([...trap.slice(0, 6), nxe5, ...trap.slice(7)]));
    const white = points.map((point) => Math.round(Number(point.whiteWin)));
    // 4. Nxe5, White's: from the point before it to its own.
    expect(moverWinChances(nxe5)).toStrictEqual({ before: white[6], after: white[7] });
    // 4… Qg5, Black's: the same points from Black's side.
    expect(moverWinChances(qg5)).toStrictEqual({ before: 100 - white[7], after: 100 - white[8] });
  });

  it("reads difficulty at the review's Maia model, and none from untrusted or missing data", () => {
    const moves = withMaiaAt(trap, 6, 0.12);
    const data = buildReviewChartData(input(moves));
    expect(data.model).toBe(1500);
    expect(data.hasDifficulty).toBe(true);
    expect(data.points[7].bestChance).toBe(0.12);
    expect(data.points[8].bestChance).toBeNull();
    const untrusted = buildReviewChartData(
      input(moves, { maia: { model: 1500, rating: 1500, trusted: false } })
    );
    expect(untrusted).toMatchObject({ model: null, hasDifficulty: false });
    expect(buildReviewChartData(input(trap)).hasDifficulty).toBe(false);
    expect(difficultyTitle(data.points)).toBe("Difficulty at 1500 · Maia");
  });

  it("reads a Maia 3 move's difficulty at its mover's rating, titled per side", () => {
    const at = (move: MoveReview, rating: number, bestProb: number): MoveReview => ({
      ...move,
      moverPrediction: { rating, topMoves: [], bestProb }
    });
    // Ply 7 is White's, ply 8 Black's.
    const moves: MoveReview[] = [...trap];
    moves[6] = at(trap[6], 1800, 0.3);
    moves[7] = at(trap[7], 1200, 0.6);
    const data = buildReviewChartData(
      input(moves, { maia: { model: null, rating: 1500, trusted: true } })
    );
    expect(data.points[7]).toMatchObject({ bestChance: 0.3, maiaRating: 1800 });
    expect(data.points[8]).toMatchObject({ bestChance: 0.6, maiaRating: 1200 });
    expect(chartTooltip(data.points[8], "white").rows).toContainEqual({
      label: "Best move at 1200 · Maia",
      value: "60%"
    });
    expect(difficultyTitle(data.points)).toBe("Difficulty at White 1800 · Black 1200 · Maia");
    const same: MoveReview[] = [...moves];
    same[7] = at(trap[7], 1800, 0.6);
    expect(
      difficultyTitle(
        buildReviewChartData(input(same, { maia: { model: null, rating: 1500, trusted: true } }))
          .points
      )
    ).toBe("Difficulty at 1800 · Maia");
  });
});

describe("chart helpers", () => {
  const point: ChartPoint = {
    ply: 103,
    nodeId: "n103",
    label: "52. Ne4",
    whiteWin: 3.2,
    annotation: "blunder",
    key: true,
    bestChance: 0.12,
    maiaRating: 1500,
    spentMs: 43_000,
    mover: "white"
  };

  it("writes the tooltip from the reviewed side, naming each value's source, leaving out what is unknown", () => {
    const tooltip = chartTooltip(point, "white", "Stockfish 19");
    expect(tooltip).toStrictEqual({
      title: "52. Ne4 · Blunder",
      rows: [
        { label: "Your chances · Stockfish 19", value: "3%" },
        { label: "Opponent's", value: "97%" },
        { label: "Best move at 1500 · Maia", value: "12%" },
        { label: "Time spent", value: "0:43" }
      ]
    });
    expect(chartTooltipText(tooltip)).toBe(
      "52. Ne4 · Blunder, Your chances · Stockfish 19 3%, Opponent's 97%, Best move at 1500 · Maia 12%, Time spent 0:43"
    );
    expect(winningChancesTitle("Stockfish 19")).toBe("Winning chances · Stockfish 19");
    // An engine the review didn't name: the chances unnamed.
    expect(winningChancesTitle(null)).toBe("Winning chances");
    expect(
      chartTooltip(
        { ...point, annotation: null, bestChance: null, maiaRating: null, spentMs: null },
        "black"
      )
    ).toStrictEqual({
      title: "52. Ne4",
      rows: [
        { label: "Your chances", value: "97%" },
        { label: "Opponent's", value: "3%" }
      ]
    });
  });

  it("colours every mark but Book", () => {
    expect(chartMark("book")).toBeNull();
    expect(chartMark("great")).toBe("great");
    expect(chartMark(null)).toBeNull();
  });

  it("finds the point nearest a ply, the earlier one on a tie", () => {
    const points = [{ ply: 0 }, { ply: 1 }, { ply: 2 }, { ply: 5 }];
    expect(nearestPointIndex(points, 1.4)).toBe(1);
    expect(nearestPointIndex(points, 3.5)).toBe(2);
    expect(nearestPointIndex(points, 4)).toBe(3);
    expect(nearestPointIndex(points, 99)).toBe(3);
    expect(nearestPointIndex(points, -3)).toBe(0);
    expect(nearestPointIndex([], 3)).toBe(-1);
  });
});
