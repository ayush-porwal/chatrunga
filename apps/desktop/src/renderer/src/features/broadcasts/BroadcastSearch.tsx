import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import type { BroadcastListing } from "@chaturanga/shared/types/broadcast";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { MIN_SEARCH_LENGTH, useBroadcastSearchQuery } from "../../queries/broadcasts";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { LiveDot, TourImage } from "./broadcast-parts";
import { nameMatches, tourDates } from "./broadcast-text";
import type { TournamentTarget } from "./navigation";
import { roundGamesWhere, useRoundsRead, type RoundGameEntry } from "./round-games";

/** Results shown per group. */
const MAX_GAMES = 5;
const MAX_EVENTS = 5;

type GameResult = RoundGameEntry & { kind: "game" };

type EventResult = {
  kind: "event";
  key: string;
  target: TournamentTarget;
  listing: BroadcastListing;
};

type Result = GameResult | EventResult;

/**
 * The hub's search: tournaments by name (Lichess search) and games by player (the rounds read so
 * far), as you type. Picking either opens the tournament, a game on its round with its board
 * outlined.
 */
export function BroadcastSearch({
  liveRoundIds,
  onOpen
}: {
  /** The live events' rounds the hub reads (their players are searched here, at no extra request). */
  liveRoundIds: readonly string[];
  onOpen: (target: TournamentTarget) => void;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  // The live rounds are read once the box is first used (their players are searched locally).
  const [used, setUsed] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebouncedValue(text.trim(), 250);
  const events = useBroadcastSearchQuery(query);
  const searching = query.length >= MIN_SEARCH_LENGTH;
  const streamed = useBroadcastStore((state) => state.games);
  const rounds = useRoundsRead(liveRoundIds, used);

  const results = useMemo<Result[]>(() => {
    if (!searching) return [];
    // Lichess's own search only matches tournament names: games come from the rounds read.
    const games: GameResult[] = roundGamesWhere(
      rounds,
      streamed,
      (game) => nameMatches(game.white.name, query) || nameMatches(game.black.name, query)
    )
      .slice(0, MAX_GAMES)
      .map((entry) => ({ ...entry, kind: "game" }));
    const eventResults: EventResult[] = (events.data ?? []).slice(0, MAX_EVENTS).map((listing) => ({
      kind: "event",
      key: listing.tour.id,
      target: { tourId: listing.tour.id, roundId: listing.round?.id ?? null, focusGameId: null },
      listing
    }));
    return [...games, ...eventResults];
  }, [events.data, query, rounds, searching, streamed]);

  const shown = open && searching;
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const pick = (result: Result) => {
    setOpen(false);
    onOpen(result.target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (shown) {
        event.preventDefault();
        setOpen(false);
      } else if (text) setText("");
      return;
    }
    if (!shown || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results.at(activeIndex);
      if (result) pick(result);
    }
  };

  const games = results.filter((result): result is GameResult => result.kind === "game");
  const eventResults = results.filter((result): result is EventResult => result.kind === "event");
  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div className="relative z-10">
      <label
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 text-fg-subtle transition-[border-color,box-shadow]",
          "focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15"
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">Search broadcasts</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && results.length ? optionId(activeIndex) : undefined}
          value={text}
          placeholder="Search events and players"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          onFocus={() => {
            setOpen(true);
            setUsed(true);
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {events.isFetching ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      </label>

      {shown ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          tabIndex={-1}
          // Clicks inside must not blur the box first (which would close the list).
          onMouseDown={(event) => event.preventDefault()}
          className="absolute inset-x-0 top-[calc(100%+6px)] grid max-h-[min(70vh,560px)] origin-top animate-pop-in overflow-y-auto rounded-[10px] border border-line bg-surface-raised py-1 shadow-popover"
        >
          {games.length ? <p className="px-3.5 pt-2 pb-1 text-xs text-fg-muted">Games</p> : null}
          {games.map((result, index) => (
            <SearchOption
              key={result.key}
              id={optionId(index)}
              active={index === activeIndex}
              onHover={() => setActive(index)}
              onPick={() => pick(result)}
            >
              <span className="w-10 shrink-0">
                <BoardThumbnail fen={result.fen} lastMove={result.lastMove} rounded="md" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[0.8125rem] font-semibold text-fg">
                  {result.white} – {result.black}
                </span>
                <span className="truncate text-xs text-fg-muted">{result.where}</span>
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold",
                  result.live ? "text-danger" : "text-fg-secondary"
                )}
              >
                {result.live ? <LiveDot /> : null}
                {result.status}
              </span>
            </SearchOption>
          ))}
          {eventResults.length ? (
            <p
              className={cn(
                "px-3.5 pt-2 pb-1 text-xs text-fg-muted",
                games.length && "mt-1 border-t border-line-subtle pt-3"
              )}
            >
              Events
            </p>
          ) : null}
          {eventResults.map((result, offset) => {
            const index = games.length + offset;
            const { tour, round } = result.listing;
            const live = Boolean(round?.ongoing);
            return (
              <SearchOption
                key={result.key}
                id={optionId(index)}
                active={index === activeIndex}
                onHover={() => setActive(index)}
                onPick={() => pick(result)}
              >
                <TourImage
                  src={tour.image}
                  className="h-10 w-[71px] rounded-[5px] [&>svg]:size-4"
                />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-[0.8125rem] font-semibold text-fg">
                    {tour.name}
                  </span>
                  <span className="truncate text-xs text-fg-muted">
                    {[tour.info.location, tourDates(tour)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {live ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-danger">
                    <LiveDot />
                    Live
                  </span>
                ) : null}
              </SearchOption>
            );
          })}
          {!results.length ? (
            <p className="px-3.5 py-3 text-sm text-fg-muted">
              {events.isPending || events.isFetching
                ? "Searching…"
                : events.isError
                  ? "Lichess didn't answer the search. Try again in a moment."
                  : "No events or players match."}
            </p>
          ) : (
            <p className="mt-1 flex gap-4 border-t border-line-subtle px-3.5 pt-2 pb-1 text-2xs text-fg-subtle">
              <span>↑ ↓ to move</span>
              <span>Enter opens the tournament</span>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A result of the combobox. The search box keeps the keyboard (arrows move `aria-activedescendant`,
 * Enter picks); the pointer hovers and clicks here.
 */
function SearchOption({
  id,
  active,
  onHover,
  onPick,
  children
}: {
  id: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- an option of the combobox above: the search box handles the keys for it (arrows and Enter)
    <div
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "mx-1 flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5",
        active && "bg-control"
      )}
    >
      {children}
    </div>
  );
}
