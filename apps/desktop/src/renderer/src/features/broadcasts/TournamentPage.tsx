import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  RotateCcw,
  Search,
  Star,
  Users
} from "lucide-react";
import type {
  BroadcastGame,
  BroadcastRound,
  BroadcastRoundDetail,
  BroadcastStanding,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { pageShell } from "@/lib/ui";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { cn } from "@/lib/utils";
import {
  useBroadcastPlayersQuery,
  useBroadcastRoundQuery,
  useBroadcastTournamentQuery,
  useRoundStream
} from "../../queries/broadcasts";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { boardModel, isLive, useSecondClock, type BoardModel } from "./board-state";
import { BoardCard, LiveBadge, LiveDot, TourImage } from "./broadcast-parts";
import {
  elapsedText,
  nameMatches,
  roundAfter,
  roundStatus,
  startsText,
  timeControlText,
  tourDates
} from "./broadcast-text";
import { Crosstable } from "./Crosstable";
import { useFollowedPlayers } from "./followed-players";
import type { BroadcastScreen, TournamentTab } from "./navigation";

type BoardFilter = "all" | "live" | "finished";

/** The round a tournament opens on: the one asked for, else Lichess's default, else the latest. */
export function shownRoundId(
  requested: string | null,
  rounds: readonly BroadcastRound[],
  defaultRoundId: string | null
): string | null {
  if (requested && rounds.some((round) => round.id === requested)) return requested;
  if (defaultRoundId) return defaultRoundId;
  const started = rounds.filter((round) => round.ongoing || round.finished);
  return started.at(-1)?.id ?? rounds.at(0)?.id ?? null;
}

/**
 * Watching a round live as it finishes, the page moves on to the next round when it starts. A
 * round looked at after it finished stays put (the note offers the next one).
 */
function useFollowNextRound(
  rounds: readonly BroadcastRound[],
  roundId: string | null,
  setRound: (id: string) => void
): void {
  const watchedLive = useRef<string | null>(null);
  const ongoing = rounds.some((item) => item.id === roundId && item.ongoing);
  const after = roundAfter(rounds, roundId);
  const nextStarted = after?.started ? after.round.id : null;
  useEffect(() => {
    if (ongoing) {
      watchedLive.current = roundId;
      return;
    }
    if (nextStarted && watchedLive.current === roundId) {
      watchedLive.current = null;
      setRound(nextStarted);
    }
  }, [ongoing, nextStarted, roundId, setRound]);
}

/** After a finished round: the next one has started (and a way to it), or when it starts. */
function NextRoundNote({
  rounds,
  roundId,
  onGo
}: {
  rounds: readonly BroadcastRound[];
  roundId: string | null;
  onGo: (roundId: string) => void;
}) {
  const now = useMinuteClock();
  const after = roundAfter(rounds, roundId);
  if (!after) return null;
  const { round, started } = after;
  if (started)
    return (
      <Button size="xs" variant="primary" onClick={() => onGo(round.id)}>
        <LiveDot pulse />
        {round.name} has started
        <ChevronRight />
      </Button>
    );
  if (round.startsAt === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <Clock aria-hidden="true" className="size-3.5" />
      {round.name}: {startsText(round.startsAt, now).toLowerCase()}
    </span>
  );
}

/**
 * The analysis board's clock runs from the last move: date a streamed game's from the round
 * summary (read at `readAt`) when the stream can't.
 */
function dateFromSummary(detail: BroadcastRoundDetail, gameId: string, readAt: number): void {
  const game = detail.games.find((item) => item.id === gameId);
  if (!game) return;
  const store = useBroadcastStore.getState();
  const board = boardModel(game, store.games[gameId], readAt);
  if (board.lastMoveAt !== null) store.dateLastMove(gameId, board.lastMove, board.lastMoveAt);
}

/**
 * A tournament: its banner and facts, the round picker, and the round's boards (every move live),
 * its standings or its description. A board opens its game on the analysis board.
 */
export function TournamentPage({
  screen,
  onScreenChange,
  onOpenGame
}: {
  screen: BroadcastScreen;
  /** The round or tab changed (Back / Forward keep it, without a step of its own). */
  onScreenChange: (screen: BroadcastScreen) => void;
  onOpenGame: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const tournament = useBroadcastTournamentQuery(screen.tourId);
  const rounds = tournament.data?.rounds ?? [];
  const roundId = tournament.data
    ? shownRoundId(screen.roundId, rounds, tournament.data.defaultRoundId)
    : screen.roundId;
  const round = useBroadcastRoundQuery(roundId);
  useRoundStream(roundId);
  const tour = tournament.data?.tour ?? round.data?.tour ?? null;
  const setRound = (id: string) => onScreenChange({ ...screen, roundId: id, focusGameId: null });
  const setTab = (tab: TournamentTab) => onScreenChange({ ...screen, tab });
  const openGame = (detail: BroadcastRoundDetail, gameId: string) => {
    dateFromSummary(detail, gameId, round.dataUpdatedAt);
    onOpenGame(detail, gameId);
  };
  useFollowNextRound(rounds, roundId, setRound);

  return (
    <div className={pageShell}>
      <div className="flex min-h-full flex-col gap-4 p-6">
        {tour ? (
          <TournamentHeader tour={tour} live={rounds.some((item) => item.ongoing)} />
        ) : (
          <HeaderSkeleton />
        )}
        {tournament.isError ? (
          <Notice
            tone="danger"
            title="Couldn't load this tournament"
            action={
              <Button size="xs" onClick={() => void tournament.refetch()}>
                <RotateCcw />
                Try again
              </Button>
            }
          >
            {ipcErrorMessage(tournament.error)}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <RoundStepper rounds={rounds} roundId={roundId} onChange={setRound} />
          <NextRoundNote rounds={rounds} roundId={roundId} onGo={setRound} />
          <SegmentedControl<TournamentTab>
            ariaLabel="Tournament"
            role="tablist"
            value={screen.tab}
            onChange={setTab}
            options={[
              { value: "boards", label: "Boards", count: round.data?.games.length },
              { value: "players", label: "Players" },
              { value: "about", label: "About" }
            ]}
          />
        </div>
        {screen.tab === "boards" ? (
          <BoardsTab
            roundQuery={round}
            roundId={roundId}
            focusGameId={screen.focusGameId}
            onOpenGame={openGame}
          />
        ) : screen.tab === "players" ? (
          <PlayersTab
            tourId={screen.tourId}
            round={round.data ?? null}
            rounds={rounds.filter((item) => item.ongoing || item.finished)}
            onOpenGame={openGame}
          />
        ) : tour ? (
          <AboutTab tour={tour} />
        ) : null}
      </div>
    </div>
  );
}

function TournamentHeader({ tour, live }: { tour: BroadcastTour; live: boolean }) {
  const tc = timeControlText(tour);
  const dates = tourDates(tour);
  return (
    <header className="flex items-center gap-4">
      <TourImage src={tour.image} className="h-16 w-28 rounded-lg" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold text-fg">{tour.name}</h1>
          {live ? <LiveBadge /> : null}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.78125rem] text-fg-muted">
          {tour.info.location ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-3.25" />
              {tour.info.location}
            </span>
          ) : null}
          {dates ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="size-3.25" />
              {dates}
            </span>
          ) : null}
          {tc ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock aria-hidden="true" className="size-3.25" />
              {tc}
            </span>
          ) : null}
          {tour.info.format ? (
            <span className="inline-flex items-center gap-1.5">
              <Users aria-hidden="true" className="size-3.25" />
              {tour.info.format}
            </span>
          ) : null}
        </div>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href={tour.url} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open on Lichess
        </a>
      </Button>
    </header>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-4" aria-hidden="true">
      <Skeleton className="h-16 w-28 rounded-lg" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3 w-96" />
      </div>
    </div>
  );
}

/** The round picker between the previous and next round. */
function RoundStepper({
  rounds,
  roundId,
  onChange
}: {
  rounds: readonly BroadcastRound[];
  roundId: string | null;
  onChange: (roundId: string) => void;
}) {
  const index = rounds.findIndex((item) => item.id === roundId);
  const previous = index > 0 ? rounds[index - 1] : null;
  const next = index >= 0 && index < rounds.length - 1 ? rounds[index + 1] : null;
  return (
    <div className="flex items-center gap-1">
      <IconButton
        label="Previous round"
        icon={<ChevronLeft />}
        size="icon-sm"
        variant="outline"
        disabled={!previous}
        onClick={() => previous && onChange(previous.id)}
      />
      <RoundPicker rounds={rounds} roundId={roundId} onChange={onChange} />
      <IconButton
        label="Next round"
        icon={<ChevronRight />}
        size="icon-sm"
        variant="outline"
        disabled={!next}
        onClick={() => next && onChange(next.id)}
      />
    </div>
  );
}

function RoundPicker({
  rounds,
  roundId,
  onChange
}: {
  rounds: readonly BroadcastRound[];
  roundId: string | null;
  onChange: (roundId: string) => void;
}) {
  const now = useMinuteClock();
  return (
    <Select
      aria-label="Round"
      value={roundId ?? ""}
      disabled={!rounds.length}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-60 text-[0.8125rem] font-semibold"
    >
      {rounds.map((round) => (
        <option key={round.id} value={round.id}>
          {round.name} ·{" "}
          {round.ongoing && round.startsAt
            ? `Live for ${elapsedText(round.startsAt, now)}`
            : roundStatus(round, now)}
        </option>
      ))}
    </Select>
  );
}

/** The boards of a round, every move live, filtered by state or player. */
function BoardsTab({
  roundQuery,
  roundId,
  focusGameId,
  onOpenGame
}: {
  roundQuery: ReturnType<typeof useBroadcastRoundQuery>;
  roundId: string | null;
  focusGameId: string | null;
  onOpenGame: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const now = useSecondClock();
  const streamed = useBroadcastStore((state) => state.games);
  const connection = useBroadcastStore((state) => (roundId ? state.connections[roundId] : null));
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [player, setPlayer] = useState("");
  const detail = roundQuery.data;
  const boards = useMemo(
    () =>
      detail
        ? detail.games.map((game, index) => ({
            number: index + 1,
            board: boardModel(game, streamed[game.id], roundQuery.dataUpdatedAt)
          }))
        : [],
    [detail, streamed, roundQuery.dataUpdatedAt]
  );
  const liveCount = boards.filter(({ board }) => isLive(board)).length;
  const shown = boards.filter(
    ({ board }) =>
      (filter === "all" || (filter === "live") === isLive(board)) &&
      (!player.trim() ||
        nameMatches(board.white.name, player) ||
        nameMatches(board.black.name, player))
  );

  if (roundQuery.isError) {
    return (
      <Notice
        tone="danger"
        title="Couldn't load this round"
        action={
          <Button size="xs" onClick={() => void roundQuery.refetch()}>
            <RotateCcw />
            Try again
          </Button>
        }
      >
        {ipcErrorMessage(roundQuery.error)}
      </Notice>
    );
  }
  return (
    <section aria-label="Boards" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<BoardFilter>
          ariaLabel="Show boards"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "live", label: "Live", count: detail ? liveCount : undefined },
            {
              value: "finished",
              label: "Finished",
              count: detail ? boards.length - liveCount : undefined
            }
          ]}
        />
        <label className="flex h-8 w-56 items-center gap-2 rounded-lg border border-line bg-surface-sunken px-2.5 text-fg-subtle focus-within:border-accent/60">
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="sr-only">Find a player</span>
          <input
            type="search"
            value={player}
            placeholder="Find a player"
            onChange={(event) => setPlayer(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
        {connection ? (
          <span className="text-xs text-warn">
            {connection.retrying ? "Live updates paused, reconnecting…" : "Live updates stopped"}
            {connection.error ? ` (${connection.error})` : ""}
          </span>
        ) : null}
      </div>
      {!detail ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
          {Array.from({ length: 10 }, (_, key) => (
            <Skeleton key={key} className="aspect-[3/4] rounded-[10px]" />
          ))}
        </div>
      ) : shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
          {shown.map(({ number, board }) => (
            <BoardCard
              key={board.id}
              board={board}
              number={number}
              roundId={detail.round.id}
              now={now}
              highlighted={board.id === focusGameId}
              onOpen={(gameId) => onOpenGame(detail, gameId)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={boards.length ? "No boards match." : "No boards yet"}
          description={
            boards.length ? undefined : "The pairings appear here once the round is set up."
          }
        />
      )}
    </section>
  );
}

/** The standings (each player's game in the round shown opens), or the crosstable. */
function PlayersTab({
  tourId,
  round,
  rounds,
  onOpenGame
}: {
  tourId: string;
  round: BroadcastRoundDetail | null;
  /** The tournament's started rounds, in order (the crosstable's columns). */
  rounds: readonly BroadcastRound[];
  onOpenGame: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const players = useBroadcastPlayersQuery(tourId);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"standings" | "crosstable">("standings");
  if (players.isError) {
    return (
      <Notice tone="danger" title="Couldn't load the standings">
        {ipcErrorMessage(players.error)}
      </Notice>
    );
  }
  const rows = (players.data ?? []).filter(
    (row) => !search.trim() || nameMatches(row.name, search)
  );
  return (
    <section aria-label="Standings" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<"standings" | "crosstable">
          ariaLabel="Players view"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "standings", label: "Standings" },
            { value: "crosstable", label: "Crosstable" }
          ]}
        />
        {view === "standings" ? (
          <label className="flex h-8 w-56 items-center gap-2 rounded-lg border border-line bg-surface-sunken px-2.5 text-fg-subtle focus-within:border-accent/60">
            <Search aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">Find a player</span>
            <input
              type="search"
              value={search}
              placeholder="Find a player"
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-fg outline-none placeholder:text-fg-subtle"
            />
          </label>
        ) : null}
      </div>
      {view === "crosstable" && players.data ? (
        <Crosstable standings={players.data} rounds={rounds} onOpenGame={onOpenGame} />
      ) : (
        <StandingsTable
          rows={rows}
          loading={players.isPending}
          empty={Boolean(players.data) && !rows.length}
          round={round}
          onOpenGame={onOpenGame}
        />
      )}
    </section>
  );
}

function StandingsTable({
  rows,
  loading,
  empty,
  round,
  onOpenGame
}: {
  rows: readonly BroadcastStanding[];
  loading: boolean;
  /** Players were read, but none matches the search. */
  empty: boolean;
  round: BroadcastRoundDetail | null;
  onOpenGame: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const { followed, toggle: toggleFollow } = useFollowedPlayers();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-[0.8125rem]">
        <thead>
          <tr className="h-9 border-b border-line-subtle text-left text-xs text-fg-subtle">
            <th scope="col" className="w-12 pl-4 font-normal">
              #
            </th>
            <th scope="col" className="font-normal">
              Player
            </th>
            <th scope="col" className="w-16 font-normal">
              Fed
            </th>
            <th scope="col" className="w-20 text-right font-normal">
              Rating
            </th>
            <th scope="col" className="w-20 text-right font-normal">
              Points
            </th>
            <th scope="col" className="w-20 text-right font-normal">
              Perf
            </th>
            <th scope="col" className="w-16 text-right font-normal">
              ±
            </th>
            <th scope="col" className="w-72 pl-8 font-normal">
              {round?.round.name ?? "This round"}
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }, (_, key) => (
                <tr key={key} className="h-10 border-b border-line-subtle">
                  <td colSpan={8} className="px-4">
                    <Skeleton className="h-3 w-2/3" />
                  </td>
                </tr>
              ))
            : rows.map((row, index) => (
                <StandingRow
                  key={`${row.fideId ?? row.name}`}
                  row={row}
                  rank={row.rank ?? index + 1}
                  game={<PlayerGame round={round} name={row.name} onOpenGame={onOpenGame} />}
                  followed={followed.includes(row.name)}
                  onToggleFollow={() => toggleFollow(row.name)}
                />
              ))}
        </tbody>
      </table>
      {empty ? <EmptyState compact title="No players match." className="px-4" /> : null}
    </div>
  );
}

/** A player's game in the round shown, if they play in it. */
function PlayerGame({
  round,
  name,
  onOpenGame
}: {
  round: BroadcastRoundDetail | null;
  name: string;
  onOpenGame: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const streamedResult = useBroadcastStore((state) => {
    const board = round ? roundGameOf(round, name) : null;
    return board ? (state.games[board.game.id]?.result ?? null) : null;
  });
  const board = round ? roundGameOf(round, name) : null;
  if (!round || !board) return null;
  return (
    <RoundGameButton
      board={board}
      result={streamedResult ?? board.game.result}
      onOpen={() => onOpenGame(round, board.game.id)}
    />
  );
}

function roundGameOf(
  round: BroadcastRoundDetail,
  name: string
): { game: BroadcastGame; number: number; color: "white" | "black" } | null {
  const index = round.games.findIndex(
    (game) => game.white.name === name || game.black.name === name
  );
  if (index < 0) return null;
  const game = round.games[index];
  return { game, number: index + 1, color: game.white.name === name ? "white" : "black" };
}

/** A rating change over the event: "+9.4", "−2". */
function ratingDiffText(diff: number): string {
  return `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1).replace(/\.0$/, "")}`;
}

function diffTone(diff: number | null): string {
  if (diff === null) return "";
  return diff >= 0 ? "text-accent" : "text-danger";
}

function StandingRow({
  row,
  rank,
  game,
  followed,
  onToggleFollow
}: {
  row: BroadcastStanding;
  rank: number;
  /** The player's game in the round shown, if any. */
  game: ReactNode;
  /** Their games lead the Broadcasts page. */
  followed: boolean;
  onToggleFollow: () => void;
}) {
  const diff = row.ratingDiff;
  return (
    <tr className="h-10 border-b border-line-subtle last:border-b-0">
      <td className="pl-4 text-fg-subtle tabular-nums">{rank}</td>
      <td>
        <span className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={followed}
            aria-label={followed ? `Unfollow ${row.name}` : `Follow ${row.name}`}
            title={followed ? "Following: their games lead the Broadcasts page" : "Follow"}
            onClick={onToggleFollow}
            className={cn(
              "-ml-1 grid size-6 place-items-center rounded-md outline-none transition-colors hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/70",
              followed ? "text-warn" : "text-fg-subtle hover:text-fg"
            )}
          >
            <Star aria-hidden="true" className={cn("size-3.5", followed && "fill-current")} />
          </button>
          {row.title ? <span className="text-2xs font-semibold text-warn">{row.title}</span> : null}
          <span className="font-semibold text-fg">{row.name}</span>
        </span>
      </td>
      <td className="text-xs text-fg-muted">{row.federation ?? ""}</td>
      <td className="text-right text-fg-muted tabular-nums">{row.rating ?? ""}</td>
      <td className="text-right font-semibold text-fg tabular-nums">
        {row.score ?? ""}
        {row.played === null ? null : (
          <span className="font-normal text-fg-subtle"> / {row.played}</span>
        )}
      </td>
      <td className="text-right text-fg-secondary tabular-nums">{row.performance ?? ""}</td>
      <td className={cn("text-right tabular-nums", diffTone(diff))}>
        {diff === null ? "" : ratingDiffText(diff)}
      </td>
      <td className="pl-8">{game}</td>
    </tr>
  );
}

/** "vs Opponent · Board 3" (live) or the result: opens the game. */
function RoundGameButton({
  board,
  result,
  onOpen
}: {
  board: NonNullable<ReturnType<typeof roundGameOf>>;
  result: BoardModel["result"];
  onOpen: () => void;
}) {
  const opponent = board.color === "white" ? board.game.black : board.game.white;
  return (
    <Button variant="ghost" size="xs" className="-ml-2" onClick={onOpen}>
      <span
        aria-hidden="true"
        className={cn(
          "size-2.25 rounded-full",
          board.color === "white" ? "bg-piece-white" : "border border-line-strong bg-piece-black"
        )}
      />
      vs {opponent.name}
      {result === "*" ? (
        <span className="inline-flex items-center gap-1 text-danger">
          <LiveDot />
          Board {board.number}
        </span>
      ) : (
        <span className="text-fg-subtle">{result.replace("-", "–")}</span>
      )}
    </Button>
  );
}

/** The organiser's description and the event's facts. */
function AboutTab({ tour }: { tour: BroadcastTour }) {
  const facts: [string, string | null][] = [
    ["Format", tour.info.format],
    ["Time control", tour.info.timeControl],
    ["Location", tour.info.location],
    ["Dates", tourDates(tour)],
    ["Players", tour.info.players],
    ["Time zone", tour.info.timeZone]
  ];
  const links: [string, string | null][] = [
    ["Official website", tour.info.website],
    ["Official standings", tour.info.standings]
  ];
  return (
    <section aria-label="About" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-xl border border-line bg-surface p-5">
        {tour.description ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-fg-secondary">
            {tour.description}
          </p>
        ) : (
          <p className="text-sm text-fg-muted">The organisers haven't added a description.</p>
        )}
      </div>
      <div className="grid content-start gap-3 rounded-xl border border-line bg-surface p-5 text-[0.8125rem]">
        <dl className="grid gap-3">
          {facts
            .filter((fact): fact is [string, string] => Boolean(fact[1]))
            .map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs text-fg-subtle">{label}</dt>
                <dd className="text-fg-secondary">{value}</dd>
              </div>
            ))}
        </dl>
        {links
          .filter((link): link is [string, string] =>
            Boolean(link[1] && /^https?:\/\//.test(link[1]))
          )
          .map(([label, href]) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent hover:text-accent-fg"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              {label}
            </a>
          ))}
      </div>
    </section>
  );
}
