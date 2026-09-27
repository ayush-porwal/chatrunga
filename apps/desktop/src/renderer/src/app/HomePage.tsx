import { memo, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronRight, FileSearch, Play, Puzzle, RotateCcw, Swords, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { START_FEN, statusForFen } from "@chaturanga/shared/chess/position";
import type { Color, GameSummary, MoveNode, SavedGame } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Page, PageHeader } from "@/components/ui/page";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { sectionTitle } from "@/lib/ui";
import { BoardThumbnail } from "../features/settings/board-thumbnail";
import { EngineSetupLine } from "../features/onboarding/EngineSetupStatus";
import { useGamesQuery } from "../queries/api";
import { decidedResult } from "./game-title";

/** How many saved games the Recent list shows under the Continue card. */
const RECENT_LIMIT = 6;


/**
 * The start screen. The most recent saved game is the hero (its board, players and result, with
 * Resume / Review); below it the other recent games and the ways to start something new. With no
 * saved games it becomes a single welcome with one clear first action.
 */
export const HomePage = memo(function HomePage({
  desktopApiAvailable,
  onAnalyze,
  onEngineGame,
  onImportPgn,
  onNewGame,
  onOpenGame,
  onPuzzles,
  onReview,
  onReviewGame,
  onOpenEngineSettings
}: {
  desktopApiAvailable: boolean;
  onAnalyze: () => void;
  onEngineGame: () => void;
  onImportPgn: () => void;
  onNewGame: () => void;
  /** Loads a saved game onto the board. */
  onOpenGame: (id: string) => void;
  onPuzzles: () => void;
  /** Opens the game picker for Game review. */
  onReview: () => void;
  /** Opens Game review for a saved game. */
  onReviewGame: (id: string) => void;
  /** Settings → Engines (no engine yet: add your own). */
  onOpenEngineSettings: () => void;
}) {
  const games = useGamesQuery();
  const list = games.data ?? [];
  const [latest, ...rest] = list;
  const recent = rest.slice(0, RECENT_LIMIT);
  const loading = desktopApiAvailable && games.isPending;
  // Fade the content in only when it replaces the skeleton (the view change itself is animated by the shell).
  const [mountedWhileLoading] = useState(loading);
  const reveal = mountedWhileLoading ? "animate-fade-in" : undefined;

  const actions: QuickAction[] = [
    { id: "analyze", icon: FileSearch, title: "Analyze a position", hint: "Live engine lines", onClick: onAnalyze, desktopOnly: true },
    { id: "engine", icon: Swords, title: "Play the engine", hint: "Pick a side and a clock", onClick: onEngineGame, desktopOnly: true },
    { id: "puzzles", icon: Puzzle, title: "Solve puzzles", hint: "From your databases", onClick: onPuzzles, desktopOnly: true },
    { id: "import", icon: Upload, title: "Import PGN", hint: "Open a .pgn file", onClick: onImportPgn, desktopOnly: true }
  ];

  return (
    <Page>
      <PageHeader title="Home" />
      {loading ? (
        <HomeSkeleton />
      ) : latest ? (
        <div className={cn("grid gap-8", reveal)}>
          <ContinueGame
            summary={latest}
            onOpen={onOpenGame}
            onReview={onReviewGame}
            footer={desktopApiAvailable ? <EngineSetupLine onOpenEngineSettings={onOpenEngineSettings} /> : null}
          />
          <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_clamp(17rem,16vw,22rem)]">
            <RecentGames
              games={recent}
              total={list.length}
              onOpen={onOpenGame}
              onReview={onReviewGame}
              onShowAll={onReview}
            />
            <QuickActions
              actions={actions}
              desktopApiAvailable={desktopApiAvailable}
              onNewGame={onNewGame}
            />
          </div>
        </div>
      ) : (
        <FirstRun
          className={reveal}
          actions={actions}
          desktopApiAvailable={desktopApiAvailable}
          onNewGame={onNewGame}
          onImportPgn={onImportPgn}
          onOpenEngineSettings={onOpenEngineSettings}
        />
      )}
    </Page>
  );
});

/* ------------------------------------------------------------------ continue */

/** The saved game with its current node, for the last-move highlight and the move count. */
function useSavedGame(id: string) {
  return useQuery({
    // Under the "games" key so a save (which invalidates ["games"]) refreshes it too.
    queryKey: ["games", "detail", id],
    queryFn: async (): Promise<SavedGame | null> => (await window.chaturanga?.games.get(id)) ?? null,
    staleTime: 5_000
  });
}

function ContinueGame({
  summary,
  onOpen,
  onReview,
  footer
}: {
  summary: GameSummary;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
  /** Under the actions (engine setup status when reviews can't run yet). */
  footer?: ReactNode;
}) {
  const detail = useSavedGame(summary.id);
  const saved = detail.data ?? null;
  const facts = useMemo(() => gameFacts(saved), [saved]);
  const position = useMemo(() => safeStatus(summary.currentFen), [summary.currentFen]);
  const decided = decidedResult(summary.result);
  const hasMoves = facts ? facts.plies > 0 : true;
  const reviewed = Boolean(saved?.review);
  const orientation: Color = "white";

  return (
    <section
      aria-labelledby="home-continue-title"
      className="grid items-center gap-x-10 gap-y-6 sm:grid-cols-[minmax(12rem,clamp(17.5rem,20vw,24rem))_minmax(0,1fr)]"
    >
      <button
        type="button"
        onClick={() => onOpen(summary.id)}
        className="group relative w-full max-w-[clamp(17.5rem,20vw,24rem)] rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50"
        aria-label={`Open ${playersTitle(summary)} on the board`}
      >
        <BoardThumbnail
          fen={summary.currentFen}
          orientation={orientation}
          lastMove={facts?.lastMoveUci}
          rounded="xl"
          className="transition-transform duration-emphasis ease-enter group-hover:scale-[1.012]"
        />
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/5 transition-[box-shadow] duration-emphasis group-hover:ring-white/15" />
      </button>

      <div className="grid min-w-0 content-center gap-5">
        <div className="grid gap-1.5">
          <p className="text-xs text-fg-muted">
            Last played <span className="tabular-nums">{relativeTime(summary.updatedAt)}</span>
          </p>
          <h2 id="home-continue-title" className="sr-only">
            {playersTitle(summary)}
          </h2>
          <Scoreboard summary={summary} sideToMove={decided || position?.isEnd ? null : (position?.turn ?? null)} />
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <Fact label="Event" value={summary.event && summary.event !== "?" ? summary.event : sourceLabel(summary.source)} />
          {summary.date && !summary.date.startsWith("?") ? <Fact label="Date" value={formatPgnDate(summary.date)} /> : null}
          <Fact label="Moves" value={facts ? String(Math.ceil(facts.plies / 2)) : null} mono />
          {facts?.lastSan ? <Fact label="Last move" value={facts.lastSan} mono /> : null}
          <Fact label="Review" value={saved ? (reviewed ? reviewSummary(saved) : "Not reviewed") : null} />
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {decided && hasMoves ? (
            <>
              <Button type="button" variant="primary" onClick={() => onReview(summary.id)}>
                <BarChart3 />
                {reviewed ? "Open review" : "Review game"}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpen(summary.id)}>
                <Play />
                Open board
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="primary" onClick={() => onOpen(summary.id)}>
                <Play />
                Resume
              </Button>
              <Button type="button" variant="outline" disabled={!hasMoves} onClick={() => onReview(summary.id)}>
                <BarChart3 />
                {reviewed ? "Open review" : "Review"}
              </Button>
            </>
          )}
        </div>
        {footer}
      </div>
    </section>
  );
}

/**
 * Players as a two-line scoresheet: White above Black, each with its score once the game is
 * decided (winner bright, loser muted) or a "to move" marker while it is in progress.
 */
function Scoreboard({ summary, sideToMove }: { summary: GameSummary; sideToMove: Color | null }) {
  const scores = scoresFor(summary.result);
  const line = (color: Color) => {
    const name = summary[color]?.trim() || (color === "white" ? "White" : "Black");
    const score = scores?.[color];
    const lost = score === "0";
    return (
      <div key={color} className="contents">
        <SideDot color={color} size="md" className="self-center" />
        <span
          className={cn("min-w-0 truncate text-xl font-semibold tracking-tight", lost ? "text-fg-muted" : "text-fg")}
          title={name}
        >
          {name}
        </span>
        {score ? (
          <span className={cn("text-right text-lg font-semibold tabular-nums", lost ? "text-fg-subtle" : "text-fg")}>
            {score}
          </span>
        ) : sideToMove === color ? (
          <span className="self-center rounded-full bg-accent/15 px-2 py-0.5 text-2xs font-medium text-accent-fg">To move</span>
        ) : (
          <span />
        )}
      </div>
    );
  };
  return (
    <div className="grid w-fit max-w-full grid-cols-[auto_minmax(0,auto)_auto] items-baseline gap-x-3 gap-y-1">
      {line("white")}
      {line("black")}
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: ReactNode | null; mono?: boolean }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={cn("max-w-64 truncate text-fg-secondary", mono && "tabular-nums")}>
        {value ?? <Skeleton as="span" className="inline-block h-3 w-16 align-middle" />}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ recent games */

function RecentGames({
  games,
  total,
  onOpen,
  onReview,
  onShowAll
}: {
  games: GameSummary[];
  total: number;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
  onShowAll: () => void;
}) {
  return (
    <section aria-labelledby="home-recent-title" className="grid min-w-0 content-start gap-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id="home-recent-title" className={sectionTitle}>
          Recent games
        </h2>
        {total > 1 ? (
          <Button type="button" variant="ghost" size="xs" onClick={onShowAll}>
            Review any game
            <ChevronRight />
          </Button>
        ) : null}
      </div>
      {games.length ? (
        <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle">
          {games.map((game) => (
            <RecentGameRow key={game.id} game={game} onOpen={onOpen} onReview={onReview} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-5 text-sm text-fg-muted">
          Your other games collect here as you play or import them.
        </p>
      )}
    </section>
  );
}

function RecentGameRow({
  game,
  onOpen,
  onReview
}: {
  game: GameSummary;
  onOpen: (id: string) => void;
  onReview: (id: string) => void;
}) {
  const title = playersTitle(game);
  const subtitle = [game.event && game.event !== "?" ? game.event : sourceLabel(game.source), formatPgnDate(game.date)]
    .filter(Boolean)
    .join(", ");
  return (
    <li className="group relative flex items-center gap-3 bg-surface pr-2 transition-colors duration-micro hover:bg-control focus-within:bg-control">
      <button
        type="button"
        onClick={() => onOpen(game.id)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-2 text-left outline-none after:absolute after:inset-0 after:rounded-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
        title={`${title}${subtitle ? ` — ${subtitle}` : ""}`}
      >
        <BoardThumbnail fen={game.currentFen} rounded="md" className="w-13 shrink-0" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium text-fg-secondary group-hover:text-fg">{title}</span>
          <span className="truncate text-xs text-fg-subtle">{subtitle || " "}</span>
        </span>
        <span className="grid shrink-0 justify-items-end gap-0.5">
          <ResultMark result={game.result} />
          <span className="text-2xs tabular-nums text-fg-subtle">{relativeTime(game.updatedAt)}</span>
        </span>
      </button>
      <IconButton
        label="Review this game"
        icon={<BarChart3 />}
        size="icon-xs"
        tooltipSide="left"
        className="relative z-10 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onReview(game.id)}
      />
    </li>
  );
}

function ResultMark({ result }: { result: string | null }) {
  const value = decidedResult(result);
  if (!value) return <span className="text-xs text-fg-subtle">In progress</span>;
  const label = value === "1/2-1/2" ? "½–½" : value.replace("-", "–");
  return <span className="text-xs font-medium tabular-nums text-fg-secondary">{label}</span>;
}

/* ------------------------------------------------------------------ quick actions */

type QuickAction = {
  id: "analyze" | "engine" | "puzzles" | "import";
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
  desktopOnly: boolean;
};

function QuickActions({
  actions,
  desktopApiAvailable,
  onNewGame
}: {
  actions: QuickAction[];
  desktopApiAvailable: boolean;
  onNewGame: () => void;
}) {
  return (
    <section aria-labelledby="home-start-title" className="grid content-start gap-2">
      <h2 id="home-start-title" className={cn(sectionTitle, "flex min-h-8 items-center")}>
        Start something new
      </h2>
      <button
        type="button"
        onClick={onNewGame}
        className="group flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3 py-3 text-left outline-none transition-colors duration-micro hover:border-accent/50 hover:bg-accent/20 focus-visible:ring-[3px] focus-visible:ring-accent/40"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-fg [&_svg]:size-4">
          <RotateCcw />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium text-fg">New game</span>
          <span className="truncate text-xs text-accent-fg/70">Fresh board, free play</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-accent-fg/60 transition-transform duration-micro group-hover:translate-x-0.5" />
      </button>
      <ul className="grid gap-0.5">
        {actions.map((action) => (
          <li key={action.id}>
            <QuickActionRow action={action} disabled={action.desktopOnly && !desktopApiAvailable} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuickActionRow({ action, disabled }: { action: QuickAction; disabled: boolean }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={action.onClick}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors duration-micro hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="size-4 shrink-0 text-fg-subtle transition-colors group-hover:text-fg-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary group-hover:text-fg">{action.title}</span>
      <span className="shrink-0 truncate text-xs text-fg-subtle">{disabled ? "Desktop app" : action.hint}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ first run */

function FirstRun({
  className,
  actions,
  desktopApiAvailable,
  onNewGame,
  onImportPgn,
  onOpenEngineSettings
}: {
  className?: string;
  actions: QuickAction[];
  desktopApiAvailable: boolean;
  onNewGame: () => void;
  onImportPgn: () => void;
  onOpenEngineSettings: () => void;
}) {
  const secondary = actions.filter((action) => action.id !== "import");
  return (
    <section
      aria-labelledby="home-first-run-title"
      className={cn(
        // Fills the page height (titlebar, panel margin + border and the page gutters taken off) and
        // centres board + text as one group, so the welcome sits in the middle of the panel at every
        // window size; pb-10 lifts it slightly above centre. The text column is capped at its max-w-md.
        "grid min-h-[calc(100vh-var(--titlebar-height)-0.5rem-2px-2*var(--page-gutter-y))] content-center items-center justify-center gap-x-12 gap-y-8 pb-10 sm:grid-cols-[minmax(12rem,clamp(20rem,24vw,30rem))_minmax(0,28rem)]",
        className
      )}
    >
      <BoardThumbnail fen={START_FEN} rounded="xl" className="max-w-[clamp(20rem,24vw,30rem)]" label="Starting position in your board theme" />
      <div className="grid max-w-md content-center gap-6">
        <div className="grid gap-2">
          <h2 id="home-first-run-title" className="text-2xl font-semibold tracking-tight text-fg">
            The board is set
          </h2>
          <p className="text-sm leading-6 text-fg-muted">
            Play a game, or import a PGN of one you want to study. Every game is saved here, so you can pick it up again
            or review it move by move.
          </p>
        </div>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" className="h-10 px-4" onClick={onNewGame}>
              <RotateCcw />
              New game
            </Button>
            <Button type="button" variant="ghost" className="h-10" disabled={!desktopApiAvailable} onClick={onImportPgn}>
              <Upload />
              Import PGN
            </Button>
          </div>
          {desktopApiAvailable ? <EngineSetupLine onOpenEngineSettings={onOpenEngineSettings} /> : null}
        </div>
        <ul className="grid gap-0.5 border-t border-line-subtle pt-4">
          {secondary.map((action) => (
            <li key={action.id}>
              <QuickActionRow action={action} disabled={action.desktopOnly && !desktopApiAvailable} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ loading */

/** Same footprint as the Continue card + lists, so nothing jumps when the games arrive. */
function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading games" className="grid gap-8">
      <div className="grid items-center gap-x-10 gap-y-6 sm:grid-cols-[minmax(12rem,clamp(17.5rem,20vw,24rem))_minmax(0,1fr)]">
        <Skeleton className="aspect-square w-full max-w-[clamp(17.5rem,20vw,24rem)] rounded-xl" />
        <div className="grid content-center gap-5">
          <div className="grid gap-2.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-72 max-w-full" />
            <Skeleton className="h-6 w-60 max-w-full" />
          </div>
          <div className="flex gap-6">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_clamp(17rem,16vw,22rem)]">
        <div className="grid gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-15 rounded-lg" />
          ))}
        </div>
        <div className="grid content-start gap-2">
          <Skeleton className="h-15 rounded-xl" />
          <Skeleton className="h-9 rounded-lg" />
          <Skeleton className="h-9 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function playersTitle(game: Pick<GameSummary, "white" | "black">): string {
  return `${game.white?.trim() || "White"} vs ${game.black?.trim() || "Black"}`;
}

function scoresFor(result: string | null): Record<Color, string> | null {
  switch (result) {
    case "1-0":
      return { white: "1", black: "0" };
    case "0-1":
      return { white: "0", black: "1" };
    case "1/2-1/2":
      return { white: "½", black: "½" };
    default:
      return null;
  }
}

function safeStatus(fen: string) {
  try {
    return statusForFen(fen);
  } catch {
    return null;
  }
}

const sourceLabels: Record<GameSummary["source"], string> = {
  new: "Free play",
  "pgn-import": "Imported game",
  "engine-game": "Engine game",
  analysis: "Analysis",
  puzzle: "Puzzle"
};

function sourceLabel(source: GameSummary["source"]): string {
  return sourceLabels[source] ?? "Game";
}

/** Main-line length, the move on the board and its UCI (for the last-move tint). */
function gameFacts(saved: SavedGame | null): { plies: number; lastSan: string | null; lastMoveUci: string | null } | null {
  if (!saved) return null;
  const byId = new Map<string, MoveNode>(saved.moveTree.map((node) => [node.id, node]));
  let node = saved.moveTree.find((item) => item.parentId === null);
  let plies = 0;
  while (node?.children[0]) {
    node = byId.get(node.children[0]);
    if (node) plies += 1;
  }
  const current = saved.currentNodeId ? byId.get(saved.currentNodeId) : saved.moveTree.find((item) => item.fenAfter === saved.currentFen);
  return { plies, lastSan: current?.san ?? null, lastMoveUci: current?.uci ?? null };
}

function reviewSummary(saved: SavedGame): string {
  const summary = saved.review?.summary;
  if (!summary) return "Reviewed";
  const errors = summary.blunders + summary.mistakes;
  if (errors) return `${errors} ${errors === 1 ? "error" : "errors"} found`;
  const { inaccuracies } = summary;
  return inaccuracies ? `${inaccuracies} ${inaccuracies === 1 ? "inaccuracy" : "inaccuracies"}, no errors` : "No errors found";
}

/** "2023.10.14" → "Oct 14, 2023"; partial dates ("1858.??.??") keep what is known. */
function formatPgnDate(date: string | null): string | null {
  if (!date || date.startsWith("?")) return null;
  const [year, month, day] = date.split(".");
  if (!month || month.startsWith("?")) return year;
  const parsed = new Date(Number(year), Number(month) - 1, day && !day.startsWith("?") ? Number(day) : 1);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, day && !day.startsWith("?") ? { dateStyle: "medium" } : { month: "short", year: "numeric" });
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", then a short date after a week. */
function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relativeFormat.format(Math.round(seconds / 86_400), "day");
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
