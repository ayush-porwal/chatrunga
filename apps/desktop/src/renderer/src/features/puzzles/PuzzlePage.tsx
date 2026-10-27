import { memo, useId, useMemo, type ReactNode } from "react";
import { Database, Loader2, Play, Puzzle, Repeat, RotateCcw } from "lucide-react";
import {
  DEFAULT_PUZZLE_RATING,
  type PuzzleDifficulty
} from "@chaturanga/shared/chess/puzzle-rating";
import type { InstalledDatabase, PuzzleSample } from "@chaturanga/shared/types/database";
import type { GamePuzzleFilter } from "@chaturanga/shared/types/game-puzzles";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { card, pageShell } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDatabasesQuery, useSamplePuzzleMutation } from "../../queries/api";
import {
  useDrawGamePuzzleMutation,
  useGamePuzzleListQuery,
  useGamePuzzleStatusQuery,
  useGamePuzzleSummaryQuery
} from "../../queries/game-puzzles";
import { useFailedPuzzlesQuery, usePuzzleRatingSummaryQuery } from "../../queries/puzzles";
import { usePuzzleDraftStore } from "../../stores/puzzle-draft-store";
import { CardTitleBar } from "../play/card-title";
import {
  choosePuzzleSet,
  GAME_PUZZLES_SET_ID,
  GAME_PUZZLES_SET_NAME,
  gamePuzzleCountText,
  gamePuzzleFilter,
  gamePuzzleFiltersChanged,
  gamePuzzleSetConfig
} from "./game-puzzle-set";
import {
  drawnRatingRange,
  puzzleDatabasesOf,
  puzzleFiltersChanged,
  puzzleSetConfig
} from "./puzzle-set";
import { GamePuzzleFilters, LichessPuzzleFilters, PositionTrainingFilters } from "./PuzzleFilters";
import { PuzzleRatingChart } from "./PuzzleRatingChart";
import { formatPuzzleRating } from "./PuzzleRatingLine";
import { PuzzleThemeChart } from "./PuzzleThemeChart";
import { toggleTheme } from "./rating-chart";

export type PuzzleSessionConfig = {
  databaseId: string | null;
  /** `my-games`: the "From my games" set (no database; `games` filters it). */
  mode: "lichess-puzzle" | "position-training" | "my-games";
  /**
   * "Around my rating": the Lichess rating range was set this far from the solver's rating when the
   * set started (null or absent: the range was chosen by hand).
   */
  difficulty?: PuzzleDifficulty | null;
  /** Failed puzzles tried again: only these are drawn (the filters below are kept for Edit set). */
  retryIds?: string[];
  /**
   * The set began with Play's Puzzle of the day (this puzzle id); the filters below draw the puzzles
   * after it.
   */
  puzzleOfTheDayId?: string;
  /** The "From my games" set's filters. */
  games?: GamePuzzleFilter;
  lichess: {
    ratingMin: number;
    ratingMax: number;
    popularityMin: number;
    lengths: string[];
    themes: string[];
    openings: string[];
    side: "any" | "white" | "black";
  };
  position: {
    difficultyMin: number;
    difficultyMax: number;
    tags: string[];
  };
};

/**
 * The Puzzles page, laid out as Play (full width, bordered cards with title bars): Practice (the
 * database, the filters and Start) and, from the first rated puzzle, the Rating chart and the
 * themes' results. One column on a narrow window; from 56rem of width, Practice on the left and
 * the charts beside it. The puzzle session itself is its own board screen.
 */
export const PuzzlePage = memo(function PuzzlePage({
  onDatabases,
  onStart
}: {
  onDatabases: () => void;
  onStart: (config: PuzzleSessionConfig, puzzle: PuzzleSample) => void;
}) {
  const databases = useDatabasesQuery();
  const puzzleDatabases = useMemo(() => puzzleDatabasesOf(databases.data ?? []), [databases.data]);
  const draft = usePuzzleDraftStore((state) => state.draft);
  const updateDraft = usePuzzleDraftStore((state) => state.update);
  const gameSet = useGamePuzzleSetAvailability();
  const choice = choosePuzzleSet(puzzleDatabases, draft.databaseId, gameSet.available);
  const isLichess = choice?.kind === "database" && choice.database.sourceId === "lichess-puzzles";
  const themes = draft.themes;
  const onToggleTheme = useMemo(
    () =>
      isLichess ? (theme: string) => updateDraft({ themes: toggleTheme(themes, theme) }) : null,
    [isLichess, themes, updateDraft]
  );

  // Without a database, wait for whether "From my games" has puzzles before saying there are none.
  if ((databases.isPending || (!choice && gameSet.pending)) && window.chaturanga)
    return (
      <PuzzlesPage>
        <PuzzleSetupSkeleton />
      </PuzzlesPage>
    );
  // A failed read isn't "no database": don't send the user off to download one again.
  if (databases.isError)
    return (
      <PuzzlesPage>
        <DatabasesError error={databases.error} onRetry={() => void databases.refetch()} />
      </PuzzlesPage>
    );
  if (!choice)
    return (
      <PuzzlesPage>
        <EmptyState
          className="m-auto animate-fade-in"
          icon={<Puzzle />}
          title="Download a puzzle database"
          description="Puzzles come from free datasets stored on this computer, each downloaded once."
          action={
            <Button type="button" variant="primary" onClick={onDatabases}>
              <Database />
              Open databases
            </Button>
          }
        />
      </PuzzlesPage>
    );
  const setField = (
    <SetField
      databases={puzzleDatabases}
      gameSet={gameSet.available ? gameSet.puzzles : null}
      value={choice.kind === "games" ? GAME_PUZZLES_SET_ID : choice.database.id}
      onChange={(databaseId) => updateDraft({ databaseId })}
    />
  );
  return (
    <PuzzlesPage>
      <PuzzleGrid
        practice={
          choice.kind === "games" ? (
            <GamePuzzlePractice onManageDatabases={onDatabases} onStart={onStart}>
              {setField}
            </GamePuzzlePractice>
          ) : (
            <DatabasePractice
              database={choice.database}
              onManageDatabases={onDatabases}
              onStart={onStart}
            >
              {setField}
            </DatabasePractice>
          )
        }
        rating={<PuzzleRatingChart />}
        themes={<PuzzleThemeChart selected={themes} onToggleTheme={onToggleTheme} />}
      />
    </PuzzlesPage>
  );
});

/**
 * Whether the "From my games" set can be picked: it has puzzles, or its queue is finding some.
 * `pending` while that isn't known yet.
 */
function useGamePuzzleSetAvailability(): {
  available: boolean;
  pending: boolean;
  puzzles: number;
} {
  const summary = useGamePuzzleSummaryQuery();
  const status = useGamePuzzleStatusQuery();
  const puzzles = summary.data?.puzzles ?? 0;
  const generating = Boolean(status.data && status.data.done < status.data.total);
  return { available: puzzles > 0 || generating, pending: summary.isLoading, puzzles };
}

/** Practice on a downloaded database: its filters, Start, and Retry the failed puzzles. */
function DatabasePractice({
  database,
  onManageDatabases,
  onStart,
  children
}: {
  database: InstalledDatabase;
  onManageDatabases: () => void;
  onStart: (config: PuzzleSessionConfig, puzzle: PuzzleSample) => void;
  /** The set picker. */
  children: ReactNode;
}) {
  const samplePuzzle = useSamplePuzzleMutation();
  const draft = usePuzzleDraftStore((state) => state.draft);
  const isLichess = database.sourceId === "lichess-puzzles";
  const ratingSummary = usePuzzleRatingSummaryQuery();
  const userRating = ratingSummary.data ?? { ...DEFAULT_PUZZLE_RATING };
  const failedPuzzles = useFailedPuzzlesQuery(database.sourceId);
  const failedIds = useMemo(
    () => (failedPuzzles.data ?? []).map((puzzle) => puzzle.puzzleId),
    [failedPuzzles.data]
  );

  function start() {
    const config = puzzleSetConfig(draft, database, userRating.rating);
    samplePuzzle.mutate(
      {
        databaseId: database.id,
        lichess: config.lichess,
        position: config.position
      },
      {
        onSuccess: (puzzle) => onStart(config, puzzle)
      }
    );
  }

  /** A set of the puzzles whose latest try failed (recorded unrated: they were played before). */
  function retryFailed() {
    if (!failedIds.length) return;
    const config: PuzzleSessionConfig = {
      ...puzzleSetConfig(draft, database, userRating.rating),
      retryIds: failedIds
    };
    samplePuzzle.mutate(
      { databaseId: database.id, ids: failedIds },
      { onSuccess: (puzzle) => onStart(config, puzzle) }
    );
  }

  return (
    <PracticeCard
      filtersChanged={puzzleFiltersChanged(draft, isLichess)}
      onManageDatabases={onManageDatabases}
      footer={
        <PracticeActions
          pending={samplePuzzle.isPending}
          retrying={samplePuzzle.isPending && Boolean(samplePuzzle.variables.ids)}
          error={samplePuzzle.error}
          failedCount={failedIds.length}
          unrated={!isLichess}
          onStart={start}
          onRetryFailed={retryFailed}
        />
      }
    >
      {children}
      <SetFilters lichess={isLichess} rating={userRating} />
    </PracticeCard>
  );
}

/** A "From my games" set keeps the Lichess and position filters as drafted (unused by its draws). */
const GAME_SET_REF = { id: GAME_PUZZLES_SET_ID, sourceId: GAME_PUZZLES_SET_ID };

/** Practice on the "From my games" set: its filters, how many puzzles match and are due, Start. */
function GamePuzzlePractice({
  onManageDatabases,
  onStart,
  children
}: {
  onManageDatabases: () => void;
  onStart: (config: PuzzleSessionConfig, puzzle: PuzzleSample) => void;
  /** The set picker. */
  children: ReactNode;
}) {
  const draft = usePuzzleDraftStore((state) => state.draft);
  const update = usePuzzleDraftStore((state) => state.update);
  const draw = useDrawGamePuzzleMutation();
  const filter = gamePuzzleFilter(draft);
  const counts = useGamePuzzleListQuery(filter);

  function start() {
    const config = gamePuzzleSetConfig(
      puzzleSetConfig(draft, GAME_SET_REF, DEFAULT_PUZZLE_RATING.rating),
      draft
    );
    draw.mutate(filter, { onSuccess: (puzzle) => onStart(config, puzzle) });
  }

  return (
    <PracticeCard
      filtersChanged={gamePuzzleFiltersChanged(draft)}
      onManageDatabases={onManageDatabases}
      footer={
        <PracticeActions
          pending={draw.isPending}
          retrying={false}
          error={draw.error}
          failedCount={0}
          unrated
          onStart={start}
          onRetryFailed={() => undefined}
        />
      }
    >
      {children}
      <GamePuzzleFilters
        kinds={draft.gameKinds}
        sources={draft.gameSources}
        difficultyMin={draft.gameDifficultyMin}
        difficultyMax={draft.gameDifficultyMax}
        onKindsChange={(gameKinds) => update({ gameKinds })}
        onSourcesChange={(gameSources) => update({ gameSources })}
        onDifficultyMinChange={(gameDifficultyMin) => update({ gameDifficultyMin })}
        onDifficultyMaxChange={(gameDifficultyMax) => update({ gameDifficultyMax })}
      />
      <p className="text-xs tabular-nums text-fg-muted" aria-live="polite">
        {counts.data ? gamePuzzleCountText(counts.data) : "\u00a0"}
      </p>
    </PracticeCard>
  );
}

/** The page around whichever state the Puzzles page is in (as Play: full width, no header). */
function PuzzlesPage({ children }: { children: ReactNode }) {
  return (
    <div className={pageShell}>
      <div className="flex min-h-full flex-col gap-4 p-6">
        <h1 className="sr-only">Puzzles</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * The cards' places: stacked on a narrow window; from 56rem of width, Practice on the left (as wide
 * as its filters read well) beside the Rating chart over the themes' results.
 */
function PuzzleGrid({
  practice,
  rating,
  themes
}: {
  practice: ReactNode;
  rating: ReactNode;
  themes: ReactNode;
}) {
  return (
    <div className="@container">
      <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]">
        {practice}
        <div className="grid min-w-0 gap-4">
          {rating}
          {themes}
        </div>
      </div>
    </div>
  );
}

/** The installed databases couldn't be read: the main process's message, and Try again. */
function DatabasesError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Couldn't read your databases"
      action={
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <RotateCcw />
          Try again
        </Button>
      }
    >
      {ipcErrorMessage(error) || "The list of installed databases couldn't be loaded."}
    </Notice>
  );
}

/**
 * Practice: the title bar (Reset filters while they differ from the defaults, Manage databases),
 * `children` (the database and the filters), then `footer` (Start and its companions).
 */
function PracticeCard({
  filtersChanged,
  onManageDatabases,
  footer,
  children
}: {
  filtersChanged: boolean;
  onManageDatabases: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const resetFilters = usePuzzleDraftStore((state) => state.resetFilters);
  return (
    <section className={cn(card, "flex flex-col")} aria-labelledby="puzzle-practice-title">
      <CardTitleBar
        id="puzzle-practice-title"
        title="Practice"
        actions={
          <>
            {filtersChanged ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="animate-fade-in"
                onClick={resetFilters}
              >
                <RotateCcw />
                Reset filters
              </Button>
            ) : null}
            <IconButton label="Manage databases" icon={<Database />} onClick={onManageDatabases} />
          </>
        }
      />
      <div className="@container grid gap-5 px-4 pb-4">{children}</div>
      <div className="grid gap-3 border-t border-line-subtle p-4">{footer}</div>
    </section>
  );
}

/**
 * The set the puzzles are drawn from: a downloaded database (its size, else where it comes from)
 * or, when it has puzzles, "From my games".
 */
function SetField({
  databases,
  gameSet,
  value,
  onChange
}: {
  databases: readonly InstalledDatabase[];
  /** The "From my games" set's puzzles (null: not offered). */
  gameSet: number | null;
  value: string;
  onChange: (databaseId: string) => void;
}) {
  const fieldId = useId();
  const selected = databases.find((database) => database.id === value);
  return (
    <Field label="Database" hint={setHint(selected, gameSet)} htmlFor={fieldId}>
      <Select id={fieldId} value={value} onChange={(event) => onChange(event.target.value)}>
        {gameSet === null ? null : (
          <option value={GAME_PUZZLES_SET_ID}>{GAME_PUZZLES_SET_NAME}</option>
        )}
        {databases.map((database) => (
          <option key={database.id} value={database.id}>
            {database.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The set field's hint: how many puzzles or positions the set holds, else where it comes from. */
function setHint(database: InstalledDatabase | undefined, gameSet: number | null): string {
  if (!database)
    return `${(gameSet ?? 0).toLocaleString()} ${gameSet === 1 ? "puzzle" : "puzzles"}`;
  if (!database.recordCount) return `${database.provider}, ${database.format}`;
  return `${database.recordCount.toLocaleString()} ${database.kind === "puzzle" ? "puzzles" : "positions"}`;
}

/** The selected set's filters (a Lichess set's, or a position set's), bound to the draft. */
function SetFilters({
  lichess,
  rating
}: {
  lichess: boolean;
  /** The solver's rating ("Around my rating" draws the Lichess range from it). */
  rating: { rating: number; deviation: number };
}) {
  const draft = usePuzzleDraftStore((state) => state.draft);
  const update = usePuzzleDraftStore((state) => state.update);
  if (!lichess)
    return (
      <PositionTrainingFilters
        difficultyMax={draft.difficultyMax}
        difficultyMin={draft.difficultyMin}
        tags={draft.positionTags}
        onDifficultyMaxChange={(difficultyMax) => update({ difficultyMax })}
        onDifficultyMinChange={(difficultyMin) => update({ difficultyMin })}
        onTagsChange={(positionTags) => update({ positionTags })}
      />
    );
  // "Around my rating": the range follows the solver's current rating.
  const drawn = drawnRatingRange(draft, true, rating.rating);
  return (
    <LichessPuzzleFilters
      lengths={draft.lengths}
      openings={draft.openings}
      popularityMin={draft.popularityMin}
      ratingMax={drawn.ratingMax}
      ratingMin={drawn.ratingMin}
      difficulty={draft.difficulty}
      userRating={formatPuzzleRating(rating)}
      side={draft.side}
      themes={draft.themes}
      onLengthsChange={(lengths) => update({ lengths })}
      onOpeningsChange={(openings) => update({ openings })}
      onPopularityMinChange={(popularityMin) => update({ popularityMin })}
      onRatingMaxChange={(ratingMax) => update({ ratingMax })}
      onRatingMinChange={(ratingMin) => update({ ratingMin })}
      onDifficultyChange={(difficulty: PuzzleDifficulty | null) => update({ difficulty })}
      onSideChange={(side) => update({ side })}
      onThemesChange={(themes) => update({ themes })}
    />
  );
}

/**
 * Practice's actions, under why the last start failed (`error`): Start, and Retry the failed
 * puzzles (`failedCount`). `pending` while a puzzle is drawn (`retrying`: the failed ones). An
 * unrated set says so.
 */
function PracticeActions({
  pending,
  retrying,
  error,
  failedCount,
  unrated,
  onStart,
  onRetryFailed
}: {
  pending: boolean;
  retrying: boolean;
  error: Error | null;
  failedCount: number;
  unrated: boolean;
  onStart: () => void;
  onRetryFailed: () => void;
}) {
  const starting = pending && !retrying;
  // The main process's message (no match, a scanner failure, a replaced search) without the IPC prefix.
  const startError = error ? ipcErrorMessage(error) || String(error) : null;
  return (
    <>
      {startError ? (
        <Notice tone="danger" className="animate-rise-in">
          {startError}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" disabled={pending} onClick={onStart}>
          {starting ? <Loader2 className="animate-spin" /> : <Play />}
          {starting ? "Finding a puzzle…" : "Start puzzles"}
        </Button>
        {failedCount ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onRetryFailed}
            title="Puzzles whose last try failed, from this database (not rated again)"
          >
            {retrying ? <Loader2 className="animate-spin" /> : <Repeat />}
            {retrying
              ? "Finding them…"
              : `Retry ${failedCount} failed ${failedCount === 1 ? "puzzle" : "puzzles"}`}
          </Button>
        ) : null}
        {unrated ? (
          // Position sets grade difficulty 1–4, and puzzles from your games are scheduled instead:
          // neither has a rating to play against.
          <span className="text-xs text-fg-muted">Unrated: no effect on your puzzle rating</span>
        ) : null}
      </div>
    </>
  );
}

/** The same cards at the same places, so the page doesn't jump when the databases load. */
function PuzzleSetupSkeleton() {
  const bar = (
    <div className="flex h-12 items-center px-4">
      <Skeleton className="h-3.5 w-20" />
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Loading databases">
      <PuzzleGrid
        practice={
          <div className={card}>
            {bar}
            <div className="grid gap-5 px-4 pb-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="grid gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-9" />
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {[64, 48, 72, 56, 40, 68].map((width, index) => (
                  <Skeleton key={index} className="h-7 rounded-full" style={{ width }} />
                ))}
              </div>
            </div>
            <div className="border-t border-line-subtle p-4">
              <Skeleton className="h-9 w-36 rounded-lg" />
            </div>
          </div>
        }
        rating={
          <div className={card}>
            {bar}
            <div className="grid gap-4 px-4 pb-4">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-55 rounded-md" />
            </div>
          </div>
        }
        themes={null}
      />
    </div>
  );
}
