import { useId, useMemo, useState, type ReactNode } from "react";
import { Database, Play } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Badge, ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { card, cardPadded, divider, fieldLabel } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDatabasesQuery, useSamplePuzzleMutation } from "../../queries/api";

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

export function PuzzlePage({
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
  const [databaseId, setDatabaseId] = useState<string>(preferred?.id ?? "");
  const selectedDatabase = puzzleDatabases.find((item) => item.id === databaseId) ?? preferred;
  const isLichess = selectedDatabase?.sourceId === "lichess-puzzles";
  const [themes, setThemes] = useState<string[]>([]);
  const [lengths, setLengths] = useState<string[]>([]);
  const [openings, setOpenings] = useState<string[]>([]);
  const [side, setSide] = useState<"any" | "white" | "black">("any");
  const [ratingMin, setRatingMin] = useState(600);
  const [ratingMax, setRatingMax] = useState(2800);
  const [popularityMin, setPopularityMin] = useState(0);
  const [difficultyMin, setDifficultyMin] = useState(1);
  const [difficultyMax, setDifficultyMax] = useState(4);
  const [positionTags, setPositionTags] = useState<string[]>(["initiative", "development"]);
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

  return (
    <Page>
      <PageHeader
        title="Puzzles"
        description="Train on puzzles and positions from your downloaded databases."
        actions={
          selectedDatabase ? (
            <Button type="button" variant="primary" disabled={samplePuzzle.isPending} onClick={start}>
              <Play />
              {samplePuzzle.isPending ? "Finding puzzle…" : "Start puzzle set"}
            </Button>
          ) : null
        }
      />

      {samplePuzzle.error ? (
        <Notice tone="danger">
          {samplePuzzle.error instanceof Error ? samplePuzzle.error.message : String(samplePuzzle.error)}
        </Notice>
      ) : null}

      {selectedDatabase ? (
        <section className={cn(cardPadded, "grid gap-4")}>
          <div className="flex items-end gap-2">
            <Field
              label="Database"
              hint={`${selectedDatabase.provider} · ${selectedDatabase.format}`}
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
      ) : (
        <section className={card}>
          <EmptyState
            icon={<Database />}
            title={databases.isLoading ? "Loading databases…" : "No puzzle database"}
            description={
              databases.isLoading ? undefined : "Download a puzzle or positions database to start training."
            }
            action={
              databases.isLoading ? undefined : (
                <Button type="button" variant="primary" onClick={onDatabases}>
                  <Database />
                  Open databases
                </Button>
              )
            }
          />
        </section>
      )}
    </Page>
  );
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
