import { memo, useId, useMemo, type ReactNode } from "react";
import { Database, Loader2, Play, Puzzle, Repeat, RotateCcw } from "lucide-react";
import {
  DEFAULT_PUZZLE_RATING,
  type PuzzleDifficulty
} from "@chaturanga/shared/chess/puzzle-rating";
import {
  externalDatabaseSources,
  type ExternalDatabaseSource,
  type InstalledDatabase,
  type PuzzleSample
} from "@chaturanga/shared/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { card, cardPadded, divider, sectionTitle, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDatabasesQuery, useSamplePuzzleMutation } from "../../queries/api";
import { useFailedPuzzlesQuery, usePuzzleRatingSummaryQuery } from "../../queries/puzzles";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { usePuzzleDraftStore } from "../../stores/puzzle-draft-store";
import {
  activeFilterLabels,
  drawnRatingRange,
  puzzleDatabasesOf,
  puzzleFiltersChanged,
  puzzleSetConfig,
  selectedPuzzleDatabase
} from "./puzzle-set";
import { LichessPuzzleFilters, PositionTrainingFilters } from "./PuzzleFilters";
import { PuzzleRatingCard } from "./PuzzleRatingCard";
import { formatPuzzleRating } from "./PuzzleRatingLine";

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
  const {
    themes,
    lengths,
    openings,
    side,
    difficulty,
    popularityMin,
    difficultyMin,
    difficultyMax,
    positionTags
  } = draft;
  const selectedDatabase = selectedPuzzleDatabase(puzzleDatabases, draft.databaseId);
  const isLichess = selectedDatabase?.sourceId === "lichess-puzzles";
  const ratingSummary = usePuzzleRatingSummaryQuery();
  const userRating = ratingSummary.data ?? { ...DEFAULT_PUZZLE_RATING };
  // "Around my rating": the range follows the solver's current rating (Lichess sets only).
  const drawn = drawnRatingRange(draft, isLichess, userRating.rating);
  const failedPuzzles = useFailedPuzzlesQuery(selectedDatabase?.sourceId ?? null);
  const failedIds = useMemo(
    () => (failedPuzzles.data ?? []).map((puzzle) => puzzle.puzzleId),
    [failedPuzzles.data]
  );
  const setDatabaseId = (value: string) => updateDraft({ databaseId: value });
  const setThemes = (value: string[]) => updateDraft({ themes: value });
  const setLengths = (value: string[]) => updateDraft({ lengths: value });
  const setOpenings = (value: string[]) => updateDraft({ openings: value });
  const setSide = (value: "any" | "white" | "black") => updateDraft({ side: value });
  const onRatingMinChange = (value: number) => updateDraft({ ratingMin: value });
  const onRatingMaxChange = (value: number) => updateDraft({ ratingMax: value });
  const setDifficulty = (value: PuzzleDifficulty | null) => updateDraft({ difficulty: value });
  const setPopularityMin = (value: number) => updateDraft({ popularityMin: value });
  const setDifficultyMin = (value: number) => updateDraft({ difficultyMin: value });
  const setDifficultyMax = (value: number) => updateDraft({ difficultyMax: value });
  const setPositionTags = (value: string[]) => updateDraft({ positionTags: value });

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
        <NoPuzzleDatabase onDatabases={onDatabases} />
      </PuzzlesPage>
    );
  return (
    <PuzzlesPage>
      <div className="@container">
        <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_var(--side-column)]">
          <section className={cn(cardPadded, "grid gap-5")} aria-label="Filters">
            <DatabaseField
              databases={puzzleDatabases}
              selected={selectedDatabase}
              onChange={setDatabaseId}
              onManage={onDatabases}
            />
            <div className={divider} />
            {isLichess ? (
              <LichessPuzzleFilters
                lengths={lengths}
                openings={openings}
                popularityMin={popularityMin}
                ratingMax={drawn.ratingMax}
                ratingMin={drawn.ratingMin}
                difficulty={difficulty}
                userRating={formatPuzzleRating(userRating)}
                side={side}
                themes={themes}
                onLengthsChange={setLengths}
                onOpeningsChange={setOpenings}
                onPopularityMinChange={setPopularityMin}
                onRatingMaxChange={onRatingMaxChange}
                onRatingMinChange={onRatingMinChange}
                onDifficultyChange={setDifficulty}
                onSideChange={setSide}
                onThemesChange={setThemes}
              />
            ) : (
              <PositionTrainingFilters
                difficultyMax={difficultyMax}
                difficultyMin={difficultyMin}
                tags={positionTags}
                onDifficultyMaxChange={setDifficultyMax}
                onDifficultyMinChange={setDifficultyMin}
                onTagsChange={setPositionTags}
              />
            )}
          </section>

          {/*
            The set as it will be drawn, its actions, and the rating — first on narrow panels, sticky
            beside the filters on wide ones.
          */}
          <div className="order-first grid gap-6 @3xl:sticky @3xl:top-0 @3xl:order-none">
            <PuzzleSetCard
              lichess={isLichess}
              databaseName={selectedDatabase.name}
              filters={activeFilterLabels(draft, isLichess, drawn)}
            >
              <PuzzleSetActions
                sample={samplePuzzle}
                failedCount={failedIds.length}
                filtersChanged={puzzleFiltersChanged(draft, isLichess)}
                onStart={start}
                onRetryFailed={retryFailed}
              />
            </PuzzleSetCard>
            <PuzzleRatingCard />
          </div>
        </div>
      </div>
    </PuzzlesPage>
  );
});

/** The page around whichever state the Puzzles page is in. */
function PuzzlesPage({ children }: { children: ReactNode }) {
  return (
    <Page>
      <PageHeader
        title="Puzzles"
        description="Train on puzzles and positions from your downloaded databases."
      />

      {children}
    </Page>
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
 * The database the set is drawn from (its size, else where it comes from), and Manage databases.
 */
function DatabaseField({
  databases,
  selected,
  onChange,
  onManage
}: {
  databases: readonly InstalledDatabase[];
  selected: InstalledDatabase;
  onChange: (databaseId: string) => void;
  onManage: () => void;
}) {
  const fieldId = useId();
  return (
    <div className="flex items-end gap-2">
      <Field
        label="Database"
        hint={
          selected.recordCount
            ? `${selected.recordCount.toLocaleString()} ${selected.kind === "puzzle" ? "puzzles" : "positions"}`
            : `${selected.provider}, ${selected.format}`
        }
        htmlFor={fieldId}
        className="flex-1"
      >
        <Select id={fieldId} value={selected.id} onChange={(event) => onChange(event.target.value)}>
          {databases.map((database) => (
            <option key={database.id} value={database.id}>
              {database.name}
            </option>
          ))}
        </Select>
      </Field>
      <IconButton
        label="Manage databases"
        icon={<Database />}
        variant="outline"
        size="icon"
        onClick={onManage}
      />
    </div>
  );
}

/**
 * The set as it will be drawn: its kind and database, the filters that apply, and its actions
 * (PuzzleSetActions).
 */
function PuzzleSetCard({
  lichess,
  databaseName,
  filters,
  children
}: {
  lichess: boolean;
  databaseName: string;
  filters: readonly string[];
  children: ReactNode;
}) {
  return (
    <aside className={cn(cardPadded, "grid gap-4")} aria-labelledby="puzzle-set-title">
      <div className="grid gap-1">
        <h2 id="puzzle-set-title" className={sectionTitle}>
          {lichess ? "Puzzle set" : "Position set"}
        </h2>
        <p className="truncate text-xs text-fg-muted" title={databaseName}>
          {databaseName}
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Active filters">
        {filters.map((item) => (
          <li key={item} className="max-w-full">
            <Badge size="md" className="max-w-full animate-fade-in">
              <span className="truncate">{item}</span>
            </Badge>
          </li>
        ))}
      </ul>
      {lichess ? null : (
        // The position set grades difficulty 1–4, with no rating to play against.
        <p className="text-xs leading-5 text-fg-muted">
          Unrated: these positions don&apos;t change your puzzle rating.
        </p>
      )}
      {children}
    </aside>
  );
}

/**
 * The set's actions, under why the last start failed: Start, Retry the failed puzzles
 * (`failedCount`), and Reset filters (while they differ from the defaults). `sample` draws the
 * first puzzle.
 */
function PuzzleSetActions({
  sample,
  failedCount,
  filtersChanged,
  onStart,
  onRetryFailed
}: {
  sample: ReturnType<typeof useSamplePuzzleMutation>;
  failedCount: number;
  filtersChanged: boolean;
  onStart: () => void;
  onRetryFailed: () => void;
}) {
  const resetFilters = usePuzzleDraftStore((state) => state.resetFilters);
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
      <div className="grid gap-2">
        <Button
          type="button"
          variant="primary"
          className="h-10"
          disabled={sample.isPending}
          onClick={onStart}
        >
          {starting ? <Loader2 className="animate-spin" /> : <Play />}
          {starting ? "Finding a puzzle…" : "Start puzzle set"}
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "transition-opacity duration-standard",
            !filtersChanged && "pointer-events-none opacity-0"
          )}
          tabIndex={filtersChanged ? undefined : -1}
          aria-hidden={filtersChanged ? undefined : true}
          onClick={resetFilters}
        >
          <RotateCcw />
          Reset filters
        </Button>
      </div>
    </>
  );
}

/** Same footprint as the filters card + set summary, so the page doesn't jump when databases load. */
function PuzzleSetupSkeleton() {
  return (
    <div className="@container" aria-busy="true" aria-label="Loading databases">
      <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_var(--side-column)]">
        <div className={cn(cardPadded, "grid gap-5")}>
          <div className="grid gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9" />
          </div>
          <div className={divider} />
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-9" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[64, 48, 72, 56, 40, 68, 52].map((width, index) => (
              <Skeleton key={index} className="h-7 rounded-full" style={{ width }} />
            ))}
          </div>
        </div>
        <div className={cn(cardPadded, "order-first grid gap-4 @3xl:order-none")}>
          <Skeleton className="h-3.5 w-24" />
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
          <Skeleton className="h-10 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** No puzzle or position database yet: what each one offers, and the way to get it. */
function NoPuzzleDatabase({ onDatabases }: { onDatabases: () => void }) {
  // Read as any catalogue source, not just today's: a game library has no place here.
  const catalogue: readonly ExternalDatabaseSource[] = externalDatabaseSources;
  const sources = catalogue.filter(
    (source) => source.kind === "puzzle" || source.kind === "position"
  );
  return (
    <section
      className={cn(card, "grid animate-fade-in gap-6 px-6 py-8 sm:px-8")}
      aria-labelledby="no-puzzle-db-title"
    >
      <div className="grid max-w-lg gap-2">
        <span className="mb-1 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-fg [&_svg]:size-5">
          <Puzzle aria-hidden="true" />
        </span>
        <h2 id="no-puzzle-db-title" className="text-base font-semibold text-fg">
          Download a database to start training
        </h2>
        <p className="text-sm leading-6 text-fg-muted">
          Puzzles come from free datasets stored on this computer. Pick one on the Databases page;
          it only needs to be downloaded once.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <li key={source.id} className={cn(well, "grid content-start gap-1 px-4 py-3")}>
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-fg-secondary" title={source.name}>
                {source.name}
              </span>
              {source.expectedRecords ? (
                <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                  {compactCount(source.expectedRecords)}{" "}
                  {source.kind === "puzzle" ? "puzzles" : "positions"}
                </span>
              ) : null}
            </span>
            <span className="line-clamp-2 text-xs leading-5 text-fg-muted">
              {source.description}
            </span>
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" variant="primary" onClick={onDatabases}>
          <Database />
          Open databases
        </Button>
      </div>
    </section>
  );
}

/** 5939980 → "5.9M", 12431 → "12K". */
function compactCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}
