import { memo, useId, useMemo, type ReactNode } from "react";
import { Database, Loader2, Play, Puzzle, Repeat, RotateCcw } from "lucide-react";
import {
  DEFAULT_PUZZLE_RATING,
  type PuzzleDifficulty
} from "@chaturanga/shared/chess/puzzle-rating";
import type { InstalledDatabase, PuzzleSample } from "@chaturanga/shared/types/database";
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
import { useFailedPuzzlesQuery, usePuzzleRatingSummaryQuery } from "../../queries/puzzles";
import { usePuzzleDraftStore } from "../../stores/puzzle-draft-store";
import { CardTitleBar } from "../play/card-title";
import {
  drawnRatingRange,
  puzzleDatabasesOf,
  puzzleFiltersChanged,
  puzzleSetConfig,
  selectedPuzzleDatabase
} from "./puzzle-set";
import { LichessPuzzleFilters, PositionTrainingFilters } from "./PuzzleFilters";
import { PuzzleRatingChart } from "./PuzzleRatingChart";
import { formatPuzzleRating } from "./PuzzleRatingLine";
import { PuzzleThemeChart } from "./PuzzleThemeChart";
import { toggleTheme } from "./rating-chart";

export type PuzzleSessionConfig = {
  databaseId: string | null;
  mode: "lichess-puzzle" | "position-training";
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
  const samplePuzzle = useSamplePuzzleMutation();
  const puzzleDatabases = useMemo(() => puzzleDatabasesOf(databases.data ?? []), [databases.data]);
  const draft = usePuzzleDraftStore((state) => state.draft);
  const updateDraft = usePuzzleDraftStore((state) => state.update);
  const selectedDatabase = selectedPuzzleDatabase(puzzleDatabases, draft.databaseId);
  const isLichess = selectedDatabase?.sourceId === "lichess-puzzles";
  const ratingSummary = usePuzzleRatingSummaryQuery();
  const userRating = ratingSummary.data ?? { ...DEFAULT_PUZZLE_RATING };
  const failedPuzzles = useFailedPuzzlesQuery(selectedDatabase?.sourceId ?? null);
  const failedIds = useMemo(
    () => (failedPuzzles.data ?? []).map((puzzle) => puzzle.puzzleId),
    [failedPuzzles.data]
  );
  const themes = draft.themes;
  const onToggleTheme = useMemo(
    () =>
      isLichess ? (theme: string) => updateDraft({ themes: toggleTheme(themes, theme) }) : null,
    [isLichess, themes, updateDraft]
  );

  function sessionConfig(database: NonNullable<typeof selectedDatabase>): PuzzleSessionConfig {
    return puzzleSetConfig(draft, database, userRating.rating);
  }

  function start() {
    if (!selectedDatabase) return;
    const config = sessionConfig(selectedDatabase);
    samplePuzzle.mutate(
      {
        databaseId: selectedDatabase.id,
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
    if (!selectedDatabase || !failedIds.length) return;
    const config: PuzzleSessionConfig = {
      ...sessionConfig(selectedDatabase),
      retryIds: failedIds
    };
    samplePuzzle.mutate(
      { databaseId: selectedDatabase.id, ids: failedIds },
      { onSuccess: (puzzle) => onStart(config, puzzle) }
    );
  }

  if (databases.isPending && window.chaturanga)
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
  if (!selectedDatabase)
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
  return (
    <PuzzlesPage>
      <PuzzleGrid
        practice={
          <PracticeCard
            filtersChanged={puzzleFiltersChanged(draft, isLichess)}
            onManageDatabases={onDatabases}
            footer={
              <PracticeActions
                sample={samplePuzzle}
                failedCount={failedIds.length}
                unrated={!isLichess}
                onStart={start}
                onRetryFailed={retryFailed}
              />
            }
          >
            <DatabaseField
              databases={puzzleDatabases}
              selected={selectedDatabase}
              onChange={(databaseId) => updateDraft({ databaseId })}
            />
            <SetFilters lichess={isLichess} rating={userRating} />
          </PracticeCard>
        }
        rating={<PuzzleRatingChart />}
        themes={<PuzzleThemeChart selected={themes} onToggleTheme={onToggleTheme} />}
      />
    </PuzzlesPage>
  );
});

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

/** The database the set is drawn from (its size, else where it comes from). */
function DatabaseField({
  databases,
  selected,
  onChange
}: {
  databases: readonly InstalledDatabase[];
  selected: InstalledDatabase;
  onChange: (databaseId: string) => void;
}) {
  const fieldId = useId();
  return (
    <Field
      label="Database"
      hint={
        selected.recordCount
          ? `${selected.recordCount.toLocaleString()} ${selected.kind === "puzzle" ? "puzzles" : "positions"}`
          : `${selected.provider}, ${selected.format}`
      }
      htmlFor={fieldId}
    >
      <Select id={fieldId} value={selected.id} onChange={(event) => onChange(event.target.value)}>
        {databases.map((database) => (
          <option key={database.id} value={database.id}>
            {database.name}
          </option>
        ))}
      </Select>
    </Field>
  );
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
 * Practice's actions, under why the last start failed: Start, and Retry the failed puzzles
 * (`failedCount`). `sample` draws the first puzzle. A position set says it is unrated.
 */
function PracticeActions({
  sample,
  failedCount,
  unrated,
  onStart,
  onRetryFailed
}: {
  sample: ReturnType<typeof useSamplePuzzleMutation>;
  failedCount: number;
  unrated: boolean;
  onStart: () => void;
  onRetryFailed: () => void;
}) {
  const retrying = sample.isPending && Boolean(sample.variables.ids);
  const starting = sample.isPending && !retrying;
  // The main process's message (no match, a scanner failure, a replaced search) without the IPC prefix.
  const startError = sample.error ? ipcErrorMessage(sample.error) || String(sample.error) : null;
  return (
    <>
      {startError ? (
        <Notice tone="danger" className="animate-rise-in">
          {startError}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" disabled={sample.isPending} onClick={onStart}>
          {starting ? <Loader2 className="animate-spin" /> : <Play />}
          {starting ? "Finding a puzzle…" : "Start puzzles"}
        </Button>
        {failedCount ? (
          <Button
            type="button"
            variant="outline"
            disabled={sample.isPending}
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
          // The position set grades difficulty 1–4, with no rating to play against.
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
