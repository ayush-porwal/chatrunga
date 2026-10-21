import { memo, useMemo, useState, type JSX } from "react";
import { BookPlus, FolderOpen, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  GAME_SEARCH_MAX_LENGTH,
  type Color,
  type GameSummary
} from "@chaturanga/shared/types/chess";
import {
  emptyTabCounts,
  LIBRARY_TAB_LABELS,
  libraryTabOf,
  type LibraryTab
} from "@chaturanga/shared/types/library";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { gamesOfPages } from "@/lib/game-pages";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useGameFacetsQuery, useRecentGamePagesQuery } from "../../queries/api";
import { useChesscomStore } from "../../stores/chesscom-store";
import { useLichessStore } from "../../stores/lichess-store";
import { PlayerMark } from "../game/library-rows";
import { useYourSide } from "../profile/YourAvatar";
import { useSavedGameActions } from "../game/saved-game-actions";
import { useSavedEngineSide } from "../game/use-saved-engine-side";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { CardTitleBar } from "./card-title";
import { PiecePair } from "./piece-art";
import {
  ChessboardIcon,
  dimmedUntilRowHover,
  LoadMoreGamesButton,
  RecentGamesFilter,
  RecentGamesSearch,
  SourceBadge
} from "./recent-games-controls";
import {
  GAME_SEARCH_DEBOUNCE_MS,
  playerName,
  RECENT_GAMES_ROWS,
  recentGamesFilterOptions,
  recentGamesFilterTab,
  reviewSummary,
  savedGameFacts,
  scoresFor,
  useSavedGameDetail,
  userSide
} from "./recent-games";

/** One grid for the header and the rows: thumbnail, players, then four evenly spaced columns. */
const columns =
  "grid grid-cols-[5.5rem_minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-x-4 pr-2 [&>*:nth-child(n+3)]:justify-self-center";

const TITLE_ID = "play-recent-games-title";

/**
 * Play's Recent games: one bordered table of the saved games, newest first (title bar with their
 * count, search and source filter, a tinted column header, 88px rows), ten at a time ("Load more
 * games" adds the next ten). A row opens its game; Review opens its analysis or starts one; the ⋯ menu
 * and Delete stay dimmed until the row is hovered. The game on the In progress card
 * (`excludeGameId`) is left out. With no games at all it keeps its header and (`fill`) stretches
 * down.
 */
export const RecentGamesTable = memo(function RecentGamesTable({
  excludeGameId,
  fill,
  onOpenGame,
  onReviewGame
}: {
  excludeGameId: string | null;
  fill: boolean;
  onOpenGame: (id: string) => void;
  onReviewGame: (id: string) => void;
}): JSX.Element {
  const { facets, options, tab, setChosenTab, shown, hasGames } =
    useRecentGamesSources(excludeGameId);
  const [query, setQuery] = useState("");
  // Clearing the box applies at once; typing waits for a pause.
  const needle = query.trim().slice(0, GAME_SEARCH_MAX_LENGTH);
  const debouncedNeedle = useDebouncedValue(needle, GAME_SEARCH_DEBOUNCE_MS);
  const search = needle ? debouncedNeedle : "";

  const games = useRecentGamePagesQuery(
    { search, tab, excludeId: excludeGameId },
    RECENT_GAMES_ROWS
  );
  const rows = useMemo(() => gamesOfPages(games.data?.pages), [games.data]);
  const actions = useSavedGameActions();
  // Fade the rows in only when they replace the skeleton (the first read, another source).
  const [fadeIn, setFadeIn] = useState(games.isPending);
  if (games.isPending && !fadeIn) setFadeIn(true);

  const skeletonRows = facets.isSuccess && !needle ? Math.min(Math.max(shown, 1), 4) : 4;

  return (
    <section
      aria-labelledby={TITLE_ID}
      className={cn(
        "min-w-0 rounded-xl border border-line bg-surface",
        fill && "flex flex-1 flex-col"
      )}
    >
      <CardTitleBar
        id={TITLE_ID}
        title="Recent games"
        // A search's matches aren't counted ahead of listing them.
        count={facets.isSuccess && !needle ? shown : null}
        actions={
          hasGames || query ? (
            <RecentGamesTools
              query={query}
              onQueryChange={setQuery}
              options={options}
              tab={tab}
              onTabChange={setChosenTab}
            />
          ) : null
        }
      />
      <div
        aria-hidden="true"
        className={cn(
          columns,
          "h-9 shrink-0 items-center border-y border-b-line border-t-line-subtle bg-surface-sunken text-xs font-medium text-fg-muted"
        )}
      >
        <span />
        <span>Players</span>
        <span>Result</span>
        <span>Moves</span>
        <span>Review</span>
        <span>Actions</span>
      </div>
      {actions.error ? (
        <Notice tone="danger" className="m-3 w-auto">
          {actions.error}
        </Notice>
      ) : null}
      {games.isPending ? (
        <div aria-busy="true" aria-label="Loading games">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <SkeletonRow key={index} />
          ))}
        </div>
      ) : games.isError ? (
        <GamesLoadError error={games.error} onRetry={() => void games.refetch()} />
      ) : rows.length ? (
        <GameRows
          games={games}
          rows={rows}
          fadeIn={fadeIn}
          actions={actions}
          onOpenGame={onOpenGame}
          onReviewGame={onReviewGame}
        />
      ) : (
        <NoGames needle={needle} tab={tab} />
      )}
    </section>
  );
});

/**
 * The source filter's options (per source, every game; the In progress card's game comes off its
 * source's count), the source listed, how many games it has (`shown`), and whether there are any.
 */
function useRecentGamesSources(excludeGameId: string | null) {
  const facets = useGameFacetsQuery(null);
  const excluded = useSavedGameDetail(excludeGameId);
  const excludedTab = excluded.data ? libraryTabOf(excluded.data.source) : null;
  const options = useMemo(
    () => recentGamesFilterOptions(facets.data?.tabs ?? emptyTabCounts(), excludedTab),
    [facets.data, excludedTab]
  );
  // Chosen for this visit to the page; every game again once its source has none left.
  const [chosenTab, setChosenTab] = useState<LibraryTab | null>(null);
  const tab = recentGamesFilterTab(options, chosenTab);
  return {
    facets,
    options,
    tab,
    setChosenTab,
    shown: options.find((option) => option.tab === tab)?.count ?? 0,
    hasGames: facets.isSuccess && options[0].count > 0
  };
}

/** The title bar's search, and the source filter once there is more than one source to pick. */
function RecentGamesTools({
  query,
  onQueryChange,
  options,
  tab,
  onTabChange
}: {
  query: string;
  onQueryChange: (query: string) => void;
  options: ReturnType<typeof recentGamesFilterOptions>;
  tab: LibraryTab | null;
  onTabChange: (tab: LibraryTab | null) => void;
}) {
  return (
    <>
      <RecentGamesSearch query={query} onQueryChange={onQueryChange} />
      {options.length > 2 ? (
        <RecentGamesFilter options={options} value={tab} onChange={onTabChange} />
      ) : null}
    </>
  );
}

/** The library couldn't be read: why, and Try again. */
function GamesLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="p-3">
      <Notice
        tone="danger"
        title="Couldn't load your games"
        action={
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            <RotateCcw />
            Try again
          </Button>
        }
      >
        {ipcErrorMessage(error) || "The library couldn't be read."}
      </Notice>
    </div>
  );
}

/**
 * The listed games, a row each (facing the user's side in it), then the next page's placeholder
 * while it loads and "Load more games" while there are more.
 */
function GameRows({
  games,
  rows,
  fadeIn,
  actions,
  onOpenGame,
  onReviewGame
}: {
  games: ReturnType<typeof useRecentGamePagesQuery>;
  rows: readonly GameSummary[];
  fadeIn: boolean;
  actions: ReturnType<typeof useSavedGameActions>;
  onOpenGame: (id: string) => void;
  onReviewGame: (id: string) => void;
}) {
  const lichessUsername = useLichessStore((state) => state.status.account?.username ?? null);
  const chesscomUsername = useChesscomStore((state) => state.status.account?.username ?? null);
  return (
    <ul aria-labelledby={TITLE_ID} className={cn(fadeIn && "animate-fade-in")}>
      {rows.map((game) => (
        <GameRow
          key={game.id}
          game={game}
          orientation={userSide(game, [lichessUsername, chesscomUsername])}
          repertoiresAvailable={actions.repertoiresAvailable}
          deleting={actions.removing}
          onOpen={onOpenGame}
          onReview={onReviewGame}
          onAddToRepertoire={(id) => void actions.addToRepertoire(id)}
          onDelete={(id) => void actions.remove(id)}
        />
      ))}
      {games.isFetchingNextPage ? (
        <li aria-busy="true" aria-label="Loading more games">
          <SkeletonRow />
        </li>
      ) : null}
      {games.hasNextPage ? (
        // The list's last row: reached by scrolling to the end of the table, never over the rows.
        <li className="flex justify-center py-3">
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
  );
}

/** Nothing listed: no match for the search, none from the source chosen, or no games at all. */
function NoGames({ needle, tab }: { needle: string; tab: LibraryTab | null }) {
  if (needle)
    return (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
        No games match “{needle}”
      </p>
    );
  if (tab)
    return (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
        No {LIBRARY_TAB_LABELS[tab]} games
      </p>
    );
  return (
    <div className="flex min-h-54 flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3.5">
        <PiecePair piece="pawn" pieceClassName="size-28" gapClassName="gap-0.5" />
        <span className="text-[0.9375rem] font-medium tracking-[-0.005em] text-fg-secondary">
          No games yet
        </span>
      </div>
    </div>
  );
}

/** A row's placeholder: the thumbnail and the two player lines. */
function SkeletonRow() {
  return (
    <div className={cn(columns, "h-22 items-center border-b border-line-subtle last:border-0")}>
      <Skeleton className="size-full rounded-none" />
      <span className="grid gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-24" />
      </span>
    </div>
  );
}

function GameRow({
  game,
  orientation,
  repertoiresAvailable,
  deleting,
  onOpen,
  onReview,
  onAddToRepertoire,
  onDelete
}: {
  game: GameSummary;
  orientation: Color;
  repertoiresAvailable: boolean;
  deleting: boolean;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
  onAddToRepertoire: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const detail = useSavedGameDetail(game.id);
  const saved = detail.data ?? null;
  const facts = saved ? savedGameFacts(saved) : null;
  const scores = scoresFor(game.result);
  const white = playerName(game, "white");
  const black = playerName(game, "black");
  const reviewed = game.reviewCount > 0;
  // An engine game's engine (by the id its headers saved, once read) shows its picture.
  const engineSide = useSavedEngineSide({
    white: game.white,
    black: game.black,
    engineId: saved?.headers?.engineId
  });
  const yourSide = useYourSide(game.white, game.black);

  const player = (color: Color, name: string) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <PlayerMark
        color={color}
        engine={engineSide?.side === color ? engineSide.engine : null}
        you={yourSide === color}
      />
      <span
        className={cn(
          "truncate font-medium",
          scores?.[color] === "0" ? "text-fg-subtle" : "text-fg-secondary"
        )}
      >
        {name}
      </span>
    </span>
  );

  return (
    <li
      className={cn(
        columns,
        // Hover fills the row edge to edge; the last row's corners are the table's. A row with its
        // ⋯ menu open is lifted, so the rows below (their z-10 cells) don't paint over the menu.
        "group/row relative h-22 cursor-pointer items-stretch border-b border-line-subtle transition-colors duration-micro last:rounded-b-[11px] last:border-b-transparent hover:bg-control focus-within:bg-control has-[[aria-expanded=true]]:z-20"
      )}
    >
      <div className="relative h-full overflow-hidden group-last/row:rounded-bl-[11px]">
        <BoardThumbnail
          fen={game.currentFen}
          orientation={orientation}
          lastMove={facts?.lastMoveUci}
          className="h-full w-auto [&>div]:rounded-none"
        />
        <SourceBadge source={game.source} />
      </div>
      {/* The row's own action: the button covers the whole row (other controls sit above it). */}
      <button
        type="button"
        onClick={() => onOpen(game.id)}
        aria-label={`${white} vs ${black}`}
        className="grid min-w-0 content-center gap-1 text-left text-[0.84375rem] outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
      >
        {player("white", white)}
        {player("black", black)}
      </button>
      <span className="grid w-4.5 content-center gap-1 text-center text-[0.84375rem] font-semibold tabular-nums">
        {scores ? (
          (["white", "black"] as const).map((color) => (
            <span
              key={color}
              className={scores[color] === "0" ? "font-medium text-fg-subtle" : "text-fg"}
            >
              {scores[color]}
            </span>
          ))
        ) : (
          <span className="sr-only">In progress</span>
        )}
      </span>
      <span className="flex items-center text-[0.8125rem] tabular-nums text-fg-muted">
        {facts ? facts.moves : detail.isPending ? <Skeleton as="span" className="h-3 w-5" /> : null}
      </span>
      <span className="relative z-10 flex items-center">
        {reviewed ? (
          <IconButton
            label={saved ? `Open review · ${reviewSummary(saved)}` : "Open review"}
            icon={<ChessboardIcon />}
            className="bg-accent/10 text-accent hover:bg-accent/20 hover:text-accent"
            onClick={() => onReview(game.id)}
          />
        ) : (
          <IconButton
            label="Review game"
            icon={
              <>
                <EmptyBoardIcon />
                <span className="absolute -bottom-1.25 -right-1.25 grid size-4 place-items-center rounded-full bg-control-hover text-fg-secondary ring-2 ring-canvas transition-colors duration-micro group-hover/row:ring-control group-hover/review:bg-accent-strong group-hover/review:text-white group-focus-within/row:ring-control [&>svg]:size-2.5! [&>svg]:stroke-3">
                  <Plus />
                </span>
              </>
            }
            className="group/review relative text-fg-subtle inset-ring inset-ring-line hover:bg-accent/8 hover:text-accent hover:inset-ring-accent/40"
            onClick={() => onReview(game.id)}
          />
        )}
      </span>
      <span className="relative z-10 flex items-center gap-1">
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
    </li>
  );
}

/** Not reviewed yet: an empty, dashed board (the + badge beside it says a review can start). */
function EmptyBoardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.2" />
      <path d="M3 12h18M12 3v18" opacity={0.55} />
    </svg>
  );
}
