import { skipToken } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { MAIA_CURVE_NOT_SAVED } from "@chaturanga/shared/types/engine";
import { maiaCurveQueryOptions, maiaCurveRetryDelay, parseMaiaCurve, retryMaiaCurve } from "./maia";

describe("parseMaiaCurve", () => {
  it("keeps the predictions' known fields, ascending by rating", () => {
    expect(
      parseMaiaCurve([
        { rating: 700, topMoves: [{ uci: "e2e4", prob: 0.4 }], playedProb: 0.1, extra: 1 },
        { rating: 600, topMoves: [], bestProb: 0.2, whiteWinProb: "x" }
      ])
    ).toStrictEqual([
      { rating: 600, topMoves: [], bestProb: 0.2 },
      { rating: 700, topMoves: [{ uci: "e2e4", prob: 0.4 }], playedProb: 0.1 }
    ]);
  });

  it("rejects anything that isn't a curve", () => {
    expect(parseMaiaCurve(null)).toBeNull();
    expect(parseMaiaCurve([{ rating: "600", topMoves: [] }])).toBeNull();
    expect(parseMaiaCurve([{ rating: 600, topMoves: [{ uci: "e2e4" }] }])).toBeNull();
  });
});

describe("maiaCurveQueryOptions", () => {
  const input = { gameId: "g", reviewId: "r", nodeId: "n" };

  it("asks for a move's curve only once the move has rested", () => {
    expect(maiaCurveQueryOptions(input, false).queryFn).toBe(skipToken);
    expect(maiaCurveQueryOptions(null, true).queryFn).toBe(skipToken);
    expect(maiaCurveQueryOptions(input, true).queryFn).toBeTypeOf("function");
    // The same key either way: a curve read before shows while the move rests.
    expect(maiaCurveQueryOptions(input, false).queryKey).toStrictEqual(
      maiaCurveQueryOptions(input, true).queryKey
    );
  });

  it("asks again, backing off, while the analysis isn't saved yet; other failures are final", () => {
    expect(maiaCurveQueryOptions(input, true)).toMatchObject({
      retry: retryMaiaCurve,
      retryDelay: maiaCurveRetryDelay
    });
    // As ipcRenderer.invoke wraps main's error.
    const notSaved = new Error(
      `Error invoking remote method 'engines:maiaCurve': Error: ${MAIA_CURVE_NOT_SAVED}`
    );
    expect(retryMaiaCurve(0, notSaved)).toBe(true);
    expect(retryMaiaCurve(11, notSaved)).toBe(true);
    expect(retryMaiaCurve(12, notSaved)).toBe(false);
    expect(retryMaiaCurve(0, new Error("Maia 3 isn't installed"))).toBe(false);
    expect([0, 1, 2, 5].map(maiaCurveRetryDelay)).toStrictEqual([500, 1000, 2000, 2000]);
  });
});
