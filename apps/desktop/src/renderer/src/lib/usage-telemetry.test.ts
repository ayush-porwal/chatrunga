import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMENTARY_VIEW_QUALIFY_MS,
  REVIEW_STUDIED_MOVES
} from "@chaturanga/shared/types/telemetry";
import {
  analyticsGameId,
  analyticsReviewId,
  listenForUserInput,
  reportActivity,
  StudyCounter,
  ViewQualifier
} from "./usage-telemetry";

const timers = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

describe("ViewQualifier (commentary_viewed)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts an explanation kept in view for the qualifying time", () => {
    const viewed = vi.fn();
    const qualifier = new ViewQualifier(COMMENTARY_VIEW_QUALIFY_MS, viewed, timers);
    qualifier.update("r1:5", true);
    vi.advanceTimersByTime(COMMENTARY_VIEW_QUALIFY_MS - 1);
    expect(viewed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(viewed).toHaveBeenCalledWith("r1:5");

    // Staying on it (focus and visibility checks) is the same view.
    qualifier.update("r1:5", true);
    vi.advanceTimersByTime(COMMENTARY_VIEW_QUALIFY_MS * 2);
    expect(viewed).toHaveBeenCalledTimes(1);

    // Coming back to it later is reported again (main keeps it to once per session).
    qualifier.update(null, false);
    qualifier.update("r1:5", true);
    vi.advanceTimersByTime(COMMENTARY_VIEW_QUALIFY_MS);
    expect(viewed).toHaveBeenCalledTimes(2);
  });

  it("moving on, hiding the tab or leaving the window first means it wasn't viewed", () => {
    const viewed = vi.fn();
    const qualifier = new ViewQualifier(COMMENTARY_VIEW_QUALIFY_MS, viewed, timers);
    // An answer arrives, but the user is already on the next move.
    qualifier.update("r1:5", true);
    vi.advanceTimersByTime(500);
    qualifier.update("r1:6", false);
    vi.advanceTimersByTime(COMMENTARY_VIEW_QUALIFY_MS * 2);
    expect(viewed).not.toHaveBeenCalled();

    // In view, then the window loses focus before the time is up.
    qualifier.update("r1:7", true);
    vi.advanceTimersByTime(1_500);
    qualifier.update("r1:7", false);
    vi.advanceTimersByTime(COMMENTARY_VIEW_QUALIFY_MS);
    expect(viewed).not.toHaveBeenCalled();

    // Back in front: the full time starts again.
    qualifier.update("r1:7", true);
    vi.advanceTimersByTime(COMMENTARY_VIEW_QUALIFY_MS);
    expect(viewed).toHaveBeenCalledWith("r1:7");
    qualifier.dispose();
  });

  it("a repeated update for the same candidate doesn't restart the clock", () => {
    const viewed = vi.fn();
    const qualifier = new ViewQualifier(COMMENTARY_VIEW_QUALIFY_MS, viewed, timers);
    qualifier.update("r1:5", true);
    vi.advanceTimersByTime(1_500);
    qualifier.update("r1:5", true);
    vi.advanceTimersByTime(500);
    expect(viewed).toHaveBeenCalledTimes(1);
  });
});

describe("StudyCounter (review_studied)", () => {
  it("fires once per review after enough distinct moves", () => {
    const studied = vi.fn();
    const counter = new StudyCounter(REVIEW_STUDIED_MOVES, studied, 1_000);
    counter.select("r1", "n1", 0);
    counter.select("r1", "n1", 1);
    counter.select("r1", "n2", 2);
    expect(studied).not.toHaveBeenCalled();
    counter.select("r1", "n3", 3);
    expect(studied).toHaveBeenCalledWith("r1");
    counter.select("r1", "n4", 4);
    counter.select("r2", "n1", 5);
    expect(studied).toHaveBeenCalledTimes(1);
  });

  it("after an idle gap, studying the review again takes new selections and fires again", () => {
    const studied = vi.fn();
    const counter = new StudyCounter(REVIEW_STUDIED_MOVES, studied, 1_000);
    for (const [index, move] of ["n1", "n2", "n3"].entries()) counter.select("r1", move, index);
    expect(studied).toHaveBeenCalledTimes(1);
    // Still the same stretch of use: more moves don't count again.
    counter.select("r1", "n4", 900);
    expect(studied).toHaveBeenCalledTimes(1);
    // A new session: one move isn't enough, three are.
    counter.select("r1", "n1", 2_000);
    expect(studied).toHaveBeenCalledTimes(1);
    counter.select("r1", "n2", 2_001);
    counter.select("r1", "n3", 2_002);
    expect(studied).toHaveBeenCalledTimes(2);
  });
});

describe("analytics ids", () => {
  it("passes library and review ids main accepts, nothing else", () => {
    expect(analyticsGameId("V1StGXR8_Z5jdHi6B-myT")).toBe("V1StGXR8_Z5jdHi6B-myT");
    expect(analyticsGameId("3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe(
      "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
    );
    expect(analyticsGameId("/Users/me/game.pgn")).toBeNull();
    expect(analyticsGameId(null)).toBeNull();
    expect(analyticsReviewId("3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe(
      "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
    );
    expect(analyticsReviewId("review-123")).toBeNull();
    expect(analyticsReviewId(undefined)).toBeNull();
  });
});

describe("reportActivity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("needs recent input with the window in front, and only a recorded report spends the throttle", async () => {
    const listeners: Record<string, () => void> = {};
    const track = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
      chaturanga: { telemetry: { track } }
    });
    const doc = { visibilityState: "visible", hasFocus: () => true };
    vi.stubGlobal("document", doc);
    listenForUserInput();

    // No input yet (a restored game, an engine reply): not activity.
    expect(reportActivity("puzzle", performance.now() + 60_000)).toBe(false);
    listeners.pointerdown();
    doc.hasFocus = () => false;
    expect(reportActivity("puzzle")).toBe(false);
    doc.hasFocus = () => true;

    // Collection is off: main doesn't record it, so the next one isn't throttled.
    expect(reportActivity("puzzle")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(reportActivity("puzzle")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // Recorded: further reports of this kind wait out the interval.
    expect(reportActivity("puzzle")).toBe(false);
    expect(track).toHaveBeenCalledTimes(2);
  });
});
