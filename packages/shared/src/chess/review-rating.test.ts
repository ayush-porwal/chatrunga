import { describe, expect, it } from "vitest";
import { uniformRatings, type PlayerRatings } from "../types/ratings";
import {
  lichessSpeedForClock,
  lichessSpeedFromHeaders,
  nearestMaiaModel,
  parseGameRating,
  ratingModeForTimeControl,
  resolveGameReviewRating,
  resolveReviewRating
} from "./review-rating";

/** A distinct rating per mode, so a test can tell which one was read. */
const ratings: PlayerRatings = {
  bullet: { source: "manual", rating: 1100 },
  blitz: { source: "manual", rating: 1200 },
  rapid: { source: "manual", rating: 1300 },
  classical: { source: "lichess", rating: 1400, syncedAt: 1 },
  correspondence: { source: "manual", rating: 1500 }
};

describe("lichessSpeedForClock", () => {
  it("puts base + 40 × increment against Lichess's boundaries", () => {
    expect(lichessSpeedForClock(15, 0)).toBe("ultraBullet");
    expect(lichessSpeedForClock(29, 0)).toBe("ultraBullet");
    expect(lichessSpeedForClock(30, 0)).toBe("bullet");
    expect(lichessSpeedForClock(60, 1)).toBe("bullet"); // 100 s
  });

  it("counts the increment forty times", () => {
    expect(lichessSpeedForClock(120, 1)).toBe("bullet"); // 160 s
    expect(lichessSpeedForClock(180, 0)).toBe("blitz");
    expect(lichessSpeedForClock(180, 2)).toBe("blitz"); // 260 s
    expect(lichessSpeedForClock(300, 3)).toBe("blitz"); // 420 s
    expect(lichessSpeedForClock(300, 5)).toBe("rapid"); // 500 s
    expect(lichessSpeedForClock(479, 0)).toBe("blitz");
    expect(lichessSpeedForClock(480, 0)).toBe("rapid");
    expect(lichessSpeedForClock(900, 10)).toBe("rapid"); // 1300 s
    expect(lichessSpeedForClock(1500, 0)).toBe("classical");
    expect(lichessSpeedForClock(1800, 20)).toBe("classical");
    expect(lichessSpeedForClock(21_600, 0)).toBe("correspondence");
  });
});

describe("ratingModeForTimeControl", () => {
  it("reads base+increment and a bare base, in seconds", () => {
    expect(ratingModeForTimeControl("60+0")).toBe("bullet");
    expect(ratingModeForTimeControl("180+2")).toBe("blitz");
    expect(ratingModeForTimeControl("600+5")).toBe("rapid");
    expect(ratingModeForTimeControl("1800")).toBe("classical");
  });

  it("rates UltraBullet with bullet", () => {
    expect(ratingModeForTimeControl("15+0")).toBe("bullet");
  });

  it("reads a sandclock and the first period of moves/seconds", () => {
    expect(ratingModeForTimeControl("*180")).toBe("blitz");
    expect(ratingModeForTimeControl("40/7200:3600")).toBe("classical");
    expect(ratingModeForTimeControl("1/259200")).toBe("correspondence");
    expect(ratingModeForTimeControl("1/86400")).toBe("correspondence");
  });

  it("has no mode without a time control, or one it can't read", () => {
    for (const tag of [null, undefined, "", " ", "-", "?", "fast", "0/600"])
      expect(ratingModeForTimeControl(tag)).toBeNull();
  });
});

describe("parseGameRating", () => {
  it("reads PGN Elo tags and numbers", () => {
    expect(parseGameRating("1533")).toBe(1533);
    expect(parseGameRating(" 2010 ")).toBe(2010);
    expect(parseGameRating(1702)).toBe(1702);
  });

  it("refuses unknown and implausible ratings", () => {
    for (const value of [null, undefined, "", "?", "-", "0", "abc", "15.5", 0, -3, 1.5, 9999])
      expect(parseGameRating(value)).toBeNull();
  });
});

describe("nearestMaiaModel", () => {
  it("rounds to the nearest 100 within 1100–1900 without a list", () => {
    expect(nearestMaiaModel(1533)).toBe(1500);
    expect(nearestMaiaModel(1550)).toBe(1600);
    expect(nearestMaiaModel(1000)).toBe(1100);
    expect(nearestMaiaModel(400)).toBe(1100);
    expect(nearestMaiaModel(2400)).toBe(1900);
  });

  it("picks the nearest installed model, the lower on a tie", () => {
    const installed = [1100, 1300, 1500, 1700, 1900];
    expect(nearestMaiaModel(1533, installed)).toBe(1500);
    expect(nearestMaiaModel(1650, installed)).toBe(1700);
    expect(nearestMaiaModel(1400, installed)).toBe(1300);
    expect(nearestMaiaModel(2500, [1500])).toBe(1500);
  });

  it("has no model when none is installed", () => {
    expect(nearestMaiaModel(1500, [])).toBeNull();
  });
});

describe("resolveReviewRating", () => {
  it("uses the game's own rating for the reviewed side first", () => {
    expect(
      resolveReviewRating({
        side: "black",
        gameRatings: { white: "2100", black: "1533" },
        timeControl: "180+2",
        ratings
      })
    ).toEqual({ rating: 1533, source: "game", mode: "blitz", maiaModel: 1500 });
  });

  it("reads the Settings rating for the game's mode when the side has no rating", () => {
    expect(
      resolveReviewRating({
        side: "white",
        gameRatings: { white: "?", black: "1800" },
        timeControl: "180+2",
        ratings
      })
    ).toEqual({ rating: 1200, source: "settings", mode: "blitz", maiaModel: 1200 });
    expect(resolveReviewRating({ side: "white", timeControl: "1800+30", ratings })).toMatchObject({
      rating: 1400,
      mode: "classical"
    });
  });

  it("counts a game without a time control as rapid", () => {
    for (const timeControl of [null, "-", "?"])
      expect(resolveReviewRating({ side: "white", timeControl, ratings })).toMatchObject({
        rating: 1300,
        source: "settings",
        mode: "rapid"
      });
  });

  it("prefers the Lichess game's speed over the TimeControl tag", () => {
    expect(
      resolveReviewRating({ side: "white", timeControl: "-", speed: "correspondence", ratings })
    ).toMatchObject({ rating: 1500, mode: "correspondence" });
    expect(resolveReviewRating({ side: "white", speed: "ultraBullet", ratings })).toMatchObject({
      rating: 1100,
      mode: "bullet"
    });
  });

  it("rounds to the installed Maia model, and has none without Maia", () => {
    const low = { ...uniformRatings(1000) };
    expect(resolveReviewRating({ side: "white", ratings: low })).toMatchObject({
      rating: 1000,
      maiaModel: 1100
    });
    expect(
      resolveReviewRating({ side: "white", ratings: low, installedMaiaModels: [1500, 1900] })
    ).toMatchObject({ maiaModel: 1500 });
    expect(
      resolveReviewRating({ side: "white", ratings: low, installedMaiaModels: [] })
    ).toMatchObject({ rating: 1000, maiaModel: null });
  });
});

describe("lichessSpeedFromHeaders", () => {
  it("reads the speed from a Lichess game's Event tag", () => {
    const site = "https://lichess.org/abcdefgh";
    expect(lichessSpeedFromHeaders({ event: "Rated Blitz game", site })).toBe("blitz");
    expect(lichessSpeedFromHeaders({ event: "Casual Correspondence game", site })).toBe(
      "correspondence"
    );
    expect(lichessSpeedFromHeaders({ event: "Rated UltraBullet game", site })).toBe("ultraBullet");
    expect(lichessSpeedFromHeaders({ event: "Rated Rapid game", site: null }, "lichess")).toBe(
      "rapid"
    );
  });

  it("ignores the Event tag of a game from anywhere else", () => {
    expect(lichessSpeedFromHeaders({ event: "Blitz Open", site: "Berlin" }, "pgn-import")).toBe(
      null
    );
    expect(lichessSpeedFromHeaders({ event: "Rated game", site: "https://lichess.org/x" })).toBe(
      null
    );
  });
});

describe("resolveGameReviewRating", () => {
  it("resolves from a game's headers", () => {
    expect(
      resolveGameReviewRating({
        headers: {
          event: "Rated Correspondence game",
          site: "https://lichess.org/abcdefgh",
          whiteElo: "1650",
          blackElo: null,
          timeControl: "-"
        },
        source: "lichess",
        side: "black",
        ratings,
        installedMaiaModels: [1100, 1300, 1500, 1700, 1900]
      })
    ).toEqual({ rating: 1500, source: "settings", mode: "correspondence", maiaModel: 1500 });
  });

  it("reads an engine game's clock from the TimeControl tag it was saved with", () => {
    expect(
      resolveGameReviewRating({
        headers: { whiteElo: null, blackElo: null, timeControl: "300+3" },
        source: "engine-game",
        side: "white",
        ratings
      })
    ).toMatchObject({ rating: 1200, source: "settings", mode: "blitz" });
  });
});
