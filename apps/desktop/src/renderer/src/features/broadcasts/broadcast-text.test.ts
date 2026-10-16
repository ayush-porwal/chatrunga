import { describe, expect, it } from "vitest";
import type {
  BroadcastListing,
  BroadcastRound,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import {
  elapsedText,
  filterHub,
  hubSections,
  NO_HUB_FILTER,
  podium,
  roundAfter,
  scoreText,
  nameMatches,
  roundStatus,
  startsText,
  timeControlText,
  tourDates
} from "./broadcast-text";

const tour = (overrides: Partial<BroadcastTour> = {}): BroadcastTour => ({
  id: "Tour0001",
  name: "Event",
  slug: "event",
  image: null,
  description: null,
  tier: null,
  dates: null,
  info: {
    format: null,
    timeControl: null,
    fideTimeControl: null,
    location: null,
    players: null,
    website: null,
    standings: null,
    timeZone: null
  },
  url: "https://lichess.org/broadcast/event/Tour0001",
  ...overrides
});

const ROUND: BroadcastRound = {
  id: "Round001",
  name: "Round 1",
  slug: "round-1",
  url: "",
  startsAt: null,
  ongoing: false,
  finished: false
};

const listing = (id: string, ongoing: boolean, startsAt: number | null): BroadcastListing => ({
  tour: tour({ id }),
  round: { ...ROUND, startsAt, ongoing },
  group: null
});

/** A local time ("2026-10-16T12:00"), so the day boundaries match the viewer's. */
const at = (local: string) => new Date(local).getTime();

describe("broadcast text", () => {
  it("points past a finished round to the next, started or not", () => {
    const rounds = [
      { ...ROUND, id: "Round001", finished: true },
      { ...ROUND, id: "Round002", ongoing: true },
      { ...ROUND, id: "Round003" }
    ];
    expect(roundAfter(rounds, "Round001")).toStrictEqual({ round: rounds[1], started: true });
    expect(roundAfter(rounds, "Round002")).toBeNull();
    expect(roundAfter([rounds[0], rounds[2]], "Round001")).toStrictEqual({
      round: rounds[2],
      started: false
    });
    expect(roundAfter(rounds, "Round003")).toBeNull();
  });

  it("writes scores with halves, and puts the first three of the standings on the podium", () => {
    expect([scoreText(8.5), scoreText(0.5), scoreText(3), scoreText(0)]).toStrictEqual([
      "8½",
      "½",
      "3",
      "0"
    ]);
    const row = (name: string, rank: number | null, score: number | null) => ({
      name,
      title: null,
      rating: null,
      federation: null,
      fideId: null,
      rank,
      score,
      played: null,
      performance: null,
      ratingDiff: null
    });
    expect(
      podium([row("C", 3, 6), row("A", 1, 8.5), row("D", null, 9), row("B", 2, 7)])
    ).toStrictEqual([
      { name: "A", score: "8½" },
      { name: "B", score: "7" },
      { name: "C", score: "6" }
    ]);
  });

  it("keeps the events of one speed, or only the official ones", () => {
    const blitz = tour({ id: "Blitz001", info: { ...tour().info, fideTimeControl: "blitz" } });
    const official = tour({
      id: "Offic001",
      tier: 4,
      info: { ...tour().info, fideTimeControl: "standard" }
    });
    const sections = {
      live: [{ tour: blitz, round: ROUND, group: null }],
      upcoming: [{ tour: official, round: ROUND, group: null }],
      past: [{ tour: tour(), round: null, group: null }]
    };
    const ids = (filtered: ReturnType<typeof filterHub>) =>
      [...filtered.live, ...filtered.upcoming, ...filtered.past].map((item) => item.tour.id);
    expect(ids(filterHub(sections, NO_HUB_FILTER))).toStrictEqual([
      "Blitz001",
      "Offic001",
      "Tour0001"
    ]);
    expect(ids(filterHub(sections, { speed: "blitz", officialOnly: false }))).toStrictEqual([
      "Blitz001"
    ]);
    expect(ids(filterHub(sections, { speed: "all", officialOnly: true }))).toStrictEqual([
      "Offic001"
    ]);
  });

  it("splits the active list into live and upcoming, soonest first", () => {
    const sections = hubSections({
      active: [
        listing("Later001", false, 3000),
        listing("LiveNow1", true, 1000),
        listing("Sooner01", false, 2000)
      ],
      past: [],
      nextPastPage: null
    });
    expect(sections.live.map((item) => item.tour.id)).toStrictEqual(["LiveNow1"]);
    expect(sections.upcoming.map((item) => item.tour.id)).toStrictEqual(["Sooner01", "Later001"]);
  });

  it("writes date ranges compactly", () => {
    expect(
      tourDates(tour({ dates: { start: at("2026-10-09T00:00"), end: at("2026-10-21T00:00") } }))
    ).toBe("Oct 9 – 21");
    expect(
      tourDates(tour({ dates: { start: at("2026-10-28T00:00"), end: at("2026-11-03T00:00") } }))
    ).toBe("Oct 28 – Nov 3");
    expect(tourDates(tour({ dates: { start: at("2026-10-09T00:00"), end: null } }))).toBe("Oct 9");
    expect(tourDates(tour())).toBeNull();
  });

  it("says when something starts, relative to now", () => {
    const now = at("2026-10-16T12:00");
    expect(startsText(at("2026-10-16T12:25"), now)).toBe("In 25 min");
    expect(startsText(at("2026-10-16T15:00"), now)).toBe("Today, 15:00");
    expect(startsText(at("2026-10-17T20:00"), now)).toBe("Tomorrow, 20:00");
    expect(startsText(at("2026-10-18T15:00"), now)).toBe("Sun, 15:00");
    expect(startsText(at("2026-10-30T15:00"), now)).toBe("Oct 30");
    expect(startsText(at("2026-10-16T11:00"), now)).toBe("Started");
    expect(elapsedText(now - 112 * 60_000, now)).toBe("1h 52m");
  });

  it("describes rounds and time controls", () => {
    const round = ROUND;
    expect(roundStatus({ ...round, ongoing: true }, 0)).toBe("Live");
    expect(roundStatus({ ...round, finished: true }, 0)).toBe("Finished");
    expect(roundStatus(round, 0)).toBe("Not started");
    expect(
      timeControlText(
        tour({ info: { ...tour().info, fideTimeControl: "standard", timeControl: "90+30" } })
      )
    ).toBe("Classical · 90+30");
  });

  it("matches player names regardless of case, accents and word order", () => {
    expect(nameMatches("Carlsen, Magnus", "magnus carl")).toBe(true);
    expect(nameMatches("Ju Wenjun", "wénjun")).toBe(true);
    expect(nameMatches("Gukesh D", "carlsen")).toBe(false);
  });
});
