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
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { PREVIEW_PAGE_SIZE, setGamesIncluded, setGamesKind } from "./long-lists";
import { plural } from "./repertoire-chapters";
import { nodeIdForPathLabel } from "./repertoire-model";
import { IMPORT_KIND_HELP, importPracticeNote } from "./training-explanations";
import type { ImportGameList } from "./useImportGameList";
import type { ImportJob } from "./useImportJob";

/** The preview step's actions: back to the input, or import the included games. */
export function ImportPreviewActions({
  job,
  games,
  repertoireLoaded
}: {
  job: ImportJob;
  games: ImportGameList;
  repertoireLoaded: boolean;
}) {
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
        disabled={job.busy || !games.included || !repertoireLoaded}
        onClick={() => void job.commit(games.selections)}
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
  busy
}: {
  preview: ImportPreview;
  games: ImportGameList;
  /** Per game, the lookup that finds its illegal branches' nodes (null when it has none). */
  lookups: (ChapterLookup | null)[];
  color: RepertoireColor | null;
  busy: boolean;
}) {
  const { found, shownCount, listRef } = games;
  return (
    <>
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
  onChange
}: {
  index: number;
  game: ImportPreviewGame;
  selection: ImportSelection;
  lookup: ChapterLookup | null;
  color: RepertoireColor | null;
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
        <span className="text-xs text-fg-muted tabular-nums">{plural(game.nodeCount, "move")}</span>
      </div>
      {color && game.nodeCount > 0 ? (
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
