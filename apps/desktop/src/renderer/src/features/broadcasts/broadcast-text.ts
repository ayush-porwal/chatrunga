import type {
  BroadcastFideTimeControl,
  BroadcastListing,
  BroadcastPlayer,
  BroadcastResult,
  BroadcastRound,
  BroadcastStanding,
  BroadcastTopPage,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";

/** The hub's sections: events live now, those coming next (soonest first), recently finished. */
export type HubSections = {
  live: BroadcastListing[];
  upcoming: BroadcastListing[];
  past: BroadcastListing[];
};

/**
 * Lichess's top list has the active tournaments together: those with a round being played are
 * live, the rest are between rounds or about to start (upcoming, by their next round's start).
 */
export function hubSections(page: BroadcastTopPage): HubSections {
  const live = page.active.filter((listing) => listing.round?.ongoing);
  const upcoming = page.active
    .filter((listing) => !listing.round?.ongoing)
    .sort((a, b) => startOf(a) - startOf(b));
  return { live, upcoming, past: page.past };
}

/** What the hub shows: one speed (FIDE's category) or all, and only Lichess's official events. */
export type HubFilter = { speed: BroadcastFideTimeControl | "all"; officialOnly: boolean };

export const NO_HUB_FILTER: HubFilter = { speed: "all", officialOnly: false };

/** The sections with only the events `filter` keeps (official: ranked by Lichess). */
export function filterHub(sections: HubSections, filter: HubFilter): HubSections {
  const keep = ({ tour }: BroadcastListing) =>
    (filter.speed === "all" || tour.info.fideTimeControl === filter.speed) &&
    (!filter.officialOnly || tour.tier !== null);
  return {
    live: sections.live.filter(keep),
    upcoming: sections.upcoming.filter(keep),
    past: sections.past.filter(keep)
  };
}

function startOf(listing: BroadcastListing): number {
  return listing.round?.startsAt ?? listing.tour.dates?.start ?? Number.MAX_SAFE_INTEGER;
}

const dayMonth = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const dayOnly = new Intl.DateTimeFormat("en", { day: "numeric" });
const weekday = new Intl.DateTimeFormat("en", { weekday: "short" });
const timeOnly = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** "Oct 9 – 21", "Oct 28 – Nov 3", "Oct 9" for one day; null without dates. */
export function tourDates(tour: BroadcastTour): string | null {
  if (!tour.dates) return null;
  const start = new Date(tour.dates.start);
  if (tour.dates.end === null) return dayMonth.format(start);
  const end = new Date(tour.dates.end);
  if (dayMonth.format(start) === dayMonth.format(end)) return dayMonth.format(start);
  return sameMonth(start, end)
    ? `${dayMonth.format(start)} – ${dayOnly.format(end)}`
    : `${dayMonth.format(start)} – ${dayMonth.format(end)}`;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * When something starts, in the viewer's time: "In 25 min", "Today, 15:00", "Tomorrow, 20:00",
 * "Sun, 15:00" this week, else "Oct 23". "Started" once past.
 */
export function startsText(startsAt: number, now: number): string {
  const delta = startsAt - now;
  if (delta <= 0) return "Started";
  if (delta < 60 * 60_000) return `In ${Math.max(1, Math.round(delta / 60_000))} min`;
  const days = Math.round((startOfDay(startsAt) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `Today, ${timeOnly.format(startsAt)}`;
  if (days === 1) return `Tomorrow, ${timeOnly.format(startsAt)}`;
  if (days < 7) return `${weekday.format(startsAt)}, ${timeOnly.format(startsAt)}`;
  return dayMonth.format(startsAt);
}

/** How long ago something started: "12 min", "1h 52m". */
export function elapsedText(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A round's state for its picker and header: "Live", "Finished", or when it starts. */
export function roundStatus(round: BroadcastRound, now: number): string {
  if (round.ongoing) return "Live";
  if (round.finished) return "Finished";
  return round.startsAt === null ? "Not started" : startsText(round.startsAt, now);
}

/** The time control in a few words: "Classical · 90+30", or whichever part is known. */
export function timeControlText(tour: BroadcastTour): string | null {
  const category = tour.info.fideTimeControl;
  const label =
    category === "standard"
      ? "Classical"
      : category === "rapid"
        ? "Rapid"
        : category === "blitz"
          ? "Blitz"
          : null;
  const parts = [label, tour.info.timeControl].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : null;
}

export function resultText(result: BroadcastResult): string {
  return result === "*" ? "Live" : result.replace("-", "–");
}

/** A player as a line of a list: "GM Carlsen, Magnus". */
export function playerLabel(player: BroadcastPlayer): string {
  return player.title ? `${player.title} ${player.name}` : player.name;
}

/** Whether a player's name matches a search (case- and accent-insensitive, any word order part). */
export function nameMatches(name: string, query: string): boolean {
  const fold = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const haystack = fold(name);
  return fold(query)
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** A chess score: 8.5 → "8½", 0.5 → "½", 3 → "3". */
export function scoreText(score: number): string {
  const whole = Math.floor(score);
  const half = score - whole >= 0.5;
  return half ? `${whole || ""}½` : String(whole);
}

/** The first three of a tournament's standings (by rank, else by score), with their scores. */
export function podium(
  rows: readonly BroadcastStanding[]
): { name: string; score: string | null }[] {
  const order = (row: BroadcastStanding) => row.rank ?? Number.MAX_SAFE_INTEGER;
  return [...rows]
    .sort((a, b) => order(a) - order(b) || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
    .map((row) => ({ name: row.name, score: row.score === null ? null : scoreText(row.score) }));
}

/**
 * The round after `roundId` once that one is finished: started already, or still to start. Null
 * while it is being played (or not started), or after the last round.
 */
export function roundAfter(
  rounds: readonly BroadcastRound[],
  roundId: string | null
): { round: BroadcastRound; started: boolean } | null {
  const index = rounds.findIndex((round) => round.id === roundId);
  const next = index < 0 ? undefined : rounds[index + 1];
  if (!rounds[index]?.finished || !next || next.finished) return null;
  return { round: next, started: next.ongoing };
}
