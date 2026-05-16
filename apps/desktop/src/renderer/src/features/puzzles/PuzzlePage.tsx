import { useMemo, useState } from "react";
import { Database, Play, Puzzle, X } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDatabasesQuery } from "../../queries/api";
import { useSamplePuzzleMutation } from "../../queries/api";
import { input, muted } from "@/lib/ui";

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
  sourceId: string | null;
  mode: "lichess-puzzle" | "position-training" | "manual";
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

  function start() {
    const config = {
      databaseId: selectedDatabase?.id ?? null,
      sourceId: selectedDatabase?.sourceId ?? null,
      mode: isLichess ? "lichess-puzzle" : selectedDatabase ? "position-training" : "manual",
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
    if (!selectedDatabase) return;
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
    <div className="mx-auto grid h-full w-full max-w-5xl content-start gap-5 overflow-auto px-8 py-8">
      <div className="grid gap-2">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-[#f4f1ea]">Puzzles</h1>
        <p className="max-w-3xl text-sm leading-6 text-[#a9adb4]">
          Build a focused training set from downloaded puzzle and position databases.
        </p>
      </div>

      <section className="grid gap-3 rounded-[12px] border border-white/10 bg-[#181a1d]/95 bg-gradient-to-b from-white/[0.05] to-transparent p-4 shadow-[0_16px_44px_rgb(0_0_0/0.24)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[9px] border border-white/10 bg-[#263527] text-[#cce6b2]">
              <Database size={19} />
            </span>
            <div className="grid gap-0.5">
              <h2 className="text-[16px] font-semibold text-[#f4f1ea]">Training database</h2>
              <span className={muted}>
                {selectedDatabase
                  ? `${selectedDatabase.provider} · ${selectedDatabase.format}`
                  : "No puzzle database downloaded"}
              </span>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={onDatabases}>
            <Database size={16} />
            Manage databases
          </Button>
        </div>

        {puzzleDatabases.length ? (
          <select
            className={input}
            value={selectedDatabase?.id ?? ""}
            onChange={(event) => setDatabaseId(event.target.value)}
          >
            {puzzleDatabases.map((database) => (
              <option key={database.id} value={database.id}>
                {database.name} ({database.kind})
              </option>
            ))}
          </select>
        ) : (
          <div className="rounded-lg border border-[#3a3030] bg-[#231b1b] px-3 py-2 text-[13px] text-[#ffb5a8]">
            Download the Lichess puzzle database or a supported positions CSV before starting a dataset-backed puzzle set.
          </div>
        )}
      </section>

      {selectedDatabase && isLichess ? (
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
      ) : selectedDatabase ? (
        <PositionTrainingFilters
          difficultyMax={difficultyMax}
          difficultyMin={difficultyMin}
          tags={positionTags}
          onDifficultyMaxChange={setDifficultyMax}
          onDifficultyMinChange={setDifficultyMin}
          onTagsChange={setPositionTags}
        />
      ) : (
        <section className="grid gap-3 rounded-[12px] border border-white/10 bg-[#181a1d]/95 p-4">
          <h2 className="text-[16px] font-semibold text-[#f4f1ea]">No dataset selected</h2>
          <p className="text-sm leading-6 text-[#a9adb4]">
            Download a puzzle database to unlock theme, opening, rating, and difficulty filters.
          </p>
          <Button type="button" variant="secondary" className="justify-self-start" onClick={onDatabases}>
            <Database size={16} />
            Open databases
          </Button>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!selectedDatabase || samplePuzzle.isPending}
          onClick={start}
        >
          <Play size={16} />
          {samplePuzzle.isPending ? "Finding puzzle..." : "Start puzzle set"}
        </Button>
        {samplePuzzle.error ? (
          <span className="text-[12px] text-[#ffb5a8]">
            {samplePuzzle.error instanceof Error ? samplePuzzle.error.message : String(samplePuzzle.error)}
          </span>
        ) : null}
        <span className="text-[12px] text-[#a9adb4]">
          {isLichess
            ? `${themes.length || "Any"} themes · ${lengths.length || "Any"} lengths · ${ratingMin}-${ratingMax}`
            : selectedDatabase
              ? `${positionTags.length || "Any"} tags · difficulty ${difficultyMin}-${difficultyMax}`
              : "Manual puzzle board"}
        </span>
      </div>
    </div>
  );
}

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
  return (
    <section className="grid gap-4 rounded-[12px] border border-white/10 bg-[#181a1d]/95 p-4">
      <div className="flex items-center gap-2">
        <Puzzle size={18} className="text-[#cce6b2]" />
        <h2 className="text-[16px] font-semibold text-[#f4f1ea]">Lichess puzzle filters</h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <NumberField label="Rating min" value={ratingMin} min={0} max={3500} onChange={onRatingMinChange} />
        <NumberField label="Rating max" value={ratingMax} min={0} max={3500} onChange={onRatingMaxChange} />
        <NumberField label="Popularity min" value={popularityMin} min={-100} max={100} onChange={onPopularityMinChange} />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-semibold text-[#f4f1ea]">Themes</span>
        <ChipAutocomplete
          items={lichessThemes}
          placeholder="Search themes..."
          selected={themes}
          onChange={onThemesChange}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-2">
          <span className="text-sm font-semibold text-[#f4f1ea]">Solution length</span>
          <TagGrid items={["oneMove", "short", "long", "veryLong"]} selected={lengths} onChange={onLengthsChange} />
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-semibold text-[#f4f1ea]">Side to move</span>
          <div className="grid grid-cols-3 gap-2">
            {(["any", "white", "black"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={side === value ? "secondary" : "outline"}
                onClick={() => onSideChange(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-semibold text-[#f4f1ea]">Opening tags</span>
        <ChipAutocomplete
          items={lichessOpeningTags}
          placeholder="Search openings..."
          selected={openings}
          onChange={onOpeningsChange}
        />
      </div>
    </section>
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
    <section className="grid gap-4 rounded-[12px] border border-white/10 bg-[#181a1d]/95 p-4">
      <h2 className="text-[16px] font-semibold text-[#f4f1ea]">Position database filters</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <NumberField label="Difficulty min" value={difficultyMin} min={1} max={10} onChange={onDifficultyMinChange} />
        <NumberField label="Difficulty max" value={difficultyMax} min={1} max={10} onChange={onDifficultyMaxChange} />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-semibold text-[#f4f1ea]">Strategic tags</span>
        <TagGrid items={strategicTags} selected={tags} onChange={onTagsChange} />
      </div>
    </section>
  );
}

function NumberField({
  label,
  max,
  min,
  value,
  onChange
}: {
  label: string;
  max: number;
  min: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-[#d8d8d8]">
      {label}
      <input
        className={input}
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
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
      .filter((item) => (q ? item.toLowerCase().includes(q) : true))
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
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-[9px] border border-[#30343a] bg-[#141619] px-2 py-1.5 focus-within:border-[#8fb66f]/60">
        {selected.map((item) => (
          <span
            key={item}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[#8fb66f]/35 bg-[#8fb66f]/18 px-2.5 py-1 text-[12px] font-semibold text-[#f6ffe9]"
          >
            {item}
            <button
              type="button"
              className="rounded-full text-[#d7e8c5] hover:text-white"
              onClick={() => remove(item)}
              aria-label={`Remove ${item}`}
            >
              <X size={13} />
            </button>
          </span>
        ))}
        <input
          className="min-h-7 min-w-[180px] flex-1 border-0 bg-transparent px-1 text-sm text-[#f4f1ea] outline-none placeholder:text-[#727982]"
          value={query}
          placeholder={selected.length ? placeholder : `${placeholder} Select one or more`}
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
      <div className="flex flex-wrap gap-2">
        {available.map((item) => (
          <button
            key={item}
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] font-semibold text-[#a9adb4] transition-colors hover:bg-white/[0.07] hover:text-[#f4f1ea]"
            onClick={() => add(item)}
          >
            {item}
          </button>
        ))}
        {!available.length ? (
          <span className="text-[12px] text-[#727982]">No matches</span>
        ) : null}
      </div>
    </div>
  );
}

function TagGrid({
  items,
  selected,
  onChange
}: {
  items: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = selected.includes(item);
        return (
          <button
            key={item}
            type="button"
            className={cn(
              "rounded-full border px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
              active
                ? "border-[#8fb66f]/45 bg-[#8fb66f]/18 text-[#f6ffe9]"
                : "border-white/10 bg-white/[0.03] text-[#a9adb4] hover:bg-white/[0.07] hover:text-[#f4f1ea]"
            )}
            onClick={() =>
              onChange(active ? selected.filter((value) => value !== item) : [...selected, item])
            }
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}
