import { describe, expect, it } from "vitest";
import type {
  BroadcastListing,
  BroadcastRound,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import {
  elapsedText,
  hubSections,
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
