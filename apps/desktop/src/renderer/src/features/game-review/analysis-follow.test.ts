import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnalysisFollower,
  FOLLOW_STEP_MS,
  followTargetIndex,
  type FollowStep
} from "./analysis-follow";

const line = ["root", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
const analysed = (count: number) => line.slice(1, count + 1).map((nodeId) => ({ nodeId }));

describe("followTargetIndex", () => {
  it("is the latest analysed move, or the start before the first", () => {
    expect(followTargetIndex(line, [])).toBe(0);
    expect(followTargetIndex(line, analysed(3))).toBe(3);
    // Moves off the line (an edited game) don't count.
    expect(followTargetIndex(line, [{ nodeId: "m1" }, { nodeId: "elsewhere" }])).toBe(1);
  });
});

describe("analysis follower", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A follower whose board is a variable: every step lands, and comes back as `noteBoard`. */
  function follow(board: string | null = "root") {
    const steps: FollowStep[] = [];
    const paused: boolean[] = [];
    const follower = createAnalysisFollower({
      board,
      show: (step) => {
        steps.push(step);
        follower.noteBoard(step.nodeId, false);
      },
      onPausedChange: (value) => paused.push(value)
    });
    return { follower, steps, paused };
  }

  it("steps to each move as it is analysed, with its sound", () => {
    const { follower, steps } = follow();
    follower.update(line, 0);
    expect(steps).toEqual([]);
    follower.update(line, 1);
    expect(steps).toEqual([{ nodeId: "m1", quiet: false }]);
    vi.advanceTimersByTime(FOLLOW_STEP_MS);
    follower.update(line, 2);
    expect(steps.at(-1)).toEqual({ nodeId: "m2", quiet: false });
    expect(steps).toHaveLength(2);
  });

  it("takes at most one step per interval, and catches up quietly once too far behind", () => {
    const { follower, steps } = follow();
    follower.update(line, 1);
    // A move finishing within the interval waits for it.
    follower.update(line, 2);
    expect(steps).toHaveLength(1);
    vi.advanceTimersByTime(FOLLOW_STEP_MS - 1);
    expect(steps).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(steps.at(-1)).toEqual({ nodeId: "m2", quiet: false });

    // Cached moves finishing at once: two behind still steps, more than two jumps without sound.
    follower.update(line, 4);
    vi.advanceTimersByTime(FOLLOW_STEP_MS);
    expect(steps.at(-1)).toEqual({ nodeId: "m3", quiet: false });
    follower.update(line, 8);
    vi.advanceTimersByTime(FOLLOW_STEP_MS);
    expect(steps.at(-1)).toEqual({ nodeId: "m8", quiet: true });
    expect(steps).toHaveLength(4);
    vi.advanceTimersByTime(FOLLOW_STEP_MS * 4);
    expect(steps).toHaveLength(4);
  });

  it("starts from wherever the board is: a jump from elsewhere is quiet", () => {
    const ahead = follow("m6");
    ahead.follower.update(line, 0);
    expect(ahead.steps).toEqual([{ nodeId: "root", quiet: true }]);
    const onBestLine = follow(null);
    onBestLine.follower.update(line, 1);
    expect(onBestLine.steps).toEqual([{ nodeId: "m1", quiet: true }]);
  });

  it("pauses when the user navigates, and resumes by jumping to the latest analysed move", () => {
    const { follower, steps, paused } = follow();
    follower.update(line, 1);
    follower.update(line, 2);
    // Not a step of its own: the user clicked a move. The step waiting for its turn is dropped.
    follower.noteBoard("root", false);
    follower.update(line, 3);
    vi.advanceTimersByTime(FOLLOW_STEP_MS * 4);
    expect(steps).toHaveLength(1);
    expect(follower.isPaused()).toBe(true);
    expect(paused).toEqual([true]);

    follower.resume();
    expect(paused).toEqual([true, false]);
    expect(steps.at(-1)).toEqual({ nodeId: "m3", quiet: true });
    vi.advanceTimersByTime(FOLLOW_STEP_MS);
    follower.update(line, 4);
    expect(steps.at(-1)).toEqual({ nodeId: "m4", quiet: false });
  });

  it("pauses for a BEST line on the move it shows, and resuming leaves the line", () => {
    const { follower, steps } = follow();
    follower.update(line, 1);
    follower.noteBoard("m1", true);
    expect(follower.isPaused()).toBe(true);
    follower.resume();
    expect(steps.at(-1)).toEqual({ nodeId: "m1", quiet: true });
  });

  it("resuming one move behind is a step with its sound; resuming in place moves nothing", () => {
    const behind = follow();
    behind.follower.update(line, 2);
    behind.follower.noteBoard("root", false);
    behind.follower.noteBoard("m1", false);
    behind.follower.resume();
    expect(behind.steps.at(-1)).toEqual({ nodeId: "m2", quiet: false });
    const inPlace = follow();
    inPlace.follower.update(line, 1);
    inPlace.follower.noteBoard("root", false);
    inPlace.follower.noteBoard("m1", false);
    inPlace.follower.resume();
    expect(inPlace.steps).toHaveLength(1);
    expect(inPlace.follower.isPaused()).toBe(false);
    // Resuming while following does nothing.
    inPlace.follower.resume();
    expect(inPlace.steps).toHaveLength(1);
  });

  it("ends on the last move when the run finishes, unless paused", () => {
    const following = follow();
    following.follower.update(line, 1);
    following.follower.update(line, 2);
    following.follower.finish("m8");
    expect(following.steps.at(-1)).toEqual({ nodeId: "m8", quiet: true });
    // Finished: nothing further moves the board, and the user's navigation no longer pauses.
    vi.advanceTimersByTime(FOLLOW_STEP_MS * 4);
    following.follower.update(line, 3);
    following.follower.noteBoard("m3", false);
    expect(following.steps).toHaveLength(2);
    expect(following.follower.isPaused()).toBe(false);

    const oneBehind = follow("m7");
    oneBehind.follower.update(line, 7);
    oneBehind.follower.finish("m8");
    expect(oneBehind.steps).toEqual([{ nodeId: "m8", quiet: false }]);
    const atEnd = follow("m8");
    atEnd.follower.finish("m8");
    expect(atEnd.steps).toEqual([]);

    const paused = follow();
    paused.follower.update(line, 1);
    paused.follower.noteBoard("root", false);
    paused.follower.finish("m8");
    expect(paused.steps).toHaveLength(1);
  });

  it("drops pending steps when disposed (the run stopped, the page left, a new run)", () => {
    const { follower, steps } = follow();
    follower.update(line, 1);
    follower.update(line, 2);
    follower.dispose();
    vi.advanceTimersByTime(FOLLOW_STEP_MS * 4);
    follower.update(line, 3);
    follower.resume();
    follower.finish("m8");
    expect(steps).toEqual([{ nodeId: "m1", quiet: false }]);
  });

  it("ignores a target outside the line", () => {
    const { follower, steps } = follow();
    follower.update(line, line.length);
    follower.update([], 0);
    expect(steps).toEqual([]);
  });
});
