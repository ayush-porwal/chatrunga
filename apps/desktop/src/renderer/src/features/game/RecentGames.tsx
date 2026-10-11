import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { BookPlus, FolderOpen, Search, Trash2, X } from "lucide-react";
import {
  GAME_SEARCH_MAX_LENGTH,
  type Color,
  type GameSummary
} from "@chaturanga/shared/types/chess";
import { emptyTabCounts } from "@chaturanga/shared/types/library";
import { useGameFacetsQuery, useGamePagesQuery } from "../../queries/api";
import { useChesscomStore } from "../../stores/chesscom-store";
import { useLichessStore } from "../../stores/lichess-store";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { gamesOfPages } from "@/lib/game-pages";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  ChessboardIcon,
  dimmedUntilRowHover,
  LoadMoreGamesButton,
  RecentGamesFilter
} from "../play/recent-games-controls";
import { GAME_SEARCH_DEBOUNCE_MS, userSide } from "../play/recent-games";
import { useSavedGameActions } from "./saved-game-actions";
import {
  LibraryGameRow,
  LibraryLoadError,
  LibrarySkeletonRow,
  NoLibraryGames
} from "./library-rows";
import {
  DEFAULT_LIBRARY_FILTER,
  libraryFilterApplies,
  libraryFilterState,
  libraryListState,
  useLibraryTabStore,
  type LibraryFilter
} from "./library-tab";

/**
 * The workspace Library's state, kept by the workspace (`useLibraryView`) so it outlives a visit
 * to the Moves tab: the filter and search its tab-bar actions set and its list applies. `total` is
 * how many games the filter lists (before any search; 0 for an empty library), null until the
 * library's counts are read: the Library tab's count.
 */
export type LibraryView = {
  total: number | null;
  /** The library's counts are read (`applied` is real). */
  ready: boolean;
  /** The first read of the counts failed (the list can't be filtered yet): its error, else null. */
  countsError: unknown;
  /** Reads the counts again (the list's Try again after `countsError`). */
  retryCounts: () => void;
  /** Any game in the library. */
  hasGames: boolean;
  /** The filter as it applies (a chosen source with no games left lists every game). */
  applied: ReturnType<typeof libraryFilterState>;
  choose: (filter: LibraryFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  /** The search row under the tab bar is open. */
  searchOpen: boolean;
  /** Counts the magnifier's presses: the search field takes focus on each one. */
  searchFocus: number;
  openSearch: () => void;
  /** ✕ or Esc: clears the search and folds its row. */
  closeSearch: () => void;
};

/**
 * The Library tab's filter and search, from every game each time the workspace opens. Choosing a
 * source also makes it the one Game review's Choose a game opens on, as the Library's source tabs
 * did.
 */
export function useLibraryView(): LibraryView {
  const facets = useGameFacetsQuery(null);
  const [chosen, setChosen] = useState<LibraryFilter>(DEFAULT_LIBRARY_FILTER);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocus, setSearchFocus] = useState(0);
  const counts = facets.data?.tabs;
  const applied = useMemo(
    () => libraryFilterState(counts ?? emptyTabCounts(), chosen),
    [counts, chosen]
  );
  // Read once (a failed re-read keeps the last counts).
  const ready = counts !== undefined;
  const countsError = !ready && facets.isError ? facets.error : null;
  const { refetch: refetchCounts } = facets;
  return useMemo(
    () => ({
      total: ready ? applied.total : null,
      ready,
      countsError,
      retryCounts: () => void refetchCounts(),
      hasGames: ready && applied.options[0].count > 0,
      applied,
      choose: (filter: LibraryFilter) => {
        if (filter.tab) useLibraryTabStore.getState().choose(filter.tab);
        setChosen(filter);
      },
      query,
      setQuery,
      searchOpen,
      searchFocus,
      openSearch: () => {
        setSearchOpen(true);
        setSearchFocus((count) => count + 1);
      },
      closeSearch: () => {
        setQuery("");
        setSearchOpen(false);
      }
    }),
    [applied, countsError, query, ready, refetchCounts, searchFocus, searchOpen]
  );
}

/**
 * The Library's tab-bar actions: search (opens the search row above the list) and the filter
 * (its sources, then Reviewed; a dot while it differs from every game with Reviewed off). Nothing
 * while the library is empty.
 */
export function LibraryActions({ view }: { view: LibraryView }): JSX.Element | null {
  const { applied, searchOpen } = view;
  const searchButton = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(searchOpen);
  // Search folded (✕ or Esc in its row): focus comes back to the magnifier.
  useEffect(() => {
    if (wasOpen.current && !searchOpen) searchButton.current?.focus();
    wasOpen.current = searchOpen;
  }, [searchOpen]);
  const filtered = libraryFilterApplies(applied.filter);
  if (!view.hasGames && !searchOpen && !filtered) return null;
  return (
    <>
      <IconButton
        ref={searchButton}
        label="Search games"
        icon={<Search />}
        className="size-7"
        onClick={view.openSearch}
      />
      <RecentGamesFilter
        heading="Show games from"
        options={applied.options}
        value={applied.filter.tab}
        onChange={(tab) => view.choose({ ...applied.filter, tab })}
        toggle={
          applied.reviewed > 0 || applied.filter.reviewed
            ? {
                label: "Reviewed",
                count: applied.reviewed,
                checked: applied.filter.reviewed,
                onChange: (reviewed) => view.choose({ ...applied.filter, reviewed })
              }
            : undefined
        }
        className="size-7"
      />
    </>
  );
}

/**
 * The workspace's Library tab: the saved games the filter lets through, newest first, matching the
 * search, a page at a time ("Load more games"). A row opens its game through App (`onOpenGame`:
 * history, engine teardown); its ⋯ menu also opens it or adds it to a repertoire (read without
 * loading it), and Delete removes it. Fills its slot and scrolls on its own.
 */
export function RecentGames({
  view,
  onOpenGame
}: {
  view: LibraryView;
  onOpenGame: (id: string) => void;
}): JSX.Element {
  const { applied } = view;
  // Clearing the box applies at once; typing waits for a pause.
  const needle = view.query.trim().slice(0, GAME_SEARCH_MAX_LENGTH);
  const debouncedNeedle = useDebouncedValue(needle, GAME_SEARCH_DEBOUNCE_MS);
  const search = needle ? debouncedNeedle : "";
  const games = useGamePagesQuery(
    { search, tab: applied.filter.tab, reviewed: applied.filter.reviewed, excludeId: null },
    // The filter is known once the counts are.
    { enabled: view.ready }
  );
  const list = useMemo(() => gamesOfPages(games.data?.pages), [games.data]);
  const listState = libraryListState(
    { read: view.ready, failed: view.countsError !== null },
    { pending: games.isPending, failed: games.isError }
  );
  const actions = useSavedGameActions();
  const lichessUsername = useLichessStore((state) => state.status.account?.username ?? null);
  const chesscomUsername = useChesscomStore((state) => state.status.account?.username ?? null);
  const skeletonRows = view.ready && !needle ? Math.min(Math.max(applied.total, 1), 7) : 7;
  const searchInput = useRef<HTMLInputElement | null>(null);
  // On opening, on each press of the magnifier while open, and when the tab comes back to it.
  useEffect(() => {
    if (view.searchOpen) searchInput.current?.focus();
  }, [view.searchOpen, view.searchFocus]);

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col" aria-label="Library">
      {view.searchOpen ? (
        <div className="flex h-11 shrink-0 items-center gap-1.5 pl-3.5 pr-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              ref={searchInput}
              type="search"
              value={view.query}
              onChange={(event) => view.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // The field's own Escape: nothing else (a dialog, the page) should take it too.
                event.preventDefault();
                event.stopPropagation();
                view.closeSearch();
              }}
              maxLength={GAME_SEARCH_MAX_LENGTH}
              aria-label="Search games"
              placeholder="Search games"
              className="h-7.5 pl-8 text-[0.8125rem] [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <IconButton
            label="Close search"
            icon={<X />}
            className="size-7"
            onClick={view.closeSearch}
          />
        </div>
      ) : null}
      <div
        className={cn("scroll-area min-h-0 flex-1 overflow-y-auto", !view.searchOpen && "pt-1.5")}
      >
        {actions.error ? (
          <Notice tone="danger" className="mx-3 mb-2 w-auto">
            {actions.error}
          </Notice>
        ) : null}
        {listState === "loading" ? (
          <div aria-busy="true" aria-label="Loading games">
            {Array.from({ length: skeletonRows }, (_, index) => (
              <LibrarySkeletonRow key={index} />
            ))}
          </div>
        ) : listState !== "ready" ? (
          // A failed read is not an empty library.
          <div className="p-3">
            <LibraryLoadError
              error={listState === "counts-error" ? view.countsError : games.error}
              onRetry={() =>
                listState === "counts-error" ? view.retryCounts() : void games.refetch()
              }
            />
          </div>
        ) : list.length ? (
          <ul aria-label="Saved games">
            {list.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                orientation={userSide(game, [lichessUsername, chesscomUsername])}
                repertoiresAvailable={actions.repertoiresAvailable}
                deleting={actions.removing}
                onOpen={onOpenGame}
                onAddToRepertoire={(id) => void actions.addToRepertoire(id)}
                onDelete={(id) => void actions.remove(id)}
              />
            ))}
            {games.isFetchingNextPage ? (
              <li aria-busy="true" aria-label="Loading more games">
                <LibrarySkeletonRow />
              </li>
            ) : null}
            {games.hasNextPage ? (
              <li className="flex justify-center pb-3.5 pt-2.5">
                <LoadMoreGamesButton
                  loading={games.isFetchingNextPage}
                  // Not while any read runs (a next page would cancel a refresh), nor over a
                  // previous search's rows.
                  disabled={games.isFetching || games.isPlaceholderData}
                  onClick={() => void games.fetchNextPage()}
                />
              </li>
            ) : null}
          </ul>
        ) : (
          <NoLibraryGames needle={needle} hasGames={view.hasGames} filter={applied.filter} />
        )}
      </div>
    </section>
  );
}

/**
 * One saved game in the Library: the shared row with the reviewed mark, then ⋯ and Delete, dimmed
 * until the row is hovered but always in place.
 */
function GameRow({
  game,
  orientation,
  repertoiresAvailable,
  deleting,
  onOpen,
  onAddToRepertoire,
  onDelete
}: {
  game: GameSummary;
  orientation: Color;
  repertoiresAvailable: boolean;
  deleting: boolean;
  onOpen: (id: string) => void;
  onAddToRepertoire: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <LibraryGameRow
      game={game}
      orientation={orientation}
      onOpen={() => onOpen(game.id)}
      marker={
        <span className="grid w-4 shrink-0 place-items-center text-accent">
          {game.reviewCount > 0 ? (
            <span role="img" aria-label="Reviewed" title="Reviewed">
              <ChessboardIcon className="size-3.5" />
            </span>
          ) : null}
        </span>
      }
    >
      <span className="relative z-10 flex shrink-0 items-center">
        <span className={dimmedUntilRowHover}>
          <OverflowMenu
            label="Game actions"
            size="icon-xs"
            items={[
              { label: "Open", icon: <FolderOpen />, onSelect: () => onOpen(game.id) },
              repertoiresAvailable && {
                label: "Add to repertoire…",
                icon: <BookPlus />,
                onSelect: () => onAddToRepertoire(game.id)
              }
            ]}
          />
        </span>
        <span className={dimmedUntilRowHover}>
          <IconButton
            label="Delete saved game"
            icon={<Trash2 />}
            size="icon-xs"
            tooltipSide="left"
            disabled={!window.chaturanga || deleting}
            className="hover:bg-danger-soft hover:text-danger"
            onClick={() => onDelete(game.id)}
          />
        </span>
      </span>
    </LibraryGameRow>
  );
}
