import { useId, useMemo } from "react";
import { AlertTriangle, Search } from "lucide-react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { isOneOf } from "@chaturanga/shared/types/guards";
import {
  CHAPTER_KINDS,
  type ChapterKind,
  type ImportInvalidBranch,
  type ImportPreview,
  type ImportPreviewGame,
  type ImportSelection,
  type RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatCell, StatStrip } from "@/components/ui/stat-strip";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useBookOpeningsQuery } from "../../queries/repertoire-practice";
import { BookOpeningsDatalist } from "./BookOpeningsDatalist";
import { FieldError, fieldErrorAria } from "./FieldError";
import { importStats, type ImportStats } from "./import-inference";
import { PREVIEW_PAGE_SIZE, setGamesIncluded, setGamesKind } from "./long-lists";
import { nameError } from "./repertoire-metadata";
import { plural } from "./repertoire-chapters";
import { nodeIdForPathLabel } from "./repertoire-model";
import { IMPORT_KIND_HELP, importPracticeNote } from "./training-explanations";
import type { ImportGameList } from "./useImportGameList";
import type { ImportJob } from "./useImportJob";

/** The preview step's actions: back to the input, or import the included games. */
export function ImportPreviewActions({
  job,
  games,
  repertoireLoaded,
  create
}: {
  job: ImportJob;
  games: ImportGameList;
  repertoireLoaded: boolean;
  /** A new repertoire's name and colour (null: importing into an existing one). */
  create: { name: string; color: RepertoireColor } | null;
}) {
  const nameMissing = create !== null && Boolean(nameError(create.name));
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={job.busy}
        onClick={job.discardPreview}
      >
        Back
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={job.busy || !games.included || !repertoireLoaded || nameMissing}
        onClick={() =>
          void job.commit(
            games.selections,
            create ? { name: create.name.trim(), color: create.color } : undefined
          )
        }
      >
        {job.committing ? "Importing…" : `Import ${plural(games.included, "chapter")}`}
      </Button>
    </>
  );
}

/** Every previewed game as a row to include, rename or re-kind, with search and bulk actions. */
export function ImportPreviewBody({
  preview,
  games,
  lookups,
  color,
  newRepertoire,
  busy
}: {
  preview: ImportPreview;
  games: ImportGameList;
  /** Per game, the lookup that finds its illegal branches' nodes (null when it has none). */
  lookups: (ChapterLookup | null)[];
  color: RepertoireColor | null;
  /** A new repertoire's name and colour, editable (null: importing into an existing one). */
  newRepertoire: NewRepertoireFields | null;
  busy: boolean;
}) {
  const { found, shownCount, listRef } = games;
  const openings = useBookOpeningsQuery();
  const ecoByName = useMemo(
    () => new Map(openings.data?.map((opening) => [opening.name, opening.eco])),
    [openings.data]
  );
  const datalistId = useId();
  return (
    <>
      {newRepertoire ? <NewRepertoireLine fields={newRepertoire} /> : null}
      {color ? (
        <ImportStatStrip
          stats={importStats(preview, games.selections, color)}
          onShow={games.showOnly}
        />
      ) : null}
      <BookOpeningsDatalist id={datalistId} openings={openings.data} />
      <p className="shrink-0 text-2xs text-fg-muted">{IMPORT_KIND_HELP}</p>
      {preview.games.length > 1 ? (
        <ImportGamesToolbar games={preview.games} list={games} busy={busy} />
      ) : null}
      <div className="scroll-area -mx-1 grid min-h-0 content-start gap-2 overflow-y-auto px-1">
        <ul ref={listRef} className="grid gap-2" aria-label="Games in the PGN">
          {games.shown.map((index) => {
            const game = preview.games.at(index);
            const selection = games.selections.at(index);
            if (!game || !selection) return null;
            return (
              <ImportGameRow
                key={game.index}
                index={index}
                game={game}
                selection={selection}
                lookup={lookups[index]}
                color={color}
                datalistId={datalistId}
                ecoByName={ecoByName}
                onChange={(patch) => games.update(index, patch)}
              />
            );
          })}
        </ul>
        {games.searching && !found.length ? (
          <p className="text-xs text-fg-muted">No games match “{games.query.trim()}”.</p>
        ) : null}
        {found.length > shownCount ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={games.showMore}
          >
            Show {Math.min(PREVIEW_PAGE_SIZE, found.length - shownCount)} more (
            {found.length - shownCount} not shown)
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** The search over the games, the count included, and include/exclude/kind for those found. */
function ImportGamesToolbar({
  games,
  list,
  busy
}: {
  games: ImportPreviewGame[];
  list: ImportGameList;
  busy: boolean;
}) {
  const { found, searching, setSelections } = list;
  return (
    <div className="grid shrink-0 gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search games"
          placeholder="Search by title or game number"
          className="h-8 pl-8"
          value={list.query}
          disabled={busy}
          onChange={(event) => list.search(games, event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-fg-muted" aria-live="polite">
          {list.included} of {plural(games.length, "game")} included
          {searching ? ` · ${found.length} found` : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy || !found.length}
          onClick={() => setSelections((current) => setGamesIncluded(current, games, found, true))}
        >
          {searching ? "Include found" : "Include all"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy || !found.length}
          onClick={() => setSelections((current) => setGamesIncluded(current, games, found, false))}
        >
          {searching ? "Exclude found" : "Exclude all"}
        </Button>
        <div className="w-36">
          <Select
            aria-label={
              searching
                ? "Chapter kind for the included games found"
                : "Chapter kind for every included game"
            }
            className="h-7 text-xs"
            value=""
            disabled={busy || !found.length}
            onChange={(event) => {
              const kind = event.target.value;
              if (!isOneOf(CHAPTER_KINDS, kind)) return;
              setSelections((current) => setGamesKind(current, found, kind));
            }}
          >
            <option value="" disabled>
              Set kind…
            </option>
            <option value="opening">All opening</option>
            <option value="reference">All reference</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** One previewed game: include it, its chapter title and kind, and what it practises or leaves out. */
function ImportGameRow({
  index,
  game,
  selection,
  lookup,
  color,
  datalistId,
  ecoByName,
  onChange
}: {
  index: number;
  game: ImportPreviewGame;
  selection: ImportSelection;
  lookup: ChapterLookup | null;
  color: RepertoireColor | null;
  /** The book's opening names (the Opening field's suggestions). */
  datalistId: string;
  ecoByName: ReadonlyMap<string, string>;
  onChange: (patch: Partial<ImportSelection>) => void;
}) {
  return (
    <li
      data-game-index={index}
      className={cn(well, "grid gap-2 p-3", !selection.include && "opacity-70")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          aria-label={`Import game ${game.index + 1}`}
          checked={selection.include}
          disabled={!game.nodeCount}
          onChange={(event) => onChange({ include: event.target.checked })}
        />
        <Input
          aria-label={`Chapter title for game ${game.index + 1}`}
          className="h-8 min-w-40 flex-1"
          value={selection.title}
          onChange={(event) => onChange({ title: event.target.value })}
        />
        <div className="w-48">
          <Select
            aria-label={`Chapter kind for game ${game.index + 1}`}
            className="h-8"
            value={selection.kind}
            onChange={(event) => {
              const kind = event.target.value;
              if (isOneOf(CHAPTER_KINDS, kind)) onChange({ kind });
            }}
          >
            <option value="opening">Opening (practised)</option>
            <option value="reference">Reference (study only)</option>
          </Select>
        </div>
      </div>
      {game.nodeCount > 0 ? (
        <OpeningField
          game={game}
          selection={selection}
          datalistId={datalistId}
          ecoByName={ecoByName}
          onChange={onChange}
        />
      ) : null}
      <FirstMovesLine game={game} />
      {color && game.nodeCount > 0 && selection.kind === "reference" ? (
        <PracticeNote kind={selection.kind} decisions={game.decisions[color]} color={color} />
      ) : null}
      {game.warnings.map((warning) => (
        <p key={warning} className="text-2xs text-fg-muted">
          {warning}
        </p>
      ))}
      {game.invalidBranches.map((branch, branchIndex) => (
        <InvalidBranchLine
          key={`${branch.path}-${branchIndex}`}
          branch={branch}
          lookup={lookup}
          excludeNodeIds={selection.excludeNodeIds}
          onExcludeChange={(excludeNodeIds) => onChange({ excludeNodeIds })}
        />
      ))}
    </li>
  );
}

/** An illegal branch left out of a game, with the choice to exclude the line leading to it. */
function InvalidBranchLine({
  branch,
  lookup,
  excludeNodeIds,
  onExcludeChange
}: {
  branch: ImportInvalidBranch;
  lookup: ChapterLookup | null;
  excludeNodeIds: string[] | undefined;
  onExcludeChange: (excludeNodeIds: string[]) => void;
}) {
  const parentId = lookup ? nodeIdForPathLabel(lookup, branch.path) : null;
  const excluded = Boolean(parentId && excludeNodeIds?.includes(parentId));
  return (
    <div className="flex items-start gap-2 text-xs text-fg-secondary">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-mono">
          {branch.path ? `${branch.path} ` : ""}
          {branch.san}
        </span>{" "}
        — {branch.reason}
        {excluded ? " The line leading to it is excluded too." : ""}
      </p>
      {parentId ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          onClick={() =>
            onExcludeChange(
              excluded
                ? (excludeNodeIds ?? []).filter((id) => id !== parentId)
                : [...(excludeNodeIds ?? []), parentId]
            )
          }
        >
          {excluded ? "Keep line" : "Exclude line"}
        </Button>
      ) : null}
    </div>
  );
}

/** What a previewed game will practise as the chosen kind of chapter. */
function PracticeNote({
  kind,
  decisions,
  color
}: {
  kind: ChapterKind;
  decisions: number;
  color: RepertoireColor;
}) {
  const note = importPracticeNote(kind, decisions, color);
  return <p className={cn("text-2xs", note.warn ? "text-warn" : "text-fg-muted")}>{note.text}</p>;
}

/** A new repertoire's name and colour, as the import suggests them (both editable). */
type NewRepertoireFields = {
  name: string;
  color: RepertoireColor;
  onChange: (fields: { name: string; color: RepertoireColor }) => void;
};

/** The new repertoire's line (only when the import creates one). */
function NewRepertoireLine({ fields }: { fields: NewRepertoireFields }) {
  const nameId = useId();
  const typedError = fields.name.trim() ? nameError(fields.name) : null;
  return (
    <div className="grid shrink-0 gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name" htmlFor={nameId} className="min-w-48 flex-1">
          <Input
            id={nameId}
            placeholder="My repertoire"
            {...fieldErrorAria(typedError)}
            value={fields.name}
            onChange={(event) => fields.onChange({ name: event.target.value, color: fields.color })}
          />
        </Field>
        <SegmentedControl
          ariaLabel="Repertoire colour"
          value={fields.color}
          onChange={(color) => fields.onChange({ name: fields.name, color })}
          options={[
            { value: "white", label: "White" },
            { value: "black", label: "Black" }
          ]}
        />
      </div>
      <FieldError error={typedError} />
      <p className="text-2xs text-fg-muted">
        Suggested from the PGN. Chapters are grouped by the part of the opening before the colon.
      </p>
    </div>
  );
}

/** New moves · Your moves to practise · Positions with several of your moves (with Show). */
function ImportStatStrip({
  stats,
  onShow
}: {
  stats: ImportStats;
  onShow: (games: readonly number[]) => void;
}) {
  return (
    <StatStrip className="shrink-0 grid-cols-3">
      <StatCell label="New moves">{stats.newMoves}</StatCell>
      <StatCell label="Your moves to practise">{stats.practiceMoves}</StatCell>
      <StatCell
        label="Positions with several of your moves"
        valueClassName={stats.severalMoves ? "text-warn" : undefined}
      >
        <span className="flex items-baseline gap-2">
          {stats.severalMoves}
          {stats.severalMoves ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              title="Only the first of your moves at each such position is practised"
              onClick={() => onShow(stats.severalMovesGames)}
            >
              Show
            </Button>
          ) : null}
        </span>
      </StatCell>
    </StatStrip>
  );
}

/** A game's opening, as typed or else as detected; the ECO follows a name the book knows. */
function OpeningField({
  game,
  selection,
  datalistId,
  ecoByName,
  onChange
}: {
  game: ImportPreviewGame;
  selection: ImportSelection;
  datalistId: string;
  ecoByName: ReadonlyMap<string, string>;
  onChange: (patch: Partial<ImportSelection>) => void;
}) {
  const opening = selection.opening !== undefined ? selection.opening : (game.opening ?? null);
  const eco = opening?.name ? (ecoByName.get(opening.name) ?? opening.eco) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Opening for game ${game.index + 1}`}
        list={datalistId}
        placeholder="Opening not detected"
        className="h-7 min-w-40 flex-1 text-xs"
        value={opening?.name ?? ""}
        onChange={(event) =>
          onChange({
            opening: {
              name: event.target.value,
              eco: ecoByName.get(event.target.value) ?? null,
              edited: true
            }
          })
        }
      />
      {eco ? <Badge>{eco}</Badge> : null}
    </div>
  );
}

/** "1. e4 c6 2. d4 d5 … · 4 lines · 65 moves". */
function FirstMovesLine({ game }: { game: ImportPreviewGame }) {
  return game.firstMoves ? (
    <p className="truncate font-mono text-2xs text-fg-muted">
      {game.firstMoves} · {plural(game.lineCount ?? 0, "line")} · {plural(game.nodeCount, "move")}
    </p>
  ) : (
    <p className="text-2xs text-fg-muted tabular-nums">{plural(game.nodeCount, "move")}</p>
  );
}
