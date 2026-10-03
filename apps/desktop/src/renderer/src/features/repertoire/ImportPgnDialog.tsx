import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { importedDecisionCount } from "@chaturanga/shared/chess/repertoire-training";
import type {
  ChapterKind,
  ImportPreview,
  ImportProgressEvent,
  ImportResult,
  ImportSelection,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useCancelImportMutation,
  useCommitImportMutation,
  usePreviewImportMutation,
  useRepertoireQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { flushChapterTree } from "./useChapterAutosave";
import {
  adoptCommittedRevision,
  importExpectedRevision,
  mustFlushDraftBeforeImport,
  progressCounts,
  progressPercent,
  progressPhaseLabel,
  pgnSizeError,
  startPreviewRun,
  stepPreviewRun,
  type PreviewRun
} from "./import-progress";
import { filterGames, PREVIEW_PAGE_SIZE, setGamesIncluded, setGamesKind } from "./long-lists";
import { plural } from "./repertoire-chapters";
import { nodeIdForPathLabel } from "./repertoire-model";
import { IMPORT_KIND_HELP, importPracticeNote } from "./training-explanations";

/** The default selection of each previewed game: included, its proposed title, opening kind. */
export function defaultSelections(preview: ImportPreview): ImportSelection[] {
  return preview.games.map((game) => ({
    gameIndex: game.index,
    title: game.proposedTitle,
    kind: "opening",
    include: game.nodeCount > 0,
    excludeNodeIds: []
  }));
}

/**
 * Import PGN into a repertoire (design §10): paste or open a file, preview every game (title,
 * kind, moves, warnings and the illegal branches left out), then commit the selected games as
 * chapters in one step. While the PGN is parsed (in a worker) its progress shows with a Cancel
 * button; closing before the commit cancels the pending or running job. While the commit runs the
 * dialog can't be closed (it can't be cancelled once the writer has started).
 */
export function ImportPgnDialog({
  repertoireId,
  onClose,
  onImported
}: {
  repertoireId: string;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const queryClient = useQueryClient();
  const detail = useRepertoireQuery(repertoireId);
  const previewMutation = usePreviewImportMutation();
  const commitMutation = useCommitImportMutation();
  const { mutate: cancelJobMutation } = useCancelImportMutation();
  /**
   * Cancels a pending job. After the dialog closed the hook's mutate may no longer run, so the API
   * is called directly then (best effort: an uncancelled job only expires on its own).
   */
  const cancelJob = (jobId: string) => {
    if (open.current) cancelJobMutation(jobId);
    else void window.chaturanga?.repertoires.cancelImport(jobId).catch(() => undefined);
  };
  const [pgn, setPgn] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selections, setSelections] = useState<ImportSelection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pendingJob = useRef<string | null>(null);
  /** False once the dialog closed; a preview resolving after that cancels its job. */
  const open = useRef(true);
  /** Bumped per preview: an older preview resolving late cancels its own job. */
  const previewRequest = useRef(0);
  /** The running preview, with the jobId this dialog gave it; null when none runs. */
  const run = useRef<PreviewRun | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState<ImportProgressEvent | null>(null);
  /** True while the open study draft is saved before a commit. */
  const [flushing, setFlushing] = useState(false);
  /** The preview's search, and the games it found (every game when it's blank). */
  const [gameQuery, setGameQuery] = useState("");
  const [found, setFound] = useState<number[]>([]);
  /** Rows of `found` rendered; "Show more" adds a page. */
  const [shownCount, setShownCount] = useState(PREVIEW_PAGE_SIZE);
  const gameList = useRef<HTMLUListElement | null>(null);

  /** Leaves the running preview: its late result or rejection is ignored from now on. */
  const endRun = () => {
    run.current = null;
    previewRequest.current += 1;
    setPreviewing(false);
    setProgress(null);
  };

  // Closing (or unmounting) with a previewed, uncommitted job cancels it.
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      const jobId = pendingJob.current ?? run.current?.jobId;
      pendingJob.current = null;
      if (jobId) void window.chaturanga?.repertoires.cancelImport(jobId).catch(() => undefined);
    };
  }, []);

  // Progress of the running preview (matched by the jobId this dialog generated for it);
  // subscribed before any preview starts so no event is missed.
  useEffect(() => {
    const unsubscribe = window.chaturanga?.repertoires.onImportProgress?.((event) => {
      if (!run.current) return;
      const step = stepPreviewRun(run.current, event);
      if (step.kind === "update") {
        run.current = step.run;
        setProgress(step.run.latest);
      } else if (step.kind === "cancelled") {
        endRun();
      } else if (step.kind === "failed") {
        endRun();
        setError(step.error);
      }
    });
    return () => unsubscribe?.();
  }, []);

  // Only games with illegal branches need a lookup (to find each branch's node); building one per
  // game would index every move of a large import on the renderer thread.
  // What each shown game would practise as an opening chapter (the import default), for the
  // repertoire's side: only the rendered rows are counted.
  const color = detail.data?.color ?? null;
  const shown = found.slice(0, shownCount);
  const shownKey = shown.join(",");
  const decisionCounts = useMemo(() => {
    const counts = new Map<number, number>();
    if (!preview || !color) return counts;
    for (const index of shownKey ? shownKey.split(",").map(Number) : []) {
      const game = preview.games[index];
      if (game?.tree.length) counts.set(index, importedDecisionCount(color, game.tree));
    }
    return counts;
  }, [preview, color, shownKey]);

  const lookups = useMemo(
    () =>
      preview?.games.map((game) =>
        game.tree.length && game.invalidBranches.length ? buildChapterLookup(game) : null
      ) ?? [],
    [preview]
  );

  function runPreview(text: string) {
    setError(null);
    const sizeError = pgnSizeError(text);
    if (sizeError) {
      setError(sizeError);
      return;
    }
    if (pendingJob.current) cancelJob(pendingJob.current);
    pendingJob.current = null;
    const request = ++previewRequest.current;
    const jobId = nanoid();
    run.current = startPreviewRun(jobId);
    setPreviewing(true);
    setProgress(null);
    // The promise (unlike per-call callbacks) settles after the dialog unmounts too.
    previewMutation.mutateAsync({ pgn: text, jobId }).then(
      (result) => {
        if (!open.current || request !== previewRequest.current) {
          cancelJob(result.jobId);
          return;
        }
        run.current = null;
        setPreviewing(false);
        setProgress(null);
        pendingJob.current = result.jobId;
        setPreview(result);
        setSelections(defaultSelections(result));
        setGameQuery("");
        setFound(result.games.map((_game, index) => index));
        setShownCount(PREVIEW_PAGE_SIZE);
      },
      (cause) => {
        if (open.current && request === previewRequest.current) {
          run.current = null;
          setPreviewing(false);
          setProgress(null);
          setError(ipcErrorMessage(cause) || "That PGN couldn't be read.");
        }
      }
    );
  }

  /** Cancels the running preview and returns to the input. */
  function cancelPreview() {
    const current = run.current;
    if (!current) return;
    cancelJob(current.jobId);
    endRun();
  }

  async function chooseFile() {
    setError(null);
    try {
      const file = await window.chaturanga?.files.openPgnFile();
      if (!file) return;
      setPgn(file.contents);
      runPreview(file.contents);
    } catch (cause) {
      setError(ipcErrorMessage(cause) || "Couldn't open that file.");
    }
  }

  async function commit() {
    if (!preview || flushing) return;
    setError(null);
    // An import into the repertoire whose draft is open saves that draft first, so no autosave
    // runs (or comes due) during the commit and races its revision bump; the commit then expects
    // the revision that save stored. A draft that can't be saved keeps the dialog open.
    if (mustFlushDraftBeforeImport(useRepertoireWorkspaceStore.getState(), repertoireId)) {
      setFlushing(true);
      let saved: boolean;
      try {
        saved = await flushChapterTree(queryClient);
      } finally {
        if (open.current) setFlushing(false);
      }
      if (!open.current) return;
      if (!saved) {
        setError("The open chapter couldn't be saved; retry its save, then import.");
        return;
      }
    }
    const expectedRevision = importExpectedRevision(
      useRepertoireWorkspaceStore.getState(),
      repertoireId,
      detail.data?.revision
    );
    if (expectedRevision === undefined) return;
    setError(null);
    // The job belongs to the commit now: unmounting meanwhile must not cancel it. A failed commit
    // keeps the job, so it is pending again (or cancelled when the dialog is gone).
    const jobId = preview.jobId;
    pendingJob.current = null;
    // The promise (unlike per-call callbacks) settles after the dialog unmounts too, so the open
    // draft adopts the new revision even when the user navigated away meanwhile.
    commitMutation.mutateAsync({ jobId, repertoireId, selections, expectedRevision }).then(
      (result) => {
        adoptCommittedRevision(
          useRepertoireWorkspaceStore.getState(),
          repertoireId,
          result.repertoire.revision
        );
        if (open.current) onImported(result);
      },
      (cause) => {
        if (!open.current) return cancelJob(jobId);
        pendingJob.current = jobId;
        setError(ipcErrorMessage(cause) || "The import couldn't be saved.");
      }
    );
  }

  const update = (index: number, patch: Partial<ImportSelection>) =>
    setSelections((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item))
    );

  /**
   * Searches the games by title or number. The result is taken when the search changes, so
   * renaming a found game never hides the row being typed in.
   */
  const search = (query: string) => {
    setGameQuery(query);
    setFound(preview ? filterGames(preview.games, selections, query) : []);
    setShownCount(PREVIEW_PAGE_SIZE);
  };

  /** Shows the next page of games and moves focus to the first one it adds. */
  const showMore = () => {
    const first = found[shownCount];
    setShownCount((count) => count + PREVIEW_PAGE_SIZE);
    requestAnimationFrame(() =>
      gameList.current
        ?.querySelector<HTMLInputElement>(`[data-game-index="${first}"] input[type="checkbox"]`)
        ?.focus()
    );
  };

  const included = selections.filter((selection) => selection.include).length;
  const searching = Boolean(gameQuery.trim());
  const committing = flushing || commitMutation.isPending;
  const busy = previewing || committing;

  return (
    <Dialog
      title="Import PGN"
      description={
        committing
          ? "Importing… please wait."
          : preview
            ? "Each game becomes a chapter. Choose what to import."
            : "Paste PGN or open a file; every game in it is read."
      }
      // No close (×, Escape, backdrop) while the commit runs: it can't be cancelled then.
      onClose={committing ? undefined : onClose}
      footer={
        preview ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (pendingJob.current) cancelJob(pendingJob.current);
                pendingJob.current = null;
                setPreview(null);
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || !included || !detail.data}
              onClick={() => void commit()}
            >
              {committing ? "Importing…" : `Import ${plural(included, "chapter")}`}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void chooseFile()}
            >
              <Upload />
              Choose file…
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || !pgn.trim()}
              onClick={() => runPreview(pgn)}
            >
              {previewing ? "Reading…" : "Preview"}
            </Button>
          </>
        )
      }
      // The preview's search and bulk actions stay put above its own scrolling list of games.
      bodyClassName={preview ? "flex flex-col gap-3 overflow-hidden" : "grid gap-3"}
    >
      {preview ? (
        <>
          <p className="shrink-0 text-2xs text-fg-muted">{IMPORT_KIND_HELP}</p>
          {preview.games.length > 1 ? (
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
                  value={gameQuery}
                  disabled={busy}
                  onChange={(event) => search(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto text-xs text-fg-muted" aria-live="polite">
                  {included} of {plural(preview.games.length, "game")} included
                  {searching ? ` · ${found.length} found` : ""}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy || !found.length}
                  onClick={() =>
                    setSelections((current) =>
                      setGamesIncluded(current, preview.games, found, true)
                    )
                  }
                >
                  {searching ? "Include found" : "Include all"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy || !found.length}
                  onClick={() =>
                    setSelections((current) =>
                      setGamesIncluded(current, preview.games, found, false)
                    )
                  }
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
                    onChange={(event) =>
                      setSelections((current) =>
                        setGamesKind(current, found, event.target.value as ChapterKind)
                      )
                    }
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
          ) : null}
          <div className="scroll-area -mx-1 grid min-h-0 content-start gap-2 overflow-y-auto px-1">
            <ul ref={gameList} className="grid gap-2" aria-label="Games in the PGN">
              {shown.map((index) => {
                const game = preview.games[index];
                const selection = selections[index];
                const lookup = lookups[index];
                if (!game || !selection) return null;
                return (
                  <li
                    key={game.index}
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
                        onChange={(event) => update(index, { include: event.target.checked })}
                      />
                      <Input
                        aria-label={`Chapter title for game ${game.index + 1}`}
                        className="h-8 min-w-40 flex-1"
                        value={selection.title}
                        onChange={(event) => update(index, { title: event.target.value })}
                      />
                      <div className="w-36">
                        <Select
                          aria-label={`Chapter kind for game ${game.index + 1}`}
                          className="h-8"
                          value={selection.kind}
                          onChange={(event) =>
                            update(index, { kind: event.target.value as ChapterKind })
                          }
                        >
                          <option value="opening">Opening (practised)</option>
                          <option value="reference">Reference (study only)</option>
                        </Select>
                      </div>
                      <span className="text-xs text-fg-muted tabular-nums">
                        {plural(game.nodeCount, "move")}
                      </span>
                    </div>
                    {color && game.nodeCount > 0 ? (
                      <PracticeNote
                        kind={selection.kind}
                        decisions={decisionCounts.get(index) ?? 0}
                        color={color}
                      />
                    ) : null}
                    {game.warnings.map((warning) => (
                      <p key={warning} className="text-2xs text-fg-muted">
                        {warning}
                      </p>
                    ))}
                    {game.invalidBranches.map((branch, branchIndex) => {
                      const parentId = lookup ? nodeIdForPathLabel(lookup, branch.path) : null;
                      const excluded = Boolean(
                        parentId && selection.excludeNodeIds?.includes(parentId)
                      );
                      return (
                        <div
                          key={`${branch.path}-${branchIndex}`}
                          className="flex items-start gap-2 text-xs text-fg-secondary"
                        >
                          <AlertTriangle
                            className="mt-0.5 size-3.5 shrink-0 text-warn"
                            aria-hidden="true"
                          />
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
                                update(index, {
                                  excludeNodeIds: excluded
                                    ? (selection.excludeNodeIds ?? []).filter(
                                        (id) => id !== parentId
                                      )
                                    : [...(selection.excludeNodeIds ?? []), parentId]
                                })
                              }
                            >
                              {excluded ? "Keep line" : "Exclude line"}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
            {searching && !found.length ? (
              <p className="text-xs text-fg-muted">No games match “{gameQuery.trim()}”.</p>
            ) : null}
            {found.length > shownCount ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={showMore}
              >
                Show {Math.min(PREVIEW_PAGE_SIZE, found.length - shownCount)} more (
                {found.length - shownCount} not shown)
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Textarea
            aria-label="PGN text"
            autoFocus
            disabled={previewing}
            value={pgn}
            onChange={(event) => setPgn(event.target.value)}
            placeholder={'[Event "My 1.e4 repertoire"]\n\n1. e4 e5 2. Nf3 (2. Bc4) *'}
          />
          {previewing ? (
            <div className={cn(well, "grid gap-2 p-3")} role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-fg">{progressPhaseLabel(progress)}</span>
                <span className="text-fg-muted tabular-nums">{progressCounts(progress)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="ml-auto"
                  onClick={cancelPreview}
                >
                  Cancel
                </Button>
              </div>
              <Progress value={progressPercent(progress)} aria-label="Reading the PGN" />
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <Notice tone="danger" className="shrink-0">
          {error}
        </Notice>
      ) : null}
    </Dialog>
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
