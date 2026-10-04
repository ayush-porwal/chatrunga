import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCommentary } from "@chaturanga/shared/types/engine";
import {
  COMMENTARY_DEBOUNCE_MS,
  CommentaryScheduler,
  commentarySettingsKey,
  canRequestCommentary,
  decideCommentary,
  isCurrentCommentary,
  writtenForEarlierMarks
} from "./commentary-scheduler";

const key = commentarySettingsKey({
  model: "m",
  detail: "balanced",
  userRating: 1500,
  playerColor: "white"
});

function ai(overrides: Partial<ReviewCommentary> = {}): ReviewCommentary {
  return { ply: 1, prose: "AI", generatedAt: 1, providerModel: "m", ...overrides };
}

const base = {
  active: true,
  enabled: true,
  configLoading: false,
  hasApiKey: true,
  hasPayload: true,
  cached: undefined,
  settingsKey: key,
  failed: false
};

describe("decideCommentary", () => {
  it("requests only for an active, uncached move with a saved key", () => {
    expect(decideCommentary(base)).toBe("request");
    expect(decideCommentary({ ...base, active: false })).toBe("idle");
    expect(decideCommentary({ ...base, configLoading: true })).toBe("waiting");
    expect(decideCommentary({ ...base, hasApiKey: false })).toBe("no-key");
    expect(decideCommentary({ ...base, hasPayload: false })).toBe("no-payload");
    expect(decideCommentary({ ...base, failed: true })).toBe("failed");
  });

  it("never requests when commentary is off", () => {
    expect(decideCommentary({ ...base, enabled: false })).toBe("off");
  });

  it("uses cached AI commentary, including older saved entries without a settings key", () => {
    expect(decideCommentary({ ...base, cached: ai({ settingsKey: key }) })).toBe("cached");
    expect(decideCommentary({ ...base, cached: ai() })).toBe("cached");
    // A cached explanation still shows after the key is removed.
    expect(decideCommentary({ ...base, hasApiKey: false, cached: ai() })).toBe("cached");
  });

  it("re-requests when the cached entry was made with other settings", () => {
    expect(decideCommentary({ ...base, cached: ai({ settingsKey: "other" }) })).toBe("request");
  });

  it("fingerprints every setting that changes the prose, compatible with keys saved by older builds", () => {
    expect(key).toBe("openrouter|m|balanced|1500|white");
    const other = commentarySettingsKey({
      model: "m",
      detail: "detailed",
      userRating: 1500,
      playerColor: "white"
    });
    expect(other).not.toBe(key);
    expect(isCurrentCommentary(ai({ settingsKey: key }), other)).toBe(false);
  });
});

describe("CommentaryScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const job = (id: string, calls: string[], wait?: Promise<void>) => ({
    key: id,
    run: async () => {
      calls.push(id);
      await wait;
    }
  });

  it("debounces scrubbing so only the move the user settles on is requested", async () => {
    const calls: string[] = [];
    const scheduler = new CommentaryScheduler();
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
      scheduler.schedule(job(id, calls));
      await vi.advanceTimersByTimeAsync(80);
    }
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(COMMENTARY_DEBOUNCE_MS);
    expect(calls).toEqual(["p5"]);
  });

  it("does not restart the debounce when the same move re-renders", async () => {
    const calls: string[] = [];
    const scheduler = new CommentaryScheduler();
    scheduler.schedule(job("p1", calls));
    await vi.advanceTimersByTimeAsync(COMMENTARY_DEBOUNCE_MS - 100);
    scheduler.schedule(job("p1", calls));
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["p1"]);
  });

  it("cancels a pending request when the move leaves view", async () => {
    const calls: string[] = [];
    const scheduler = new CommentaryScheduler();
    scheduler.schedule(job("p1", calls));
    scheduler.schedule(null);
    await vi.advanceTimersByTimeAsync(COMMENTARY_DEBOUNCE_MS * 2);
    expect(calls).toEqual([]);
  });

  it("never runs the same request twice at once", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = new CommentaryScheduler();
    scheduler.runNow(job("p1", calls, gate));
    scheduler.schedule(job("p1", calls, gate));
    scheduler.runNow(job("p1", calls, gate));
    await vi.advanceTimersByTimeAsync(COMMENTARY_DEBOUNCE_MS * 2);
    expect(calls).toEqual(["p1"]);
    expect(scheduler.isBusy("p1")).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.isBusy("p1")).toBe(false);
  });

  it("stops pending work on dispose", async () => {
    const calls: string[] = [];
    const scheduler = new CommentaryScheduler();
    scheduler.schedule(job("p1", calls));
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(COMMENTARY_DEBOUNCE_MS * 2);
    expect(calls).toEqual([]);
  });
});

describe("commentary written before the current move marks", () => {
  it("is told apart by the coach payload it was written from, and still shows rather than being requested again", () => {
    expect(writtenForEarlierMarks(ai())).toBe(true);
    expect(writtenForEarlierMarks(ai({ payloadVersion: 1 }))).toBe(true);
    expect(writtenForEarlierMarks(ai({ payloadVersion: 2 }))).toBe(false);
    expect(writtenForEarlierMarks(undefined)).toBe(false);
    // Paid-for text is never thrown away or re-requested automatically.
    expect(decideCommentary({ ...base, cached: ai(), settingsKey: key })).toBe("cached");
  });

  it("is written again by hand only when an automatic request could be made", () => {
    expect(canRequestCommentary(base)).toBe(true);
    // Switched off, configuration still loading, no key, or nothing to send: no paid request.
    expect(canRequestCommentary({ ...base, enabled: false })).toBe(false);
    expect(canRequestCommentary({ ...base, configLoading: true })).toBe(false);
    expect(canRequestCommentary({ ...base, hasApiKey: false })).toBe(false);
    expect(canRequestCommentary({ ...base, hasPayload: false })).toBe(false);
  });
});
