import { describe, expect, it } from "vitest";
import { trapReviewMoves } from "@chaturanga/shared/chess/__fixtures__/trap-game";
import { assessMoves } from "@chaturanga/shared/chess/move-assessment";
import type { MoveReview, RatingPrediction } from "@chaturanga/shared/types/engine";
import {
  buildReviewChartData,
  chartMark,
  chartTooltipLines,
  nearestPointIndex,
  type ChartPoint,
  type ReviewChartInput
} from "./review-charts";

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
    expect(data.phases).toEqual({ openingEnd: 5, endgameStart: null });
    expect(data.points.filter((point) => point.key).map((point) => point.label)).toEqual([
      "4. Nxe5"
    ]);
  });

  it("times each move from the clocks, increment included", () => {
    const data = buildReviewChartData(input(trap));
    expect(data.hasTimes).toBe(true);
    expect(data.points.slice(1, 5).map((point) => point.spentMs)).toEqual([
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
    expect(chartTooltipLines(unreviewed.points[7], "white", null)).toEqual([
      "4. Nxe5",
      "0:10 spent"
    ]);
    // A review still running: the moves it has reached have evaluations, the rest wait.
    const running = buildReviewChartData({ ...input(trap), moves: trap.slice(0, 4) });
    expect(running.points[4].whiteWin).not.toBeNull();
    expect(running.points[5].whiteWin).toBeNull();
    expect(running.hasEvals).toBe(true);
  });

  it("reads difficulty at the review's Maia model, and none from untrusted or missing data", () => {
    const moves = trap.map((move, index) => (index === 6 ? withMaia(move, 0.12) : move));
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
    spentMs: 43_000,
    mover: "white"
  };

  it("writes the tooltip from the reviewed side, leaving out what is unknown", () => {
    expect(chartTooltipLines(point, "white", 1500)).toEqual([
      "52. Ne4 · Blunder",
      "You 3% · Opponent 97%",
      "12% at 1500 find the best move",
      "0:43 spent"
    ]);
    expect(
      chartTooltipLines(
        { ...point, annotation: null, bestChance: null, spentMs: null },
        "black",
        null
      )
    ).toEqual(["52. Ne4", "You 97% · Opponent 3%"]);
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
