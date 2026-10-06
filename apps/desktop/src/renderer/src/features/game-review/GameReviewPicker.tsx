import { useMemo, useState } from "react";
import { ChevronRight, Search, Upload } from "lucide-react";
import {
  GAME_SEARCH_MAX_LENGTH,
  type GameSource,
  type GameSummary
} from "@chaturanga/shared/types/chess";
import { LIBRARY_TAB_LABELS } from "@chaturanga/shared/types/library";
import { Badge, ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGamePagesQuery } from "../../queries/api";
import { sourceLabel, useLibraryTabs } from "../game/library-tab";
import { useGameStore } from "../../stores/game-store";
import { cn } from "@/lib/utils";
import { listRowInteractive, listRowSelected } from "@/lib/ui";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Eyebrow } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { gamesOfPages } from "@/lib/game-pages";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/** How long typing pauses before the library is searched. */
const SEARCH_DEBOUNCE_MS = 150;

type GameReviewPickerProps = {
  onClose: () => void;
  onSelect: (gameId: string) => void;
  onImport: () => void;
};

type CurrentGame = {
  id: string | null;
  source: GameSource;
  white: string | null;
  black: string | null;
  result: string | null;
  event: string | null;
  moveCount: number;
};

function titleFor(game: Pick<GameSummary, "white" | "black">): string {
  return `${game.white || "White"} vs ${game.black || "Black"}`;
}

/** The row's second line: where the game came from, then its event, result and date. */
function subtitleFor(game: Pick<GameSummary, "source" | "event" | "result" | "date">): string {
  return [sourceLabel(game.source), game.event, game.result || "*", game.date]
    .filter(Boolean)
    .join(" · ");
}

export function GameReviewPicker({ onClose, onSelect, onImport }: GameReviewPickerProps) {
  const currentGameId = useGameStore((state) => state.gameId);
  const currentSource = useGameStore((state) => state.source);
  const currentWhite = useGameStore((state) => state.headers.white);
  const currentBlack = useGameStore((state) => state.headers.black);
  const currentResult = useGameStore((state) => state.headers.result);
  const currentEvent = useGameStore((state) => state.headers.event);
  const currentMoveCount = useGameStore((state) => Math.max(0, state.moveTree.length - 1));
  const currentGame: CurrentGame = {
    id: currentGameId,
    source: currentSource,
    white: currentWhite ?? null,
    black: currentBlack ?? null,
    result: currentResult ?? null,
    event: currentEvent ?? null,
    moveCount: currentMoveCount
  };
  const [query, setQuery] = useState("");
  const [reviewedOnly, setReviewedOnly] = useState(false);
  // One source at a time (its tab), and Reviewed on top of it; the current game stays pinned.
  const { facets, counts, tabs, tab, choose } = useLibraryTabs(currentSource, currentGameId);
  const reviewedCount = tab ? counts[tab].reviewed : 0;
  // Searched and filtered in the database, a page at a time. Clearing the box applies at once;
  // typing waits for a pause. The box stops at the longest search the library takes (main
  // refuses longer).
  const needle = query.trim().slice(0, GAME_SEARCH_MAX_LENGTH);
  const debouncedNeedle = useDebouncedValue(needle, SEARCH_DEBOUNCE_MS);
  const games = useGamePagesQuery(
    {
      search: needle ? debouncedNeedle : "",
      tab,
      reviewed: reviewedOnly,
      excludeId: currentGameId
    },
    // The tab is known once the counts are.
    { enabled: !facets.isPending }
  );
  const filteredGames = useMemo(() => gamesOfPages(games.data?.pages), [games.data]);

  const currentCanReview = currentGame.moveCount > 0;
  const currentLabel =
    currentGame.white || currentGame.black ? titleFor(currentGame) : "Current game";
  const currentSubtitle = currentCanReview
    ? [
        sourceLabel(currentGame.source),
        currentGame.event,
        currentGame.result,
        `${currentGame.moveCount} plies`
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const hasSavedGames = facets.data?.hasGames ?? false;

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
      {tab && (tabs.length > 1 || reviewedCount > 0 || reviewedOnly) ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          {tabs.length > 1 ? (
            <SegmentedControl
              ariaLabel="Game source"
              size="sm"
              value={tab}
              onChange={choose}
              options={tabs.map((value) => ({
                value,
                label: LIBRARY_TAB_LABELS[value],
                count: counts[value].games
              }))}
              className="w-fit max-w-full shrink-0"
            />
          ) : (
            <span />
          )}
          {reviewedCount > 0 || reviewedOnly ? (
            <ChipButton
              selected={reviewedOnly}
              onClick={() => setReviewedOnly((on) => !on)}
              className="ml-auto"
            >
              Reviewed
              <span className={cn("tabular-nums", !reviewedOnly && "text-fg-subtle")}>
                {reviewedCount}
              </span>
            </ChipButton>
          ) : null}
        </div>
      ) : null}
      {hasSavedGames || query ? (
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={GAME_SEARCH_MAX_LENGTH}
            aria-label="Search saved games"
            placeholder="Search players, event, date or result"
            className="pl-9"
          />
        </div>
      ) : null}

      <div className="scroll-area -mr-1 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-1">
        {currentCanReview ? (
          <section className="grid gap-2">
            <Eyebrow>Current game</Eyebrow>
            <GameRow
              title={currentLabel}
              meta={currentSubtitle}
              selected
              onClick={() => onSelect("current")}
            />
          </section>
        ) : null}

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Saved games</Eyebrow>
            {games.isLoading || games.isPlaceholderData ? (
              <span className="text-2xs text-fg-subtle">Loading…</span>
            ) : null}
          </div>
          {games.isError ? (
            <Notice tone="warn">
              Saved games could not be loaded. Try opening Game review again.
            </Notice>
          ) : null}
          {filteredGames.length ? (
            <div className="grid gap-1.5">
              {filteredGames.map((game) => (
                <GameRow
                  key={game.id}
                  title={titleFor(game)}
                  meta={subtitleFor(game)}
                  analyses={game.reviewCount}
                  onClick={() => onSelect(game.id)}
                />
              ))}
              {games.hasNextPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-self-center"
                  disabled={games.isFetchingNextPage}
                  onClick={() => void games.fetchNextPage()}
                >
                  {games.isFetchingNextPage ? "Loading…" : "Show more"}
                </Button>
              ) : null}
            </div>
          ) : games.isPending ? null : (
            <EmptyState
              compact
              title={
                query || reviewedOnly
                  ? "No saved games match this search."
                  : currentCanReview
                    ? "No other saved games."
                    : "No saved games yet — import a PGN or play a game first."
              }
            />
          )}
        </section>
      </div>
    </Dialog>
  );
}

function GameRow({
  title,
  meta,
  analyses = 0,
  selected = false,
  onClick
}: {
  title: string;
  meta: string;
  /** Saved analyses of the game (a badge says it's been reviewed). */
  analyses?: number;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(listRowInteractive, "group", selected && listRowSelected)}
      onClick={onClick}
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium text-fg">{title}</span>
        <span className="truncate text-xs text-fg-muted">{meta}</span>
      </span>
      {analyses > 0 ? (
        <Badge tone="accent" className="shrink-0">
          {analyses > 1 ? `${analyses} analyses` : "Reviewed"}
        </Badge>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
    </button>
  );
}
