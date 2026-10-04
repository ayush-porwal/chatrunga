import { describe, expect, it } from "vitest";
import {
  applyLichessPerfs,
  applyRatingToAllModes,
  isPlayerRatings,
  normalizePlayerRatings,
  releaseLichessRatings,
  setManualRating,
  uniformRatings,
  type PlayerRatings
} from "./ratings";

const NOW = 1_700_000_000_000;

describe("isPlayerRatings", () => {
  it("accepts a rating for each mode, typed in or synced", () => {
    expect(isPlayerRatings(uniformRatings(1500))).toBe(true);
    expect(
      isPlayerRatings({
        ...uniformRatings(1500),
        blitz: { source: "lichess", rating: 1720, syncedAt: NOW, provisional: true },
        rapid: { source: "manual", rating: 1600, edited: true }
      })
    ).toBe(true);
  });

  it("refuses a missing or extra mode, and malformed ratings", () => {
    const { bullet: _bullet, ...missing } = uniformRatings();
    expect(isPlayerRatings(missing)).toBe(false);
    expect(isPlayerRatings({ ...uniformRatings(), ultraBullet: uniformRatings().rapid })).toBe(
      false
    );
    for (const rapid of [
      { source: "manual", rating: 15.5 },
      { source: "manual", rating: 50 },
      { source: "manual", rating: 4000 },
      { source: "manual", rating: "1500" },
      { source: "lichess", rating: 1500, provisional: false },
      { source: "lichess", rating: 1500, syncedAt: NOW, provisional: "no" },
      { source: "chess.com", rating: 1500 },
      null
    ])
      expect(isPlayerRatings({ ...uniformRatings(), rapid })).toBe(false);
    expect(isPlayerRatings(null)).toBe(false);
    expect(isPlayerRatings([])).toBe(false);
  });
});

describe("normalizePlayerRatings", () => {
  it("keeps good modes and defaults the rest", () => {
    expect(
      normalizePlayerRatings({ blitz: { source: "manual", rating: 1800 }, rapid: "nope" })
    ).toEqual({ ...uniformRatings(1500), blitz: { source: "manual", rating: 1800 } });
    expect(normalizePlayerRatings(undefined)).toEqual(uniformRatings(1500));
  });

  it("is idempotent", () => {
    const ratings = normalizePlayerRatings({ blitz: { source: "manual", rating: 1800 } });
    expect(normalizePlayerRatings(ratings)).toEqual(ratings);
  });
});

describe("applyLichessPerfs", () => {
  const start = uniformRatings(1500);

  it("fills the modes Lichess rates, and leaves the others as they were", () => {
    const next = applyLichessPerfs(
      start,
      {
        blitz: { rating: 1720, games: 300, provisional: false },
        rapid: { rating: 1810, games: 4, provisional: true },
        ultraBullet: { rating: 1300, games: 10, provisional: false }
      },
      NOW
    );
    expect(next).toEqual({
      ...start,
      blitz: { source: "lichess", rating: 1720, syncedAt: NOW, provisional: false },
      rapid: { source: "lichess", rating: 1810, syncedAt: NOW, provisional: true }
    });
  });

  it("keeps a rating typed for the mode over a provisional one, never over a settled one", () => {
    const typed = setManualRating(setManualRating(start, "rapid", 1650), "blitz", 1400);
    const next = applyLichessPerfs(
      typed,
      {
        rapid: { rating: 1900, games: 3, provisional: true },
        blitz: { rating: 1720, games: 300, provisional: false }
      },
      NOW
    );
    expect(next.rapid).toEqual({ source: "manual", rating: 1650, edited: true });
    expect(next.blitz).toEqual({
      source: "lichess",
      rating: 1720,
      syncedAt: NOW,
      provisional: false
    });
  });

  it("updates an earlier sync", () => {
    const synced = applyLichessPerfs(
      start,
      { blitz: { rating: 1720, games: 300, provisional: false } },
      NOW
    );
    expect(
      applyLichessPerfs(
        synced,
        { blitz: { rating: 1731, games: 301, provisional: false } },
        NOW + 1000
      ).blitz
    ).toEqual({ source: "lichess", rating: 1731, syncedAt: NOW + 1000, provisional: false });
  });
});

describe("releaseLichessRatings", () => {
  it("keeps every synced value as a typed-in one", () => {
    const synced: PlayerRatings = applyLichessPerfs(
      uniformRatings(1500),
      {
        blitz: { rating: 1720, games: 300, provisional: false },
        rapid: { rating: 1810, games: 4, provisional: true }
      },
      NOW
    );
    expect(releaseLichessRatings(synced)).toEqual({
      ...uniformRatings(1500),
      blitz: { source: "manual", rating: 1720 },
      rapid: { source: "manual", rating: 1810 }
    });
  });
});

describe("setManualRating / applyRatingToAllModes", () => {
  const synced = applyLichessPerfs(
    uniformRatings(1500),
    {
      blitz: { rating: 1720, games: 300, provisional: false },
      rapid: { rating: 1810, games: 4, provisional: true }
    },
    NOW
  );

  it("edits a typed-in or provisional mode, never a settled synced one", () => {
    expect(setManualRating(synced, "rapid", 1700).rapid).toEqual({
      source: "manual",
      rating: 1700,
      edited: true
    });
    expect(setManualRating(synced, "blitz", 1000)).toBe(synced);
    expect(setManualRating(synced, "bullet", 9000).bullet.rating).toBe(3500);
  });

  it("sets the welcome's rating on every mode but the settled synced ones", () => {
    expect(applyRatingToAllModes(synced, 1234)).toEqual({
      bullet: { source: "manual", rating: 1234 },
      blitz: synced.blitz,
      rapid: { source: "manual", rating: 1234 },
      classical: { source: "manual", rating: 1234 },
      correspondence: { source: "manual", rating: 1234 }
    });
  });
});
