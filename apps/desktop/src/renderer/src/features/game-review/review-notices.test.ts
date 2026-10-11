import { describe, expect, it } from "vitest";
import { reviewNotices, type ReviewNoticeInput } from "./review-notices";

// A finished analysis of a 41-ply (21-move) game, nothing to say about it.
const base: ReviewNoticeInput = {
  status: "ready",
  error: null,
  analysedPlies: 0,
  totalPlies: 41,
  blackFirst: false,
  outdatedMoves: 0,
  recomputed: false,
  canAnalyze: true
};

const keys = (input: Partial<ReviewNoticeInput>) =>
  reviewNotices({ ...base, ...input }).map((notice) => notice.key);

describe("reviewNotices", () => {
  it("says nothing about a current analysis", () => {
    expect(reviewNotices(base)).toStrictEqual([]);
  });

  it("says nothing while a run is on, whatever the shown analysis has", () => {
    expect(keys({ status: "running", outdatedMoves: 2, recomputed: true })).toStrictEqual([]);
  });

  it("says where a stopped run got to: the move it was on, out of the game's", () => {
    // 16 plies done: it was on White's 9th move.
    expect(reviewNotices({ ...base, status: "cancelled", analysedPlies: 16 })).toStrictEqual([
      {
        key: "stopped",
        tone: "warn",
        text: "Analysis stopped at move 9 of 21.",
        analyze: true
      }
    ]);
  });

  it("counts a stopped run's moves from Black's first move in a Black-to-move game", () => {
    // 41 plies from Black's move: 1… then 20 full moves, 21 numbers in all; 2 plies done is move 2.
    expect(
      reviewNotices({ ...base, status: "cancelled", analysedPlies: 2, blackFirst: true })[0]?.text
    ).toBe("Analysis stopped at move 2 of 21.");
  });

  it("never counts a stopped run past the game's last move", () => {
    expect(reviewNotices({ ...base, status: "cancelled", analysedPlies: 41 })[0]?.text).toBe(
      "Analysis stopped at move 21 of 21."
    );
  });

  it("shows a failed run's error", () => {
    expect(reviewNotices({ ...base, status: "error", error: "Engine crashed" })).toStrictEqual([
      { key: "error", tone: "danger", text: "Engine crashed", analyze: true }
    ]);
  });

  it("names the one move the analysis no longer covers", () => {
    expect(reviewNotices({ ...base, outdatedMoves: 1 })[0]?.text).toBe(
      "The moves changed after this analysis, so it no longer covers 1 move."
    );
  });

  it("counts the moves the analysis no longer covers", () => {
    expect(reviewNotices({ ...base, outdatedMoves: 3 })[0]?.text).toBe(
      "The moves changed after this analysis, so it no longer covers 3 moves."
    );
  });

  it("says when the marks were worked out again from an older analysis", () => {
    expect(reviewNotices({ ...base, recomputed: true })).toStrictEqual([
      {
        key: "recomputed",
        tone: "info",
        text: "Marked again with today's rules. Great and Brilliant need a new analysis.",
        analyze: true
      }
    ]);
  });

  it("stacks the run's notice first and offers Analyze again on the first band only", () => {
    const notices = reviewNotices({
      ...base,
      status: "cancelled",
      analysedPlies: 4,
      outdatedMoves: 2,
      recomputed: true
    });
    expect(notices.map((notice) => [notice.key, notice.analyze])).toStrictEqual([
      ["stopped", true],
      ["outdated", false],
      ["recomputed", false]
    ]);
  });

  it("offers no Analyze again while the game can't be analysed", () => {
    expect(
      reviewNotices({ ...base, outdatedMoves: 2, canAnalyze: false }).map(
        (notice) => notice.analyze
      )
    ).toStrictEqual([false]);
  });
});
