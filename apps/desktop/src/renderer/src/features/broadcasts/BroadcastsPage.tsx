import { CalendarDays, ChevronRight, Clock, MapPin, Radio, RotateCcw } from "lucide-react";
import type {
  BroadcastGame,
  BroadcastListing,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCell, StatStrip } from "@/components/ui/stat-strip";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { pageShell, sectionTitle } from "@/lib/ui";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { cn } from "@/lib/utils";
import { useBroadcastRoundQuery, useBroadcastTopQuery } from "../../queries/broadcasts";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { LiveBadge, PlayerLine, TourImage } from "./broadcast-parts";
import {
  hubSections,
  startsText,
  timeControlText,
  tourDates,
  type HubSections
} from "./broadcast-text";
import { BroadcastSearch } from "./BroadcastSearch";
import type { TournamentTarget } from "./navigation";

/** Lichess's broadcast calendar (every upcoming event, beyond the few listed here). */
const CALENDAR_URL = "https://lichess.org/broadcast/calendar";
const PAST_SHOWN = 6;
/** How often a live event's top board is read again on the hub. */
const PREVIEW_REFRESH_MS = 3 * 60_000;

const cardFrame = "rounded-xl border border-line bg-surface";

/**
 * Broadcasts: over-the-board events relayed live by Lichess. A workspace like Play (it fills the
 * panel): the search over the top, events live now with their top board, recently finished
 * ones, and what's coming next down the right.
 */
export function BroadcastsPage({
  onOpenTournament
}: {
  onOpenTournament: (target: TournamentTarget) => void;
}) {
  const top = useBroadcastTopQuery();
  const sections = top.data ? hubSections(top.data) : null;
  const open = (listing: BroadcastListing) =>
    onOpenTournament({
      tourId: listing.tour.id,
      roundId: listing.round?.id ?? null,
      focusGameId: null
    });

  return (
    <div className={pageShell}>
      <div className="flex min-h-full flex-col gap-4 p-6">
        <h1 className="sr-only">Broadcasts</h1>
        <BroadcastSearch
          liveRoundIds={
            sections?.live.flatMap((listing) => (listing.round ? [listing.round.id] : [])) ?? []
          }
          onOpen={onOpenTournament}
        />
        {top.isError ? (
          <Notice
            tone="danger"
            title="Couldn't load broadcasts"
            action={
              <Button size="xs" onClick={() => void top.refetch()}>
                <RotateCcw />
                Try again
              </Button>
            }
          >
            {ipcErrorMessage(top.error)}
          </Notice>
        ) : null}
        <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <LiveSection sections={sections} onOpen={open} />
            <PastSection past={sections?.past ?? null} onOpen={open} />
          </div>
          <UpcomingRail upcoming={sections?.upcoming ?? null} onOpen={open} />
        </div>
      </div>
    </div>
  );
}

/** The events with a round being played, or what comes next when none is. */
function LiveSection({
  sections,
  onOpen
}: {
  sections: HubSections | null;
  onOpen: (listing: BroadcastListing) => void;
}) {
  const now = useMinuteClock();
  const next = sections?.upcoming.at(0);
  const nextStart = next?.round?.startsAt ?? null;
  return (
    <section aria-labelledby="broadcasts-live" className="grid gap-2.5">
      <div className="flex min-h-7 items-center gap-2">
        <h2 id="broadcasts-live" className={sectionTitle}>
          Live now
        </h2>
        {sections ? (
          <span className="text-xs text-fg-muted">
            {sections.live.length === 1 ? "1 event" : `${sections.live.length} events`}
          </span>
        ) : null}
      </div>
      {!sections ? (
        <>
          <LiveEventSkeleton />
          <LiveEventSkeleton />
        </>
      ) : sections.live.length ? (
        sections.live.map((listing) => (
          <LiveEventCard key={listing.tour.id} listing={listing} onOpen={() => onOpen(listing)} />
        ))
      ) : (
        <div className={cardFrame}>
          <EmptyState
            icon={<Radio />}
            title="No events are live right now"
            description={
              next && nextStart !== null
                ? `Next up: ${next.tour.name}, ${startsText(nextStart, now).toLowerCase()}`
                : undefined
            }
          />
        </div>
      )}
    </section>
  );
}

function PastSection({
  past,
  onOpen
}: {
  past: BroadcastListing[] | null;
  onOpen: (listing: BroadcastListing) => void;
}) {
  return (
    <section aria-labelledby="broadcasts-past" className="grid gap-2.5">
      <div className="flex min-h-7 items-center justify-between">
        <h2 id="broadcasts-past" className={sectionTitle}>
          Recently finished
        </h2>
        <Button asChild variant="ghost" size="xs">
          <a href="https://lichess.org/broadcast" target="_blank" rel="noreferrer">
            See all
            <ChevronRight />
          </a>
        </Button>
      </div>
      {past && !past.length ? <EmptyState compact title="No events finished recently." /> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {past
          ? past
              .slice(0, PAST_SHOWN)
              .map((listing) => (
                <PastEventCard
                  key={listing.tour.id}
                  listing={listing}
                  onOpen={() => onOpen(listing)}
                />
              ))
          : [0, 1, 2].map((key) => <Skeleton key={key} className="h-48 rounded-xl" />)}
      </div>
    </section>
  );
}

/** What starts next, soonest first, down the right. */
function UpcomingRail({
  upcoming,
  onOpen
}: {
  upcoming: BroadcastListing[] | null;
  onOpen: (listing: BroadcastListing) => void;
}) {
  const now = useMinuteClock();
  return (
    <section
      aria-labelledby="broadcasts-upcoming"
      className={cn(
        cardFrame,
        "flex min-h-0 flex-col overflow-hidden lg:max-h-[calc(100vh-9.5rem)]"
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-subtle px-4">
        <h2 id="broadcasts-upcoming" className={sectionTitle}>
          Upcoming
        </h2>
        <span className="text-xs text-fg-subtle">Your time zone</span>
      </div>
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
        {!upcoming ? (
          [0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5"
            >
              <Skeleton className="h-9 w-16 rounded-md" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))
        ) : upcoming.length ? (
          upcoming.map((listing) => (
            <button
              key={listing.tour.id}
              type="button"
              onClick={() => onOpen(listing)}
              className="flex w-full items-center gap-3 border-b border-line-subtle px-4 py-2.5 text-left transition-colors hover:bg-control focus-visible:bg-control focus-visible:outline-none"
            >
              <TourImage
                src={listing.tour.image}
                className="h-9 w-16 rounded-md [&>svg]:size-3.5"
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[0.8125rem] font-semibold text-fg-secondary">
                  {listing.tour.name}
                </span>
                <span className="truncate text-xs text-fg-muted">
                  {[
                    listing.round?.startsAt ? startsText(listing.round.startsAt, now) : null,
                    timeControlText(listing.tour)
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          ))
        ) : (
          <EmptyState compact title="Nothing scheduled yet." className="px-4" />
        )}
      </div>
      <Button
        asChild
        variant="ghost"
        className="h-11 shrink-0 rounded-none border-t border-line-subtle"
      >
        <a href={CALENDAR_URL} target="_blank" rel="noreferrer">
          <CalendarDays />
          Full calendar
        </a>
      </Button>
    </section>
  );
}

/**
 * An event live now: its banner, where and how it's played, its top board (read again every few
 * minutes here, within Lichess's limits for anonymous use; the tournament page follows every
 * move), and the round's progress.
 */
function LiveEventCard({ listing, onOpen }: { listing: BroadcastListing; onOpen: () => void }) {
  const { tour, round } = listing;
  const detail = useBroadcastRoundQuery(round?.id ?? null, {
    refetchIntervalMs: PREVIEW_REFRESH_MS
  });
  const games = detail.data?.games ?? [];
  const topBoard = games.at(0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        cardFrame,
        "flex gap-4 p-4 text-left transition-[border-color] duration-micro hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      )}
    >
      <TourImage src={tour.image} className="aspect-video w-[min(300px,34%)] rounded-lg">
        <LiveBadge className="absolute top-2.5 left-2.5">
          {round ? `Live · ${round.name}` : "Live"}
        </LiveBadge>
      </TourImage>
      <span className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="grid gap-1.5">
          <span className="truncate text-[0.9375rem] font-semibold text-fg">{tour.name}</span>
          <TourFacts tour={tour} />
        </span>
        {topBoard ? (
          <span className="grid gap-1">
            <PlayerLine player={topBoard.white} color="white" />
            <PlayerLine player={topBoard.black} color="black" />
          </span>
        ) : detail.isPending ? (
          <span className="grid gap-2">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        ) : null}
        <RoundStats listing={listing} games={detail.data?.games ?? null} />
      </span>
      {topBoard ? (
        <span className="hidden w-[min(170px,22%)] shrink-0 xl:block">
          <BoardThumbnail
            fen={topBoard.fen}
            lastMove={topBoard.lastMove}
            rounded="md"
            label={`Top board: ${topBoard.white.name} against ${topBoard.black.name}`}
          />
        </span>
      ) : null}
    </button>
  );
}

/** Where and how the event is played. */
function TourFacts({ tour }: { tour: BroadcastTour }) {
  const tc = timeControlText(tour);
  return (
    <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-fg-muted">
      {tour.info.location ? (
        <span className="inline-flex items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-3.25" />
          {tour.info.location}
        </span>
      ) : null}
      {tc ? (
        <span className="inline-flex items-center gap-1.5">
          <Clock aria-hidden="true" className="size-3.25" />
          {tc}
        </span>
      ) : null}
    </span>
  );
}

/** The round, its boards still playing, and the event's last day. */
function RoundStats({
  listing,
  games
}: {
  listing: BroadcastListing;
  games: readonly BroadcastGame[] | null;
}) {
  const { tour, round } = listing;
  const ends = tour.dates?.end ?? tour.dates?.start ?? null;
  const liveBoards = games?.filter((game) => game.result === "*").length ?? 0;
  return (
    <StatStrip className="mt-auto grid-cols-3">
      <StatCell label="Round" size="sm">
        {round?.name.replace(/^Round\s+/i, "") ?? "–"}
      </StatCell>
      <StatCell label="Live boards" size="sm">
        {games ? `${liveBoards} / ${games.length}` : "–"}
      </StatCell>
      <StatCell label="Ends" size="sm">
        {ends === null ? "–" : DAY_MONTH.format(ends)}
      </StatCell>
    </StatStrip>
  );
}

const DAY_MONTH = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

function LiveEventSkeleton() {
  return (
    <div className={cn(cardFrame, "flex gap-4 p-4")} aria-hidden="true">
      <Skeleton className="aspect-video w-[min(300px,34%)] rounded-lg" />
      <div className="grid flex-1 content-start gap-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

function PastEventCard({ listing, onOpen }: { listing: BroadcastListing; onOpen: () => void }) {
  const { tour } = listing;
  const meta = [timeControlText(tour)?.split(" · ")[0], tourDates(tour)]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        cardFrame,
        "flex flex-col overflow-hidden text-left transition-[border-color] duration-micro hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      )}
    >
      <TourImage src={tour.image} className="aspect-[2/1] w-full" />
      <span className="grid gap-0.5 px-3.5 pt-2.5 pb-3">
        <span className="truncate text-sm font-semibold text-fg-secondary">{tour.name}</span>
        <span className="truncate text-xs text-fg-muted">{meta || tour.info.location || " "}</span>
      </span>
    </button>
  );
}
