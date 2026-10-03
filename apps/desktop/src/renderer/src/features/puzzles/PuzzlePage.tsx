import { memo, useId, useMemo, useState, type ReactNode } from "react";
import { Database, Loader2, Play, Puzzle, RotateCcw } from "lucide-react";
import { externalDatabaseSources, type PuzzleSample } from "@chaturanga/shared/types/database";
import { Badge, ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { card, cardPadded, divider, fieldLabel, sectionTitle, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDatabasesQuery, useSamplePuzzleMutation } from "../../queries/api";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { usePuzzleDraftStore } from "../../stores/puzzle-draft-store";

const lichessThemes = [
  "mate",
  "mateIn1",
  "mateIn2",
  "fork",
  "pin",
  "skewer",
  "sacrifice",
  "attraction",
  "deflection",
  "discoveredAttack",
  "advancedPawn",
  "endgame",
  "middlegame",
  "opening",
  "advantage",
  "crushing"
];

const lichessOpeningTags = [
  "Alekhine_Defense",
  "Benko_Gambit",
  "Benoni_Defense",
  "Bird_Opening",
  "Bishop_Opening",
  "Caro-Kann_Defense",
  "Catalan_Opening",
  "Center_Game",
  "Dutch_Defense",
  "English_Opening",
  "Four_Knights_Game",
  "French_Defense",
  "Grunfeld_Defense",
  "Italian_Game",
  "Kings_Gambit",
  "Kings_Indian_Attack",
  "Kings_Indian_Defense",
  "London_System",
  "Nimzo-Indian_Defense",
  "Nimzowitsch_Defense",
  "Pirc_Defense",
  "Queens_Gambit",
  "Queens_Indian_Defense",
  "Reti_Opening",
  "Ruy_Lopez",
  "Scandinavian_Defense",
  "Scotch_Game",
  "Sicilian_Defense",
  "Slav_Defense",
  "Trompowsky_Attack",
  "Vienna_Game"
];

const strategicTags = [
  "initiative",
  "development",
  "endgame",
  "space",
  "trading",
  "prophylaxis",
  "coordination",
  "exploitingWeakness",
  "kingSafety",
  "restriction",
  "fixingStructure",
  "centreControl"
];

export type PuzzleSessionConfig = {
  databaseId: string | null;
  mode: "lichess-puzzle" | "position-training";
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
  const puzzleDatabases = useMemo(
    () => (databases.data ?? []).filter((item) => item.kind === "puzzle" || item.kind === "position"),
    [databases.data]
  );
  const preferred = puzzleDatabases.find((item) => item.sourceId === "lichess-puzzles") ?? puzzleDatabases[0] ?? null;
  const draft = usePuzzleDraftStore((state) => state.draft);
  const updateDraft = usePuzzleDraftStore((state) => state.update);
  const { themes, lengths, openings, side, ratingMin, ratingMax, popularityMin, difficultyMin, difficultyMax, positionTags } = draft;
  const selectedDatabase = puzzleDatabases.find((item) => item.id === draft.databaseId) ?? preferred;
  const isLichess = selectedDatabase?.sourceId === "lichess-puzzles";
  const setDatabaseId = (value: string) => updateDraft({ databaseId: value });
  const setThemes = (value: string[]) => updateDraft({ themes: value });
  const setLengths = (value: string[]) => updateDraft({ lengths: value });
  const setOpenings = (value: string[]) => updateDraft({ openings: value });
  const setSide = (value: "any" | "white" | "black") => updateDraft({ side: value });
  const setRatingMin = (value: number) => updateDraft({ ratingMin: value });
  const setRatingMax = (value: number) => updateDraft({ ratingMax: value });
  const setPopularityMin = (value: number) => updateDraft({ popularityMin: value });
  const setDifficultyMin = (value: number) => updateDraft({ difficultyMin: value });
  const setDifficultyMax = (value: number) => updateDraft({ difficultyMax: value });
  const setPositionTags = (value: string[]) => updateDraft({ positionTags: value });
  const databaseFieldId = useId();

  function start() {
    if (!selectedDatabase) return;
    const config = {
      databaseId: selectedDatabase.id,
      mode: isLichess ? "lichess-puzzle" : "position-training",
      lichess: {
        ratingMin,
        ratingMax,
        popularityMin,
        lengths,
        themes,
        openings,
        side
      },
      position: {
        difficultyMin,
        difficultyMax,
        tags: positionTags
      }
    } satisfies PuzzleSessionConfig;
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

  const filtersChanged = isLichess
    ? themes.length || lengths.length || openings.length || side !== "any" || ratingMin !== 600 || ratingMax !== 2800 || popularityMin !== 0
    : difficultyMin !== 1 || difficultyMax !== 4 || positionTags.join() !== "initiative,development";

  const resetFilters = usePuzzleDraftStore((state) => state.resetFilters);

  const summary = isLichess
    ? [
        `Rated ${ratingMin}–${ratingMax}`,
        side === "any" ? "Either side to move" : `${side === "white" ? "White" : "Black"} to move`,
        ...(popularityMin !== 0 ? [`Popularity ${popularityMin}+`] : []),
        ...(themes.length ? themes.map(formatTag) : ["Any theme"]),
        ...lengths.map(formatTag),
        ...openings.map(formatTag)
      ]
    : [`Difficulty ${difficultyMin}–${difficultyMax}`, ...(positionTags.length ? positionTags.map(formatTag) : ["Any tag"])];

  // The main process's message (no match, a scanner failure, a replaced search) without the IPC prefix.
  const startError = samplePuzzle.error ? ipcErrorMessage(samplePuzzle.error) || String(samplePuzzle.error) : null;

  return (
    <Page>
      <PageHeader title="Puzzles" description="Train on puzzles and positions from your downloaded databases." />

      {databases.isPending && window.chaturanga ? (
        <PuzzleSetupSkeleton />
      ) : databases.isError ? (
        // A failed read isn't "no database": don't send the user off to download one again.
        <Notice
          tone="danger"
          title="Couldn't read your databases"
          action={
            <Button type="button" variant="outline" size="xs" onClick={() => void databases.refetch()}>
              <RotateCcw />
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(databases.error) || "The list of installed databases couldn't be loaded."}
        </Notice>
      ) : selectedDatabase ? (
        <div className="@container">
          <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
            <section className={cn(cardPadded, "grid gap-5")} aria-label="Filters">
              <div className="flex items-end gap-2">
                <Field
                  label="Database"
                  hint={
                    selectedDatabase.recordCount
                      ? `${selectedDatabase.recordCount.toLocaleString()} ${selectedDatabase.kind === "puzzle" ? "puzzles" : "positions"}`
                      : `${selectedDatabase.provider}, ${selectedDatabase.format}`
                  }
                  htmlFor={databaseFieldId}
                  className="flex-1"
                >
                  <Select
                    id={databaseFieldId}
                    value={selectedDatabase.id}
                    onChange={(event) => setDatabaseId(event.target.value)}
                  >
                    {puzzleDatabases.map((database) => (
                      <option key={database.id} value={database.id}>
                        {database.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <IconButton label="Manage databases" icon={<Database />} variant="outline" size="icon" onClick={onDatabases} />
              </div>
              <div className={divider} />
              {isLichess ? (
                <LichessPuzzleFilters
                  lengths={lengths}
                  openings={openings}
                  popularityMin={popularityMin}
                  ratingMax={ratingMax}
                  ratingMin={ratingMin}
                  side={side}
                  themes={themes}
                  onLengthsChange={setLengths}
                  onOpeningsChange={setOpenings}
                  onPopularityMinChange={setPopularityMin}
                  onRatingMaxChange={setRatingMax}
                  onRatingMinChange={setRatingMin}
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

            {/* The set as it will be drawn, and the one action — first on narrow panels, sticky beside the filters on wide ones. */}
            <aside
              className={cn(cardPadded, "order-first grid gap-4 @3xl:sticky @3xl:top-0 @3xl:order-none")}
              aria-labelledby="puzzle-set-title"
            >
              <div className="grid gap-1">
                <h2 id="puzzle-set-title" className={sectionTitle}>
                  {isLichess ? "Puzzle set" : "Position set"}
                </h2>
                <p className="truncate text-xs text-fg-muted" title={selectedDatabase.name}>
                  {selectedDatabase.name}
                </p>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label="Active filters">
                {summary.map((item) => (
                  <li key={item} className="max-w-full">
                    <Badge size="md" className="max-w-full animate-fade-in">
                      <span className="truncate">{item}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
              {startError ? (
                <Notice tone="danger" className="animate-rise-in">
                  {startError}
                </Notice>
              ) : null}
              <div className="grid gap-2">
                <Button type="button" variant="primary" className="h-10" disabled={samplePuzzle.isPending} onClick={start}>
                  {samplePuzzle.isPending ? <Loader2 className="animate-spin" /> : <Play />}
                  {samplePuzzle.isPending ? "Finding a puzzle…" : "Start puzzle set"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn("transition-opacity duration-standard", !filtersChanged && "pointer-events-none opacity-0")}
                  tabIndex={filtersChanged ? undefined : -1}
                  aria-hidden={filtersChanged ? undefined : true}
                  onClick={resetFilters}
                >
                  <RotateCcw />
                  Reset filters
                </Button>
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <NoPuzzleDatabase onDatabases={onDatabases} />
      )}
    </Page>
  );
});

/** Same footprint as the filters card + set summary, so the page doesn't jump when databases load. */
function PuzzleSetupSkeleton() {
  return (
    <div className="@container" aria-busy="true" aria-label="Loading databases">
      <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
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
  const sources = externalDatabaseSources.filter((source) => source.kind === "puzzle" || source.kind === "position");
  return (
    <section className={cn(card, "grid animate-fade-in gap-6 px-6 py-8 sm:px-8")} aria-labelledby="no-puzzle-db-title">
      <div className="grid max-w-lg gap-2">
        <span className="mb-1 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-fg [&_svg]:size-5">
          <Puzzle aria-hidden="true" />
        </span>
        <h2 id="no-puzzle-db-title" className="text-base font-semibold text-fg">
          Download a database to start training
        </h2>
        <p className="text-sm leading-6 text-fg-muted">
          Puzzles come from free datasets stored on this computer. Pick one on the Databases page; it only needs to be
          downloaded once.
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
                  {compactCount(source.expectedRecords)} {source.kind === "puzzle" ? "puzzles" : "positions"}
                </span>
              ) : null}
            </span>
            <span className="line-clamp-2 text-xs leading-5 text-fg-muted">{source.description}</span>
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
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const sideOptions = [
  { value: "any", label: "Any" },
  { value: "white", label: "White", icon: <SideDot color="white" /> },
  { value: "black", label: "Black", icon: <SideDot color="black" /> }
] as const;

function LichessPuzzleFilters({
  lengths,
  openings,
  popularityMin,
  ratingMax,
  ratingMin,
  side,
  themes,
  onLengthsChange,
  onOpeningsChange,
  onPopularityMinChange,
  onRatingMaxChange,
  onRatingMinChange,
  onSideChange,
  onThemesChange
}: {
  lengths: string[];
  openings: string[];
  popularityMin: number;
  ratingMax: number;
  ratingMin: number;
  side: "any" | "white" | "black";
  themes: string[];
  onLengthsChange: (value: string[]) => void;
  onOpeningsChange: (value: string[]) => void;
  onPopularityMinChange: (value: number) => void;
  onRatingMaxChange: (value: number) => void;
  onRatingMinChange: (value: number) => void;
  onSideChange: (value: "any" | "white" | "black") => void;
  onThemesChange: (value: string[]) => void;
}) {
  const popularityId = useId();
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
        <RangeField
          label="Rating"
          min={0}
          max={3500}
          valueMin={ratingMin}
          valueMax={ratingMax}
          onMinChange={onRatingMinChange}
          onMaxChange={onRatingMaxChange}
        />
        <Field label="Min popularity" hint="−100 to 100" htmlFor={popularityId}>
          <Input
            id={popularityId}
            type="number"
            min={-100}
            max={100}
            value={popularityMin}
            onChange={(event) => onPopularityMinChange(Number(event.target.value))}
          />
        </Field>
        <FilterGroup label="Side to move">
          <SegmentedControl
            ariaLabel="Side to move"
            options={sideOptions}
            value={side}
            onChange={onSideChange}
          />
        </FilterGroup>
      </div>
      <FilterGroup label="Themes">
        <ChipAutocomplete items={lichessThemes} placeholder="Search themes" selected={themes} onChange={onThemesChange} />
      </FilterGroup>
      <FilterGroup label="Solution length">
        <ChipToggleGroup items={["oneMove", "short", "long", "veryLong"]} selected={lengths} onChange={onLengthsChange} />
      </FilterGroup>
      <Disclosure title="Openings" summary={selectionSummary(openings)}>
        <ChipAutocomplete
          items={lichessOpeningTags}
          placeholder="Search openings"
          selected={openings}
          onChange={onOpeningsChange}
        />
      </Disclosure>
    </div>
  );
}

function PositionTrainingFilters({
  difficultyMax,
  difficultyMin,
  tags,
  onDifficultyMaxChange,
  onDifficultyMinChange,
  onTagsChange
}: {
  difficultyMax: number;
  difficultyMin: number;
  tags: string[];
  onDifficultyMaxChange: (value: number) => void;
  onDifficultyMinChange: (value: number) => void;
  onTagsChange: (value: string[]) => void;
}) {
  return (
    <div className="grid gap-4">
      <RangeField
        label="Difficulty"
        hint="1–10"
        className="max-w-sm"
        min={1}
        max={10}
        valueMin={difficultyMin}
        valueMax={difficultyMax}
        onMinChange={onDifficultyMinChange}
        onMaxChange={onDifficultyMaxChange}
      />
      <FilterGroup label="Strategic tags">
        <ChipToggleGroup items={strategicTags} selected={tags} onChange={onTagsChange} />
      </FilterGroup>
    </div>
  );
}

/** "Any" / the single selected label / "3 selected" — Disclosure summary for a multi-select. */
function selectionSummary(selected: string[]): string {
  if (!selected.length) return "Any";
  if (selected.length === 1) return formatTag(selected[0]);
  return `${selected.length} selected`;
}

/** Display label for a Lichess/strategic tag value: "Caro-Kann_Defense" → "Caro-Kann Defense", "mateIn2" → "mate in 2". */
function formatTag(value: string): string {
  if (value.includes("_")) return value.replace(/_/g, " ");
  return value
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .toLowerCase();
}

/**
 * Labelled group for controls that aren't a single input (chips, segmented picker).
 * Same label style as <Field>, exposed as role="group" for screen readers.
 */
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="grid min-w-0 content-start gap-1.5">
      <span id={labelId} className={fieldLabel}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** Min–max number pair under one label ("Rating 600 – 2800"). */
function RangeField({
  label,
  hint,
  min,
  max,
  valueMin,
  valueMax,
  onMinChange,
  onMaxChange,
  className
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-label={`Minimum ${label.toLowerCase()}`}
          type="number"
          min={min}
          max={max}
          value={valueMin}
          onChange={(event) => onMinChange(Number(event.target.value))}
        />
        <span aria-hidden="true" className="text-fg-subtle">
          –
        </span>
        <Input
          aria-label={`Maximum ${label.toLowerCase()}`}
          type="number"
          min={min}
          max={max}
          value={valueMax}
          onChange={(event) => onMaxChange(Number(event.target.value))}
        />
      </div>
    </Field>
  );
}

function ChipAutocomplete({
  items,
  placeholder,
  selected,
  onChange
}: {
  items: string[];
  placeholder: string;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => !selected.includes(item))
      .filter((item) => (q ? item.toLowerCase().includes(q) || formatTag(item).toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [items, query, selected]);

  function add(item: string) {
    if (selected.includes(item)) return;
    onChange([...selected, item]);
    setQuery("");
  }

  function remove(item: string) {
    onChange(selected.filter((value) => value !== item));
  }

  return (
    <div className="grid gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-sunken px-2 py-1 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15">
        {selected.map((item) => (
          <Badge key={item} tone="accent" size="md" onRemove={() => remove(item)} removeLabel={`Remove ${formatTag(item)}`}>
            {formatTag(item)}
          </Badge>
        ))}
        <input
          className="h-7 min-w-40 flex-1 border-0 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !query && selected.length) {
              remove(selected[selected.length - 1]);
            }
            if (event.key === "Enter" && available[0]) {
              event.preventDefault();
              add(available[0]);
            }
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {available.map((item) => (
          <ChipButton key={item} onClick={() => add(item)}>
            {formatTag(item)}
          </ChipButton>
        ))}
        {!available.length ? <span className="text-xs text-fg-subtle">No matches</span> : null}
      </div>
    </div>
  );
}

function ChipToggleGroup({
  items,
  selected,
  onChange
}: {
  items: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const active = selected.includes(item);
        return (
          <ChipButton
            key={item}
            selected={active}
            onClick={() => onChange(active ? selected.filter((value) => value !== item) : [...selected, item])}
          >
            {formatTag(item)}
          </ChipButton>
        );
      })}
    </div>
  );
}
