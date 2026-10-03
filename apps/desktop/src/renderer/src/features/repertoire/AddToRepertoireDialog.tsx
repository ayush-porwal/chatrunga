import { useId, useEffect, useMemo, useReducer, useState } from "react";
import { BookPlus, GitBranch } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AddFromGameDestination,
  AddFromGameInput,
  AddFromGameResult,
  AddFromGameScope,
  AddFromGameSource,
  ChapterKind
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { fieldHint, fieldLabel, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useAddFromGameMutation,
  useAddFromGamePreviewQuery,
  useRepertoireQuery,
  useRepertoiresQuery
} from "../../queries/repertoire";
import { useAddToRepertoireStore } from "../../stores/add-to-repertoire-store";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  EMPTY_POLICY_STATE,
  addInputBaseKey,
  buildScope,
  conflictText,
  defaultChapterKind,
  defaultChapterTitle,
  defaultRepertoireId,
  hashAddInput,
  initialScopeChoice,
  policyFor,
  policyReducer,
  scopeNodeId,
  scopeOptions,
  type ScopeChoice
} from "./add-from-game";
import { COLOR_LABELS, plural, sortedChapters } from "./repertoire-chapters";
import { isStaleRevisionError } from "./repertoire-model";
import { flushChapterTree } from "./useChapterAutosave";

/** Active repertoires of both colours: the game's colour is never used to guess. */
const ALL_ACTIVE = { color: "all" } as const;

type DestinationKind = AddFromGameDestination["kind"];

const destinationOptions = [
  { value: "new-chapter" as const, label: "New chapter" },
  { value: "existing-chapter" as const, label: "Existing chapter" }
];

const branchRootOptions = [
  { value: "original" as const, label: "Keep the game's moves before it" },
  { value: "standalone" as const, label: "Start the chapter here" }
];

/**
 * Add to repertoire (design §6.2): one dialog that picks the destination (repertoire, then a new
 * or an existing chapter), the scope (line to the selected move, its branch, or the whole game)
 * and confirms the choice policy the preview proposes (own moves ticked, opponent replies
 * covered), with what the add changes and where it differs from the repertoire. The game and its
 * review are only read; nothing is written to the game store.
 */
export function AddToRepertoireDialog({
  source,
  initialScope,
  preselect = null,
  onClose,
  onDone
}: {
  source: AddFromGameSource;
  /** A path/subtree hint at the selected move, or the whole game. */
  initialScope: AddFromGameScope;
  /** A repertoire (and chapter) chosen beforehand: one just created for this game. */
  preselect?: { repertoireId: string; chapterId: string | null } | null;
  onClose: () => void;
  onDone: (result: AddFromGameResult) => void;
}) {
  const ids = { repertoire: useId(), chapter: useId(), title: useId(), kind: useId() };
  const queryClient = useQueryClient();
  const desktop = Boolean(window.chaturanga?.repertoires);
  const list = useRepertoiresQuery(ALL_ACTIVE);
  const lastRepertoireId = useAddToRepertoireStore((state) => state.lastRepertoireId);
  const studiedRepertoireId = useRepertoireWorkspaceStore((state) => state.repertoireId);
  const baseRevision = useRepertoireWorkspaceStore((state) =>
    state.repertoireId ? state.baseRevision : 0
  );

  // The repertoire: the user's pick, else the last used one (undefined: not picked). A preselected
  // one (just created) counts as picked at once: the cached list may not have it yet.
  const [pickedRepertoireId, setPickedRepertoireId] = useState<string | null | undefined>(
    preselect?.repertoireId
  );
  const repertoires = useMemo(() => list.data ?? [], [list.data]);
  const repertoireId =
    pickedRepertoireId !== undefined
      ? pickedRepertoireId
      : defaultRepertoireId(repertoires, [lastRepertoireId, studiedRepertoireId]);
  const detail = useRepertoireQuery(repertoireId);
  const chapters = useMemo(() => sortedChapters(detail.data?.chapters ?? []), [detail.data]);

  // The scope at the hinted node (or the board's node when the hint is the whole game).
  const nodeId = scopeNodeId(initialScope) ?? source.nodeId;
  const options = useMemo(() => scopeOptions(source.tree, nodeId), [source.tree, nodeId]);
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>(() =>
    initialScopeChoice(initialScope, options)
  );
  const [branchRoot, setBranchRoot] = useState<"original" | "standalone">(
    initialScope.kind === "subtree" ? initialScope.root : "original"
  );
  const scope = buildScope(scopeChoice, nodeId, branchRoot);

  // The destination chapter.
  const [destinationKind, setDestinationKind] = useState<DestinationKind>(
    preselect?.chapterId ? "existing-chapter" : "new-chapter"
  );
  const [pickedChapterId, setPickedChapterId] = useState<string | null>(
    preselect?.chapterId ?? null
  );
  const chapterId = chapters.some((chapter) => chapter.id === pickedChapterId)
    ? pickedChapterId
    : (chapters[0]?.id ?? null);
  const [title, setTitle] = useState(() => defaultChapterTitle(source.headers));
  const [pickedKind, setPickedKind] = useState<ChapterKind | null>(null);
  const chapterKind = pickedKind ?? defaultChapterKind(scopeChoice);
  const destination: AddFromGameDestination | null =
    destinationKind === "new-chapter"
      ? title.trim()
        ? { kind: "new-chapter", title: title.trim(), chapterKind }
        : null
      : chapterId
        ? { kind: "existing-chapter", chapterId }
        : null;

  // The study draft knows a newer revision than the cached detail after its own saves.
  const expectedRevision = detail.data
    ? Math.max(detail.data.revision, studiedRepertoireId === detail.data.id ? baseRevision : 0)
    : null;

  const base =
    repertoireId && destination && expectedRevision !== null
      ? { repertoireId, expectedRevision, destination, source, scope }
      : null;
  const baseKey = base ? addInputBaseKey(base) : null;

  const [policyState, dispatch] = useReducer(policyReducer, EMPTY_POLICY_STATE);
  const policy = baseKey ? policyFor(policyState, baseKey) : null;
  const input: AddFromGameInput | null = base ? { ...base, policy } : null;
  const preview = useAddFromGamePreviewQuery(desktop ? input : null);
  const inputHash = input ? hashAddInput(input) : null;
  const fresh = Boolean(preview.data && inputHash && preview.data.inputHash === inputHash);
  const shown = preview.data && base ? preview.data : null;

  // The first preview of a scope/destination proposes the policy; the user's ticks stay after.
  useEffect(() => {
    if (fresh && preview.data && baseKey && policyState.baseKey !== baseKey) {
      dispatch({ type: "init", baseKey, preview: preview.data });
    }
  }, [fresh, preview.data, baseKey, policyState.baseKey]);

  const add = useAddFromGameMutation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);
  const policyReady = Boolean(baseKey && policyState.baseKey === baseKey);
  const canAdd = Boolean(input && policy && fresh && !add.isPending && !flushing);

  async function commit() {
    if (!input || !policy || !canAdd || !repertoireId) return;
    setError(null);
    setNotice(null);
    // An open study draft of this repertoire saves first, so the add doesn't make it stale.
    const draft = useRepertoireWorkspaceStore.getState();
    if (draft.repertoireId === repertoireId && (draft.dirty || draft.saveState.status !== "idle")) {
      setFlushing(true);
      const saved = await flushChapterTree(queryClient);
      setFlushing(false);
      if (!saved) {
        setError("The chapter open in Study isn't saved yet. Save it there, then add again.");
        return;
      }
    }
    // Saving the draft made a new revision: the preview re-runs against it before anything is added.
    const workspace = useRepertoireWorkspaceStore.getState();
    if (
      workspace.repertoireId === repertoireId &&
      workspace.baseRevision > input.expectedRevision
    ) {
      void detail.refetch();
      setNotice(
        "The chapter open in Study was saved first. Check the updated preview and add again."
      );
      return;
    }
    add.mutate(
      { ...input, policy },
      {
        onSuccess: (result) => {
          if (useRepertoireWorkspaceStore.getState().repertoireId === repertoireId) {
            useRepertoireWorkspaceStore.getState().adoptRevision(result.repertoire.revision);
          }
          useAddToRepertoireStore.getState().remember(repertoireId);
          onDone(result);
        },
        onError: (cause) => {
          const message = ipcErrorMessage(cause);
          if (isStaleRevisionError(message)) {
            void detail.refetch();
            setError(
              "This repertoire changed meanwhile. The preview is updated: check it and add again."
            );
          } else setError(message || "Couldn't add it to the repertoire.");
        }
      }
    );
  }

  const ownMoves = shown?.ownMoves ?? [];
  const included = new Set(policyState.included);

  return (
    <Dialog
      title="Add to repertoire"
      description="Copies moves, comments and arrows into a chapter. The game itself stays as it is."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canAdd}
            onClick={() => void commit()}
          >
            <BookPlus />
            {add.isPending || flushing ? "Adding…" : "Add to repertoire"}
          </Button>
        </>
      }
      bodyClassName="grid gap-4"
    >
      {!desktop ? (
        <Notice tone="warn">Repertoires need the desktop app.</Notice>
      ) : list.isSuccess && !repertoires.length ? (
        <Notice tone="info">Create a repertoire first; then add games to it from here.</Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Repertoire" htmlFor={ids.repertoire}>
          <Select
            id={ids.repertoire}
            value={repertoireId ?? ""}
            disabled={!repertoires.length}
            onChange={(event) => {
              setPickedRepertoireId(event.target.value || null);
              setPickedChapterId(null);
              setError(null);
            }}
          >
            {repertoireId ? null : <option value="">Choose a repertoire…</option>}
            {repertoires.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({COLOR_LABELS[item.color]})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-1.5">
          <p className={fieldLabel}>Into</p>
          <SegmentedControl
            ariaLabel="Destination chapter"
            fullWidth
            value={destinationKind}
            onChange={setDestinationKind}
            options={destinationOptions.map((option) => ({
              ...option,
              disabled: option.value === "existing-chapter" && !chapters.length
            }))}
          />
        </div>
      </div>

      {destinationKind === "new-chapter" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Chapter title" htmlFor={ids.title}>
            <Input
              id={ids.title}
              value={title}
              aria-invalid={!title.trim() || undefined}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Kind" htmlFor={ids.kind}>
            <Select
              id={ids.kind}
              value={chapterKind}
              onChange={(event) => setPickedKind(event.target.value as ChapterKind)}
            >
              <option value="opening">Opening</option>
              <option value="reference">Reference</option>
            </Select>
          </Field>
        </div>
      ) : (
        <Field label="Chapter" htmlFor={ids.chapter}>
          <Select
            id={ids.chapter}
            value={chapterId ?? ""}
            onChange={(event) => setPickedChapterId(event.target.value)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
                {chapter.kind === "reference" ? " (reference)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-1.5">
        <p className={fieldLabel}>What to add</p>
        <SegmentedControl
          ariaLabel="What to add"
          fullWidth
          value={scopeChoice}
          onChange={setScopeChoice}
          options={options}
        />
        {scopeChoice === "subtree" ? (
          <SegmentedControl
            ariaLabel="Where the chapter starts"
            size="sm"
            fullWidth
            value={branchRoot}
            onChange={setBranchRoot}
            options={branchRootOptions}
          />
        ) : null}
        <p className={fieldHint}>
          {scopeChoice === "path"
            ? "The moves from the start to the selected move, without side variations."
            : scopeChoice === "subtree"
              ? "Every move after the selected position, with its variations."
              : "Every move and variation. A whole game is best kept as reference material."}
        </p>
      </div>

      {repertoireId && destination ? (
        <section
          aria-label="What this adds"
          aria-busy={!fresh || undefined}
          className={cn("grid gap-3 transition-opacity", !fresh && shown && "opacity-60")}
        >
          {/* A preview the main process refuses (a merge into a chapter with another start, a
              game gone from the library) is shown as is; Add stays off until one succeeds. */}
          {preview.isError ? (
            <Notice tone="danger">
              {ipcErrorMessage(preview.error) || "The preview couldn't be made."}
            </Notice>
          ) : !shown ? (
            <p className={fieldHint} role="status">
              Working out what this adds…
            </p>
          ) : (
            <>
              {ownMoves.length ? (
                <div className="grid gap-1.5">
                  <p className={fieldLabel}>Your moves to learn</p>
                  <ul
                    className={cn(well, "scroll-area grid max-h-48 gap-0.5 overflow-y-auto p-1.5")}
                    aria-label="Your moves to learn"
                  >
                    {ownMoves.map((move) => (
                      <li key={move.nodeId}>
                        <label className="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-sm text-fg-secondary hover:bg-control">
                          <input
                            type="checkbox"
                            className="size-4 accent-accent"
                            checked={included.has(move.nodeId)}
                            disabled={!policyReady}
                            onChange={() => dispatch({ type: "toggle", nodeId: move.nodeId })}
                          />
                          <span className="min-w-0 truncate font-mono text-xs" title={move.path}>
                            {move.path || move.san}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className={fieldHint}>
                    Unticked moves are kept as reference only; they are never asked in practice.
                  </p>
                </div>
              ) : null}
              <label className="flex items-center justify-between gap-3 text-sm text-fg-secondary">
                <span>Cover opponent replies</span>
                <Switch
                  checked={policyState.coverReplies}
                  onCheckedChange={(on) => dispatch({ type: "set-cover", on })}
                  aria-label="Cover opponent replies"
                />
              </label>
              <ul className="grid gap-0.5 text-sm text-fg-secondary" aria-label="Summary">
                <li>
                  Adds {plural(shown.decisionsAdded, "decision")} ·{" "}
                  {plural(shown.nodeCount, "move")} copied
                </li>
                {shown.transpositions ? (
                  <li>{plural(shown.transpositions, "position")} already in this repertoire</li>
                ) : null}
                {destinationKind === "existing-chapter" && shown.alreadyPresent ? (
                  <li>
                    {plural(shown.alreadyPresent, "move")} already in this chapter (kept, not
                    duplicated)
                  </li>
                ) : null}
              </ul>
              {shown.conflicts.length ? (
                <div className="grid gap-1.5">
                  <p className={fieldLabel}>Different from your repertoire</p>
                  <ul className="grid gap-1" aria-label="Differences">
                    {shown.conflicts.map((conflict) => (
                      <li
                        key={`${conflict.positionKey}:${conflict.newUci}`}
                        className="flex items-start gap-2 text-xs text-fg-secondary"
                      >
                        <GitBranch
                          className="mt-0.5 size-3.5 shrink-0 text-warn"
                          aria-hidden="true"
                        />
                        <span>{conflictText(conflict)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {shown.warnings.length ? (
                <Notice tone="warn">
                  {shown.warnings.length === 1 ? (
                    shown.warnings[0]
                  ) : (
                    <ul className="grid gap-0.5">
                      {shown.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </Notice>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {notice ? <Notice tone="info">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
