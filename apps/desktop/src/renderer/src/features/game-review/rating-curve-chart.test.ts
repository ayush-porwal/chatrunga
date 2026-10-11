import { describe, expect, it } from "vitest";
import type { MoveReview, RatingPrediction } from "@chaturanga/shared/types/engine";
import { MAIA_BUCKETS } from "@chaturanga/shared/schemas/constants";
import { buildRatingCurveForMove } from "./review-utils";
import {
  axisTicks,
  columnForKey,
  columnText,
  columnValues,
  engineMoveRows,
  humanMoveRows,
  nearestColumn,
  percent,
  predictionChart,
  predictionLines,
  spreadLabels,
  type PredictionLine
} from "./rating-curve-chart";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** g4 played, e4 best; Maia's own pick at every level is d4. */
const PROBS: Record<string, readonly number[]> = {
  d2d4: [0.4, 0.42, 0.45, 0.4, 0.38],
  e2e4: [0.2, 0.25, 0.3, 0.35, 0.4],
  g2g4: [0.15, 0.1, 0.05, 0.02, 0.01]
};

function predictions(): RatingPrediction[] {
  return MAIA_BUCKETS.map((rating, index) => ({
    rating,
    topMoves: Object.entries(PROBS)
      .map(([uci, probs]) => ({ uci, prob: probs[index] }))
      .sort((a, b) => b.prob - a.prob)
  }));
}

function move(overrides: Partial<MoveReview> = {}): MoveReview {
  return {
    nodeId: "n1",
    ply: 1,
    san: "g4",
    playedMove: "g2g4",
    fenBefore: START,
    fenAfter: "rnbqkbnr/pppppppp/8/8/6P1/8/PPPPPP1P/RNBQKBNR b KQkq - 0 1",
    evalBefore: { type: "cp", value: 20 },
    evalAfter: { type: "cp", value: -60 },
    evalLoss: 80,
    bestMove: "e2e4",
    bestLine: ["e2e4", "e7e5"],
    topLines: [
      {
        multipv: 1,
        depth: 18,
        score: { type: "cp", value: 32 },
        scoreWhite: { type: "cp", value: 32 },
        pv: ["e2e4", "e7e5"]
      },
      {
        multipv: 2,
        depth: 18,
        score: { type: "cp", value: 26 },
        scoreWhite: { type: "cp", value: 26 },
        pv: ["g1f3", "d7d5"]
      }
    ],
    humanPredictions: predictions(),
    motifs: [],
    ...overrides
  };
}

const linesOf = (review: MoveReview) =>
  predictionLines(review, buildRatingCurveForMove(review, 1500));

describe("predictionLines", () => {
  it("draws the move played, the best move and Maia's own pick", () => {
    expect(linesOf(move()).map((line) => [line.role, line.san])).toStrictEqual([
      ["played", "g4"],
      ["best", "e4"],
      ["maia", "d4"]
    ]);
  });

  it("reads each line's probability at every Maia level", () => {
    expect(linesOf(move())[2].probs).toStrictEqual(PROBS.d2d4);
  });

  it("reads the played move from the full policy, outside the top moves too", () => {
    const outside = move({
      playedMove: "h2h4",
      san: "h4",
      humanPredictions: predictions().map((prediction) => ({ ...prediction, playedProb: 0.003 }))
    });
    expect(linesOf(outside)[0].probs).toStrictEqual([0.003, 0.003, 0.003, 0.003, 0.003]);
  });

  it("draws one line for a move played that is the best", () => {
    const best = move({ playedMove: "e2e4", san: "e4" });
    expect(linesOf(best).map((line) => line.role)).toStrictEqual(["played", "maia"]);
  });

  it("adds no line for Maia's pick when it is the move played", () => {
    const pick = move({ playedMove: "d2d4", san: "d4" });
    expect(linesOf(pick).map((line) => line.role)).toStrictEqual(["played", "best"]);
  });
});

describe("the move tables", () => {
  it("lists Maia's moves at the user's level, most likely first, the played and best marked", () => {
    expect(
      humanMoveRows(move(), 1500).map((row) => [row.san, percent(row.prob), row.role])
    ).toStrictEqual([
      ["d4", "45%", null],
      ["e4", "30%", "best"],
      ["g4", "5%", "played"]
    ]);
  });

  it("lists no human moves when Maia didn't run at the user's level", () => {
    expect(humanMoveRows(move({ humanPredictions: [] }), 1500)).toStrictEqual([]);
  });

  it("lists the engine's candidates by their first move and White's score", () => {
    expect(
      engineMoveRows(move(), 5).map((row) => [row.san, row.score.value, row.role])
    ).toStrictEqual([
      ["e4", 32, "best"],
      ["Nf3", 26, null]
    ]);
  });

  it("lists just the best engine move when alternatives are off", () => {
    expect(engineMoveRows(move(), 1).map((row) => row.san)).toStrictEqual(["e4"]);
  });

  it("writes a trace of a share as under a percent", () => {
    expect(percent(0.003)).toBe("<1%");
  });
});

const size = { width: 382, height: 132 };
const lines: PredictionLine[] = [
  { role: "played", san: "Be3", probs: [0.21, 0.27, 0.35, 0.31, 0.22] },
  { role: "best", san: "Nf5", probs: [0.09, 0.12, 0.15, 0.24, 0.38] }
];

describe("predictionChart", () => {
  it("spreads the five rating levels across the plot", () => {
    const chart = predictionChart(lines, 1500, size);
    expect(chart.xTicks.map((tick) => [tick.rating, tick.x])).toStrictEqual([
      [1100, 34],
      [1300, 108],
      [1500, 182],
      [1700, 256],
      [1900, 330]
    ]);
  });

  it("tops the axis at the first quarter step that holds every value", () => {
    const chart = predictionChart(lines, 1500, size);
    expect(chart.yTicks.map((tick) => tick.label)).toStrictEqual(["0%", "25%", "50%"]);
  });

  it("goes up to 100% for a move nearly everyone plays", () => {
    const common = [{ role: "best" as const, san: "e4", probs: [0.6, 0.7, 0.8, 0.9, 0.95] }];
    const chart = predictionChart(common, 1500, size);
    expect(chart.yTicks.map((tick) => tick.label)).toStrictEqual([
      "0%",
      "25%",
      "50%",
      "75%",
      "100%"
    ]);
  });

  it("puts a value at its height in the plot", () => {
    const chart = predictionChart(lines, 1500, size);
    // 35% of a 50% axis over a plot from 18 to 108.
    expect(chart.series[0].points[2].y).toBeCloseTo(18 + (1 - 0.35 / 0.5) * 90);
  });

  it("fills the area under a line down to 0", () => {
    const chart = predictionChart(lines, 1500, size);
    expect(chart.series[0].area.endsWith("L330.0,108 L34.0,108 Z")).toBe(true);
  });

  it("marks the user's rating level, centred on its point", () => {
    const chart = predictionChart(lines, 1500, size);
    expect(chart.userBand).toStrictEqual({ x: 182 - 22, width: 44 });
  });

  it("flags only the user's level on the axis", () => {
    const chart = predictionChart(lines, 1500, size);
    expect(chart.xTicks.filter((tick) => tick.user).map((tick) => tick.rating)).toStrictEqual([
      1500
    ]);
  });

  it("names each line right of its last point", () => {
    const chart = predictionChart(lines, 1500, size);
    expect(chart.endLabels.map((label) => [label.text, label.x])).toStrictEqual([
      ["Be3", 338],
      ["Nf5", 338]
    ]);
  });

  it("keeps the names of lines ending close together apart", () => {
    const close: PredictionLine[] = [
      { role: "played", san: "Be3", probs: [0.2, 0.2, 0.2, 0.2, 0.3] },
      { role: "best", san: "Nf5", probs: [0.2, 0.2, 0.2, 0.2, 0.29] }
    ];
    const [played, best] = predictionChart(close, 1500, size).endLabels;
    expect(best.y - played.y).toBeCloseTo(14);
  });

  it("keeps the name of a line ending at zero inside the plot", () => {
    const low: PredictionLine[] = [
      { role: "played", san: "g4", probs: [0.1, 0.05, 0.02, 0, 0] },
      { role: "best", san: "e4", probs: [0.2, 0.2, 0.2, 0.2, 0] }
    ];
    const chart = predictionChart(low, 1500, size);
    // The plot's bottom (108) plus the baseline's drop under the text's middle.
    expect(Math.max(...chart.endLabels.map((label) => label.y))).toBeCloseTo(108 + 4);
  });
});

describe("axisTicks", () => {
  it("steps by 25% up to the first step that holds the highest value", () => {
    expect(axisTicks(0.72).ticks).toStrictEqual([0, 0.25, 0.5, 0.75]);
  });

  it("steps by 10% when the top is low", () => {
    expect(axisTicks(0.24).ticks).toStrictEqual([0, 0.1, 0.2, 0.3]);
  });

  it("keeps a value on a step as the top", () => {
    expect(axisTicks(0.1 + 0.2).max).toBe(0.3);
  });

  it("still has a step when every value is zero", () => {
    expect(axisTicks(0).ticks).toStrictEqual([0, 0.1]);
  });

  it("never goes past 100%", () => {
    expect(axisTicks(1).max).toBe(1);
  });
});

describe("spreadLabels", () => {
  it("leaves labels that are far enough apart", () => {
    expect(spreadLabels([20, 60, 90], 14, 112)).toStrictEqual([20, 60, 90]);
  });

  it("pushes a label down below one it would touch, in the given order", () => {
    expect(spreadLabels([100, 95], 14, 200)).toStrictEqual([109, 95]);
  });

  it("lifts the stack back above the bottom", () => {
    expect(spreadLabels([110, 112, 112], 14, 112)).toStrictEqual([84, 98, 112]);
  });
});

describe("chart interaction", () => {
  const xs = [34, 108, 182, 256, 330];

  it("snaps the pointer to the nearest rating column", () => {
    expect(nearestColumn(150, xs)).toBe(2);
  });

  it("snaps a pointer left of the plot to the first column", () => {
    expect(nearestColumn(0, xs)).toBe(0);
  });

  it("steps right one column", () => {
    expect(columnForKey("ArrowRight", 2, 5, 2)).toBe(3);
  });

  it("stays on the last column at the right end", () => {
    expect(columnForKey("ArrowRight", 4, 5, 2)).toBe(4);
  });

  it("starts at the user's column when none is shown", () => {
    expect(columnForKey("ArrowLeft", null, 5, 2)).toBe(2);
  });

  it("jumps to the first column with Home", () => {
    expect(columnForKey("Home", 3, 5, 2)).toBe(0);
  });

  it("jumps to the last column with End", () => {
    expect(columnForKey("End", 1, 5, 2)).toBe(4);
  });

  it("clears with Escape", () => {
    expect(columnForKey("Escape", 3, 5, 2)).toBeNull();
  });

  it("leaves other keys alone", () => {
    expect(columnForKey("Enter", 3, 5, 2)).toBeUndefined();
  });

  it("lists a column's values, the most likely first", () => {
    const withPick: PredictionLine[] = [
      ...lines,
      { role: "maia", san: "Qe8+", probs: [0.5, 0.52, 0.4, 0.58, 0.7] }
    ];
    expect(columnValues(withPick, 3)).toStrictEqual([
      { role: "maia", san: "Qe8+", value: 0.58 },
      { role: "played", san: "Be3", value: 0.31 },
      { role: "best", san: "Nf5", value: 0.24 }
    ]);
  });
});

describe("columnText", () => {
  it("reads a level's values out, the most likely first", () => {
    expect(columnText(lines, 4)).toBe("1900: Best Nf5 38%, Played Be3 22%");
  });
});
