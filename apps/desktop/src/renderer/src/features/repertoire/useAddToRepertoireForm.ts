import { useEffect, useMemo, useReducer, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AddFromGameDestination,
  AddFromGameInput,
  AddFromGameResult,
  AddFromGameScope,
  AddFromGameSource,
  ChapterKind,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
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
import { sortedChapters } from "./repertoire-chapters";
import { isStaleRevisionError } from "./repertoire-model";
import { flushChapterTree } from "./useChapterAutosave";

/*
 * The Add to repertoire dialog's state, in the order its parts depend on each other: the scope,
 * the destination (a new chapter's kind follows the scope), the preview with the choice policy it
 * proposes, and the add itself.
 */

/** Active repertoires of both colours: the game's colour is never used to guess. */
const ALL_ACTIVE = { color: "all" } as const;

export type DestinationKind = AddFromGameDestination["kind"];

/** A repertoire (and chapter) chosen beforehand: one just created for this game. */
export type AddPreselect = { repertoireId: string; chapterId: string | null } | null;

/** What to add: the line to the selected move, its branch (keeping the moves before or not), or the whole game. */
export function useAddScope(source: AddFromGameSource, initialScope: AddFromGameScope) {
  // The scope at the hinted node (or the board's node when the hint is the whole game).
  const nodeId = scopeNodeId(initialScope) ?? source.nodeId;
  const options = useMemo(() => scopeOptions(source.tree, nodeId), [source.tree, nodeId]);
  const [choice, setChoice] = useState<ScopeChoice>(() =>
    initialScopeChoice(initialScope, options)
  );
  const [branchRoot, setBranchRoot] = useState<"original" | "standalone">(
    initialScope.kind === "subtree" ? initialScope.root : "original"
  );
  return {
    options,
    choice,
    setChoice,
    branchRoot,
    setBranchRoot,
    scope: buildScope(choice, nodeId, branchRoot)
  };
}

export type AddScopeForm = ReturnType<typeof useAddScope>;

/** Where the add goes: a repertoire, then a new chapter (title and kind) or an existing one. */
export function useAddDestination({
  source,
  preselect,
  scopeChoice
}: {
  source: AddFromGameSource;
  preselect: AddPreselect;
  scopeChoice: ScopeChoice;
}) {
  const list = useRepertoiresQuery(ALL_ACTIVE);
  const lastRepertoireId = useAddToRepertoireStore((state) => state.lastRepertoireId);
  const studiedRepertoireId = useRepertoireWorkspaceStore((state) => state.repertoireId);

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

  // The destination chapter.
  const [kind, setKind] = useState<DestinationKind>(
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

  /** Another repertoire: its chapter is picked afresh. */
  const pickRepertoire = (id: string | null) => {
    setPickedRepertoireId(id);
    setPickedChapterId(null);
  };

  return {
    list,
    repertoires,
    repertoireId,
    pickRepertoire,
    detail,
    chapters,
    kind,
    setKind,
    chapterId,
    setChapterId: setPickedChapterId,
    title,
    setTitle,
    chapterKind,
    setChapterKind: setPickedKind,
    destination: chapterDestination({ kind, title, chapterKind, chapterId })
  };
}

export type AddDestinationForm = ReturnType<typeof useAddDestination>;

/** The chapter to add into; null until a new one is named or an existing one is there to pick. */
function chapterDestination({
  kind,
  title,
  chapterKind,
  chapterId
}: {
  kind: DestinationKind;
  title: string;
  chapterKind: ChapterKind;
  chapterId: string | null;
}): AddFromGameDestination | null {
  if (kind === "existing-chapter") {
    return chapterId ? { kind: "existing-chapter", chapterId } : null;
  }
  const trimmed = title.trim();
  return trimmed ? { kind: "new-chapter", title: trimmed, chapterKind } : null;
}

/** The study draft knows a newer revision than the cached detail after its own saves. */
function expectedAddRevision(
  detail: RepertoireDetail | undefined,
  studiedRepertoireId: string | null,
  baseRevision: number
): number | null {
  if (!detail) return null;
  return Math.max(detail.revision, studiedRepertoireId === detail.id ? baseRevision : 0);
}

/**
 * The preview of the add and the choice policy being confirmed: the first preview of a
 * scope/destination proposes the policy; the user's ticks stay after.
 */
export function useAddPreview({
  desktop,
  source,
  scope,
  target
}: {
  desktop: boolean;
  source: AddFromGameSource;
  scope: AddFromGameScope;
  target: AddDestinationForm;
}) {
  const studiedRepertoireId = useRepertoireWorkspaceStore((state) => state.repertoireId);
  const baseRevision = useRepertoireWorkspaceStore((state) =>
    state.repertoireId ? state.baseRevision : 0
  );
  const { repertoireId, destination } = target;
  const expectedRevision = expectedAddRevision(
    target.detail.data,
    studiedRepertoireId,
    baseRevision
  );

  const base =
    repertoireId && destination && expectedRevision !== null
      ? { repertoireId, expectedRevision, destination, source, scope }
      : null;
  const baseKey = base ? addInputBaseKey(base) : null;

  const [policyState, dispatch] = useReducer(policyReducer, EMPTY_POLICY_STATE);
  const policy = baseKey ? policyFor(policyState, baseKey) : null;
  const input: AddFromGameInput | null = base ? { ...base, policy } : null;
  const query = useAddFromGamePreviewQuery(desktop ? input : null);
  const inputHash = input ? hashAddInput(input) : null;
  const fresh = Boolean(query.data && inputHash && query.data.inputHash === inputHash);
  const shown = query.data && base ? query.data : null;

  useEffect(() => {
    if (fresh && query.data && baseKey && policyState.baseKey !== baseKey) {
      dispatch({ type: "init", baseKey, preview: query.data });
    }
  }, [fresh, query.data, baseKey, policyState.baseKey]);

  return {
    input,
    policy,
    policyState,
    dispatch,
    policyReady: Boolean(baseKey && policyState.baseKey === baseKey),
    query,
    fresh,
    shown
  };
}

export type AddPreview = ReturnType<typeof useAddPreview>;

/** Adds the previewed material, once the open study draft of the repertoire is saved. */
export function useAddCommit({
  preview,
  target,
  onDone
}: {
  preview: AddPreview;
  target: AddDestinationForm;
  onDone: (result: AddFromGameResult) => void;
}) {
  const queryClient = useQueryClient();
  const add = useAddFromGameMutation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);
  const { input, policy, fresh } = preview;
  const { repertoireId, detail } = target;
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

  return { canAdd, adding: add.isPending || flushing, error, setError, notice, commit };
}
