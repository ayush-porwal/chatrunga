import { useMemo, useState } from "react";
import { ChevronRight, Search, Upload } from "lucide-react";
import { GAME_SEARCH_MAX_LENGTH, type Color } from "@chaturanga/shared/types/chess";
import { emptyTabCounts } from "@chaturanga/shared/types/library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/page";
import { gamesOfPages } from "@/lib/game-pages";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useGameFacetsQuery, useGamePagesQuery } from "../../queries/api";
import { useChesscomStore } from "../../stores/chesscom-store";
import { useGameStore } from "../../stores/game-store";
import { useLichessStore } from "../../stores/lichess-store";
import {
  LibraryGameRow,
  LibraryLoadError,
  LibrarySkeletonRow,
  NoLibraryGames,
  type LibraryRowGame
} from "../game/library-rows";
import {
  libraryFilterApplies,
  libraryFilterState,
  libraryListState,
  useLibraryTabStore,
  type LibraryFilter
} from "../game/library-tab";
import { LoadMoreGamesButton, RecentGamesFilter } from "../play/recent-games-controls";
import { GAME_SEARCH_DEBOUNCE_MS, savedGameFacts, userSide } from "../play/recent-games";
import { rememberedSource, savedGamesHidden } from "./game-review-picker";

type GameReviewPickerProps = {
  onClose: () => void;
  onSelect: (gameId: string) => void;
  onImport: () => void;
};

/**
 * Game review's Choose a game: the game on the board pinned on top, then the saved games as the
 * Library lists them (search, the source filter with Reviewed, a page at a time), and Import PGN.
 */
export function GameReviewPicker({ onClose, onSelect, onImport }: GameReviewPickerProps) {
  const current = useCurrentGame();
  const list = usePickerList(useGameStore((state) => state.gameId));
  return (
    <Dialog
      title="Choose a game"
      description="Reviews use the game’s main line."
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3"
      footer={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onClose();
            onImport();
          }}
        >
          <Upload />
          Import PGN
        </Button>
      }
    >
      {list.toolsShown ? <PickerTools list={list} /> : null}
      <div className="scroll-area -mr-1 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-1">
        {current ? (
          <section className="grid gap-1.5">
            <Eyebrow>Current game</Eyebrow>
            <ul aria-label="Current game">
              <LibraryGameRow
                game={current.game}
                orientation={current.orientation}
                onRaised
                onOpen={() => onSelect("current")}
                marker={
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                    {current.moves === 1 ? "1 move" : `${current.moves} moves`}
                  </span>
                }
              >
                <RowChevron />
              </LibraryGameRow>
            </ul>
          </section>
        ) : null}
        <SavedGames list={list} hasCurrent={current !== null} onSelect={onSelect} />
      </div>
    </Dialog>
  );
}

/** The game on the board as the pinned row, once its main line has a move (else null). */
function useCurrentGame(): { game: LibraryRowGame; orientation: Color; moves: number } | null {
  const source = useGameStore((state) => state.source);
  const white = useGameStore((state) => state.headers.white ?? null);
  const black = useGameStore((state) => state.headers.black ?? null);
  const result = useGameStore((state) => state.headers.result ?? null);
  const currentFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  const moves = useGameStore((state) => savedGameFacts(state).moves);
  if (moves === 0) return null;
  return { game: { source, white, black, result, currentFen }, orientation, moves };
}

/**
 * The saved games other than the current one (`excludeId`), filtered and searched in the database
 * a page at a time, as the Library's list. The filter opens on the source chosen last (while the
 * library has games from it), else every game; choosing a source remembers it, All games forgets it.
 * Clearing the search applies at once; typing waits for a pause.
 */
function usePickerList(excludeId: string | null) {
  const facets = useGameFacetsQuery(excludeId);
  const [chosen, setChosen] = useState<LibraryFilter>(() => ({
    tab: useLibraryTabStore.getState().remembered,
    reviewed: false
  }));
  const [query, setQuery] = useState("");
  const counts = facets.data?.tabs;
  const applied = useMemo(
    () => libraryFilterState(counts ?? emptyTabCounts(), chosen),
    [counts, chosen]
  );
  // Read once (a failed re-read keeps the last counts); the filter is known from then on.
  const ready = counts !== undefined;
  const needle = query.trim().slice(0, GAME_SEARCH_MAX_LENGTH);
  const debouncedNeedle = useDebouncedValue(needle, GAME_SEARCH_DEBOUNCE_MS);
  const games = useGamePagesQuery(
    {
      search: needle ? debouncedNeedle : "",
      tab: applied.filter.tab,
      reviewed: applied.filter.reviewed,
      excludeId
    },
    { enabled: ready }
  );
  // Any saved game besides the current one (the source counts include it).
  const hasGames = facets.data?.hasGames ?? false;
  return {
    facets,
    games,
    applied,
    ready,
    hasGames,
    query,
    setQuery,
    needle,
    toolsShown: hasGames || needle !== "" || libraryFilterApplies(applied.filter),
    choose: (filter: LibraryFilter) => {
      const remember = rememberedSource(applied.filter, filter);
      if (remember !== undefined) useLibraryTabStore.getState().choose(remember);
      setChosen(filter);
    }
  };
}

type PickerList = ReturnType<typeof usePickerList>;

/** The search box and, beside it, the Library's filter (its sources, then Reviewed). */
function PickerTools({ list }: { list: PickerList }) {
  const { applied } = list;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          autoFocus
          value={list.query}
          onChange={(event) => list.setQuery(event.target.value)}
          maxLength={GAME_SEARCH_MAX_LENGTH}
          aria-label="Search saved games"
          placeholder="Search players, event, date or result"
          className="pl-9"
        />
      </div>
      <RecentGamesFilter
        heading="Show games from"
        options={applied.options}
        value={applied.filter.tab}
        onChange={(tab) => list.choose({ ...applied.filter, tab })}
        toggle={
          applied.reviewed > 0 || applied.filter.reviewed
            ? {
                label: "Reviewed",
                count: applied.reviewed,
                checked: applied.filter.reviewed,
                onChange: (reviewed) => list.choose({ ...applied.filter, reviewed })
              }
            : undefined
        }
        // The active dot's ring takes the dialog's raised surface.
        className="size-9 border border-line [&>span]:ring-surface-raised"
      />
    </div>
  );
}

/**
 * The saved games the filter and search let through, newest first ("Load more games" for the next
 * page), or why there are none. Left out when the current game is the library's only game.
 */
function SavedGames({
  list,
  hasCurrent,
  onSelect
}: {
  list: PickerList;
  hasCurrent: boolean;
  onSelect: (gameId: string) => void;
}) {
  const { applied, games } = list;
  const listState = libraryListState(
    { read: list.ready, failed: !list.ready && list.facets.isError },
    { pending: games.isPending, failed: games.isError }
  );
  const filter = applied.filter;
  // As many as the filter lists, up to a dialog's first screen; a few until that is known.
  const skeletonRows = list.ready ? Math.min(Math.max(applied.total, 1), 5) : 3;
  if (
    listState === "ready" &&
    savedGamesHidden({ hasGames: list.hasGames, needle: list.needle, filter, hasCurrent })
  )
    return null;
  return (
    <section className="grid gap-1.5">
      <Eyebrow>Saved games</Eyebrow>
      {listState === "loading" ? (
        <div aria-busy="true" aria-label="Loading games">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <LibrarySkeletonRow key={index} onRaised />
          ))}
        </div>
      ) : listState === "ready" ? (
        <SavedGameRows list={list} onSelect={onSelect} />
      ) : (
        // A failed read is not an empty library.
        <LibraryLoadError
          error={listState === "counts-error" ? list.facets.error : games.error}
          onRetry={() =>
            listState === "counts-error" ? void list.facets.refetch() : void games.refetch()
          }
        />
      )}
    </section>
  );
}

/** The rows read so far (each with its Reviewed / N analyses badge), or the empty list's line. */
function SavedGameRows({
  list,
  onSelect
}: {
  list: PickerList;
  onSelect: (gameId: string) => void;
}) {
  const { games } = list;
  const rows = useMemo(() => gamesOfPages(games.data?.pages), [games.data]);
  const lichessUsername = useLichessStore((state) => state.status.account?.username ?? null);
  const chesscomUsername = useChesscomStore((state) => state.status.account?.username ?? null);
  if (!rows.length)
    return (
      <NoLibraryGames needle={list.needle} hasGames={list.hasGames} filter={list.applied.filter} />
    );
  return (
    <ul aria-label="Saved games">
      {rows.map((game) => (
        <LibraryGameRow
          key={game.id}
          game={game}
          orientation={userSide(game, [lichessUsername, chesscomUsername])}
          onRaised
          onOpen={() => onSelect(game.id)}
          marker={
            game.reviewCount > 0 ? (
              <Badge tone="accent">
                {game.reviewCount > 1 ? `${game.reviewCount} analyses` : "Reviewed"}
              </Badge>
            ) : null
          }
        >
          <RowChevron />
        </LibraryGameRow>
      ))}
      {games.isFetchingNextPage ? (
        <li aria-busy="true" aria-label="Loading more games">
          <LibrarySkeletonRow onRaised />
        </li>
      ) : null}
      {games.hasNextPage ? (
        <li className="flex justify-center pb-1 pt-2.5">
          <LoadMoreGamesButton
            loading={games.isFetchingNextPage}
            // Not while any read runs (a next page would cancel a refresh), nor over a previous
            // search's rows.
            disabled={games.isFetching || games.isPlaceholderData}
            onClick={() => void games.fetchNextPage()}
          />
        </li>
      ) : null}
    </ul>
  );
}

/** A row's end: the row opens its game for review. */
function RowChevron() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="size-4 shrink-0 text-fg-subtle transition-[translate,color] duration-micro group-hover/row:translate-x-0.5 group-hover/row:text-fg"
    />
  );
}
