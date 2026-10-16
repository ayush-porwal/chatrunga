import type { ReactNode } from "react";
import { CalendarDays, ChevronRight, Clock, MapPin, Radio, RotateCcw } from "lucide-react";
import type {
  BroadcastGame,
  BroadcastListing,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCell, StatStrip } from "@/components/ui/stat-strip";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { sectionTitle } from "@/lib/ui";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { cn } from "@/lib/utils";
import { useBroadcastRoundQuery, useBroadcastTopQuery } from "../../queries/broadcasts";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { LiveBadge, PlayerLine, TourImage } from "./broadcast-parts";
import {
  filterHub,
  hubSections,
  startsText,
  timeControlText,
  tourDates,
  type HubFilter,
  type HubSections
} from "./broadcast-text";
import { BroadcastSearch } from "./BroadcastSearch";
import type { TournamentTarget } from "./navigation";

/** Lichess's broadcast calendar (every upcoming event, beyond the few listed here). */
const CALENDAR_URL = "https://lichess.org/broadcast/calendar";
/** A recently finished event's card, in the section's sideways row. */
const PAST_CARD_WIDTH = "w-56";
/** How often a live event's top board is read again on the hub. */
const PREVIEW_REFRESH_MS = 3 * 60_000;
/**
 * The live events whose top board the hub shows (the first, most prominent ones): each is a
 * request every few minutes, from an anonymous budget of about 30 per 3 minutes for every page.
 */
const PREVIEWED_LIVE = 6;
/** A live card's banner and board: one height, so the row's edges line up. */
const LIVE_CARD_MEDIA = "h-44";
/** Shown for a live event whose top board isn't read. */
const EMPTY_BOARD_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

const cardFrame = "rounded-xl border border-line bg-surface";
/** A banner inside a hovered `group` card leans in a little. */
const zoomOnHover =
  "[&_img]:transition-transform [&_img]:duration-emphasis [&_img]:ease-enter group-hover:[&_img]:scale-[1.04]";

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
  const filter = useBroadcastStore((state) => state.hubFilter);
  const sections = top.data ? filterHub(hubSections(top.data), filter) : null;
  // Skeletons only while loading: after a failure the notice above says why.
  const loading = !sections && !top.isError;
  const open = (listing: BroadcastListing) =>
    onOpenTournament({
      tourId: listing.tour.id,
      roundId: listing.round?.id ?? null,
      focusGameId: null
    });

  return (
    // The page fits the panel (it never scrolls): its sections scroll inside.
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
      <h1 className="sr-only">Broadcasts</h1>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <BroadcastSearch
            liveRoundIds={
              // The rounds the live cards already read (no request of the search's own).
              sections?.live
                .slice(0, PREVIEWED_LIVE)
                .flatMap((listing) => (listing.round ? [listing.round.id] : [])) ?? []
            }
            onOpen={onOpenTournament}
          />
        </div>
        <HubFilters filter={filter} />
      </div>
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
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_var(--side-column)] gap-4">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <LiveSection
            sections={sections}
            loading={loading}
            filtered={filter.speed !== "all" || filter.officialOnly}
            onOpen={open}
          />
          <PastSection past={sections?.past ?? null} loading={loading} onOpen={open} />
        </div>
        <UpcomingRail upcoming={sections?.upcoming ?? null} loading={loading} onOpen={open} />
      </div>
    </div>
  );
}

const SPEEDS: { value: HubFilter["speed"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "standard", label: "Classical" },
  { value: "rapid", label: "Rapid" },
  { value: "blitz", label: "Blitz" }
];

/** Which events every section shows: one speed or all, and only Lichess's official ones. */
function HubFilters({ filter }: { filter: HubFilter }) {
  const setFilter = useBroadcastStore((state) => state.setHubFilter);
  return (
    <>
      <SegmentedControl<HubFilter["speed"]>
        ariaLabel="Speed"
        size="sm"
        value={filter.speed}
        onChange={(speed) => setFilter({ ...filter, speed })}
        options={SPEEDS}
      />
      <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
        <Switch
          checked={filter.officialOnly}
          onCheckedChange={(officialOnly) => setFilter({ ...filter, officialOnly })}
        />
        Official only
      </label>
    </>
  );
}

/** A hub section: a card with its title bar (title, then `aside` at the end) over its content. */
function SectionCard({
  id,
  title,
  aside,
  className,
  children
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(cardFrame, "flex flex-col overflow-hidden", className)}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-4">
        <h2 id={id} className={sectionTitle}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Nothing to show in a section that couldn't load (the page's notice says why). */
const NOT_LOADED = <EmptyState compact title="Not loaded." className="px-4 py-3" />;

/** The events with a round being played, or what comes next when none is. */
function LiveSection({
  sections,
  loading,
  filtered,
  onOpen
}: {
  sections: HubSections | null;
  loading: boolean;
  /** The hub's filter hides some events. */
  filtered: boolean;
  onOpen: (listing: BroadcastListing) => void;
}) {
  const now = useMinuteClock();
  const next = sections?.upcoming.at(0);
  const nextStart = next?.round?.startsAt ?? null;
  return (
    <SectionCard
      id="broadcasts-live"
      title="Live now"
      className="min-h-0 flex-1"
      aside={
        sections ? (
          <span className="text-xs text-fg-subtle">
            {sections.live.length === 1 ? "1 event" : `${sections.live.length} events`}
          </span>
        ) : null
      }
    >
      <div className="scroll-area grid min-h-0 flex-1 content-start overflow-y-auto">
        {!sections ? (
          loading ? (
            <>
              <LiveEventSkeleton />
              <LiveEventSkeleton />
            </>
          ) : (
            NOT_LOADED
          )
        ) : sections.live.length ? (
          sections.live.map((listing, index) => (
            <LiveEventCard
              key={listing.tour.id}
              listing={listing}
              index={index}
              onOpen={() => onOpen(listing)}
            />
          ))
        ) : (
          <EmptyState
            icon={<Radio />}
            title={filtered ? "No live events match the filter" : "No events are live right now"}
            description={
              next && nextStart !== null
                ? `Next up: ${next.tour.name}, ${startsText(nextStart, now).toLowerCase()}`
                : undefined
            }
          />
        )}
      </div>
    </SectionCard>
  );
}

function PastSection({
  past,
  loading,
  onOpen
}: {
  past: BroadcastListing[] | null;
  loading: boolean;
  onOpen: (listing: BroadcastListing) => void;
}) {
  return (
    <SectionCard
      id="broadcasts-past"
      title="Recently finished"
      className="shrink-0"
      aside={
        <Button asChild variant="ghost" size="xs" className="-mr-2">
          <a href="https://lichess.org/broadcast" target="_blank" rel="noreferrer">
            See all
            <ChevronRight />
          </a>
        </Button>
      }
    >
      {past && !past.length ? (
        <EmptyState compact title="No events finished recently." className="px-4 py-3" />
      ) : !past && !loading ? (
        NOT_LOADED
      ) : (
        // One row, scrolling sideways.
        <div className="scroll-area flex gap-4 overflow-x-auto p-4">
          {past
            ? past.map((listing) => (
                <PastEventCard
                  key={listing.tour.id}
                  listing={listing}
                  onOpen={() => onOpen(listing)}
                />
              ))
            : [0, 1, 2].map((key) => (
                <Skeleton key={key} className={cn(PAST_CARD_WIDTH, "aspect-[2/1] rounded-lg")} />
              ))}
        </div>
      )}
    </SectionCard>
  );
}

/** What starts next, soonest first, down the right. */
function UpcomingRail({
  upcoming,
  loading,
  onOpen
}: {
  upcoming: BroadcastListing[] | null;
  loading: boolean;
  onOpen: (listing: BroadcastListing) => void;
}) {
  const now = useMinuteClock();
  return (
    <SectionCard
      id="broadcasts-upcoming"
      title="Upcoming"
      aside={<span className="text-xs text-fg-subtle">Your time zone</span>}
      className="min-h-0"
    >
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
        {!upcoming && !loading ? (
          NOT_LOADED
        ) : !upcoming ? (
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
              className="group flex w-full items-center gap-3 border-b border-line-subtle px-4 py-2.5 text-left transition-colors hover:bg-control focus-visible:bg-control focus-visible:outline-none"
            >
              <TourImage
                src={listing.tour.image}
                className={cn("h-9 w-16 rounded-md [&>svg]:size-3.5", zoomOnHover)}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[0.8125rem] font-semibold text-fg-secondary transition-colors group-hover:text-fg">
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
    </SectionCard>
  );
}

/**
 * An event live now: its banner, where and how it's played, with `preview` its top board (read
 * again every few minutes here, within Lichess's limits for anonymous use; the tournament page
 * follows every move), and the round's progress.
 */
function LiveEventCard({
  listing,
  index,
  onOpen
}: {
  listing: BroadcastListing;
  /** Its place in the list: the first few preview their top board, and they rise in in turn. */
  index: number;
  onOpen: () => void;
}) {
  const { tour, round } = listing;
  const preview = index < PREVIEWED_LIVE;
  const detail = useBroadcastRoundQuery(preview ? (round?.id ?? null) : null, {
    refetchIntervalMs: PREVIEW_REFRESH_MS
  });
  const games = detail.data?.games ?? [];
  const topBoard = games.at(0);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
      className="group relative flex animate-rise-in gap-4 p-4 text-left transition-colors duration-standard hover:bg-control/50 focus-visible:bg-control/50 focus-visible:outline-none [&+&]:border-t [&+&]:border-line-subtle"
    >
      {/* An accent edge slides in on hover. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-3 left-0 w-0.5 origin-center scale-y-0 rounded-full bg-accent transition-transform duration-standard ease-enter group-hover:scale-y-100 group-focus-visible:scale-y-100"
      />
      <TourImage
        src={tour.image}
        className={cn(LIVE_CARD_MEDIA, "w-[min(300px,34%)] rounded-lg", zoomOnHover)}
      >
        <LiveBadge className="absolute top-2.5 left-2.5">
          {round ? `Live · ${round.name}` : "Live"}
        </LiveBadge>
      </TourImage>
      <span className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="grid gap-1.5">
          <span className="truncate text-[0.9375rem] font-semibold text-fg transition-colors group-hover:text-accent-fg">
            {tour.name}
          </span>
          <TourFacts tour={tour} />
        </span>
        {topBoard ? (
          <span className="grid gap-1">
            <PlayerLine player={topBoard.white} color="white" />
            <PlayerLine player={topBoard.black} color="black" />
          </span>
        ) : preview && detail.isPending ? (
          <span className="grid gap-2">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        ) : null}
        <RoundStats listing={listing} games={detail.data?.games ?? null} />
      </span>
      <LiveCardBoard board={topBoard ?? null} loading={preview && detail.isPending} />
    </button>
  );
}

/** A live card's top board, as tall as the banner: an empty board until (or unless) it's read. */
function LiveCardBoard({ board, loading }: { board: BroadcastGame | null; loading: boolean }) {
  return (
    <span
      className={cn(
        LIVE_CARD_MEDIA,
        "hidden aspect-square shrink-0 rounded-md transition-[translate,box-shadow] duration-standard ease-enter group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_24px_-12px_rgb(0_0_0/0.6)] xl:block"
      )}
    >
      {loading ? (
        <Skeleton className="size-full rounded-md" />
      ) : (
        <BoardThumbnail
          fen={board?.fen ?? EMPTY_BOARD_FEN}
          lastMove={board?.lastMove ?? null}
          rounded="md"
          label={board ? `Top board: ${board.white.name} against ${board.black.name}` : undefined}
        />
      )}
    </span>
  );
}

/** Where and how the event is played. */
function TourFacts({ tour }: { tour: BroadcastTour }) {
  const tc = timeControlText(tour);
  return (
    <span className="flex min-w-0 gap-x-3.5 overflow-hidden text-xs whitespace-nowrap text-fg-muted">
      {tour.info.location ? (
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-3.25" />
          {tour.info.location}
        </span>
      ) : null}
      {tc ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Clock aria-hidden="true" className="size-3.25 shrink-0" />
          <span className="truncate">{tc}</span>
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
    <div className="flex gap-4 p-4 [&+&]:border-t [&+&]:border-line-subtle" aria-hidden="true">
      <Skeleton className={cn(LIVE_CARD_MEDIA, "w-[min(300px,34%)] rounded-lg")} />
      <div className="grid flex-1 content-start gap-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className={cn(LIVE_CARD_MEDIA, "hidden aspect-square rounded-md xl:block")} />
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
        PAST_CARD_WIDTH,
        "group flex shrink-0 flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      )}
    >
      <TourImage
        src={tour.image}
        className={cn(
          "aspect-[2/1] w-full rounded-lg ring-1 ring-transparent transition-shadow group-hover:ring-accent/60",
          zoomOnHover
        )}
      />
      <span className="grid gap-0.5 px-0.5">
        <span className="truncate text-sm font-semibold text-fg-secondary transition-colors group-hover:text-fg">
          {tour.name}
        </span>
        <span className="truncate text-xs text-fg-muted">{meta || tour.info.location || " "}</span>
      </span>
    </button>
  );
}
