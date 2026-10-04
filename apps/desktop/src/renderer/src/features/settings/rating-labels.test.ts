import { describe, expect, it } from "vitest";
import { ratingSourceLabel, timeAgo } from "./rating-labels";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

describe("timeAgo", () => {
  it("counts minutes, then hours, then days", () => {
    expect(timeAgo(NOW - 20_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(timeAgo(NOW - 125 * MINUTE, NOW)).toBe("2h ago");
    expect(timeAgo(NOW - 50 * 60 * MINUTE, NOW)).toBe("2d ago");
    // A clock set back never reads as the future.
    expect(timeAgo(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });
});

describe("ratingSourceLabel", () => {
  it("labels a synced rating with when it was read", () => {
    const syncedAt = NOW - 2 * 60 * MINUTE;
    expect(
      ratingSourceLabel({ source: "lichess", rating: 1720, syncedAt, provisional: false }, NOW)
    ).toBe("from Lichess · updated 2h ago");
    expect(
      ratingSourceLabel({ source: "lichess", rating: 1810, syncedAt, provisional: true }, NOW)
    ).toBe("provisional on Lichess · updated 2h ago");
  });

  it("has no label for a typed-in rating", () => {
    expect(ratingSourceLabel({ source: "manual", rating: 1500 }, NOW)).toBeNull();
  });
});
