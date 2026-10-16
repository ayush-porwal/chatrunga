import { ChevronRight } from "lucide-react";
import type { BroadcastListing } from "@chaturanga/shared/types/broadcast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useBroadcastTopQuery } from "../../queries/broadcasts";
import { CardTitleBar } from "../play/card-title";
import { LiveDot, TourImage } from "./broadcast-parts";
import { hubSections, timeControlText } from "./broadcast-text";
import type { TournamentTarget } from "./navigation";

/** The most events the card lists (the Broadcasts page has every one). */
const MAX_EVENTS = 8;

/**
 * Play's "Live broadcasts": the events Lichess relays live now, each opening its tournament, and
 * the way to every broadcast. It reads the Broadcasts page's list (the same request, shared).
 */
export function LiveBroadcastsCard({
  className,
  onOpenTournament,
  onOpenBroadcasts
}: {
  className?: string;
  onOpenTournament: (target: TournamentTarget) => void;
  onOpenBroadcasts: () => void;
}) {
  const top = useBroadcastTopQuery();
  const live = top.data ? hubSections(top.data).live : null;
  return (
    <section
      aria-labelledby="play-broadcasts-title"
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface",
        className
      )}
    >
      <CardTitleBar
        id="play-broadcasts-title"
        title="Live broadcasts"
        count={live?.length ?? null}
        className="border-b border-line-subtle"
        actions={
          <Button variant="ghost" size="xs" onClick={onOpenBroadcasts}>
            See all
            <ChevronRight />
          </Button>
        }
      />
      <div className="scroll-area grid min-h-0 flex-1 content-start overflow-y-auto p-1.5">
        {live ? (
          live.length ? (
            live.slice(0, MAX_EVENTS).map((listing) => (
              <LiveEventRow
                key={listing.tour.id}
                listing={listing}
                onOpen={() =>
                  onOpenTournament({
                    tourId: listing.tour.id,
                    roundId: listing.round?.id ?? null,
                    focusGameId: null
                  })
                }
              />
            ))
          ) : (
            <p className="px-2.5 py-2 text-[0.8125rem] text-fg-muted">
              No events are live right now.
            </p>
          )
        ) : top.isError ? (
          <p className="px-2.5 py-2 text-[0.8125rem] text-fg-muted">Couldn't load broadcasts.</p>
        ) : (
          [0, 1, 2].map((key) => (
            <div key={key} className="flex items-center gap-3 px-2.5 py-2">
              <Skeleton className="h-9 w-16 rounded-md" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function LiveEventRow({ listing, onOpen }: { listing: BroadcastListing; onOpen: () => void }) {
  const { tour, round } = listing;
  const details = [round?.name, timeControlText(tour)?.split(" · ")[0]].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-[9px] px-2.5 py-2 text-left outline-none transition-colors duration-micro hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <TourImage
        src={tour.image}
        className="h-9 w-16 rounded-md [&_img]:transition-transform [&_img]:duration-emphasis [&_img]:ease-enter group-hover:[&_img]:scale-[1.04] [&>svg]:size-3.5"
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[0.8125rem] font-semibold text-fg-secondary transition-colors group-hover:text-fg">
          {tour.name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <LiveDot />
          <span className="truncate">{details || "Live"}</span>
        </span>
      </span>
      <ChevronRight className="size-3.75 shrink-0 text-fg-subtle" aria-hidden="true" />
    </button>
  );
}
