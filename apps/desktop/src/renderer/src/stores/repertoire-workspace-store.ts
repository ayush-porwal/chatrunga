import { create } from "zustand";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { addMoveNode } from "@chaturanga/shared/chess/pgn";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { nodeMetaOf } from "@chaturanga/shared/chess/repertoire-index";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { BoardArrow, BoardHighlight, Color, MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type ChapterSaveResult,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireDecision,
  type RepertoireDetail,
  type RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import {
  defaultEdgeForNewMove,
  shouldAdoptSaveResult,
  type AutosaveSaveState
} from "../features/repertoire/repertoire-model";

/**
 * The repertoire study draft: one chapter being edited, its selected node and board orientation,
 * and the autosave bookkeeping. Ephemeral — the main process owns the saved chapter; this store
 * never touches the game store (game autosave would turn it into a library game).
 *
 * `generation` counts edits. A save remembers the generation it sent, and its result only replaces
 * the draft when no edit happened meanwhile (`shouldAdoptSaveResult`); otherwise the newer draft
 * stays dirty and saves next against the revision the save returned.
 */

/** Drafts kept for Undo (deleting a line, and other structural edits). */
export const UNDO_LIMIT = 20;

export type RepertoireWorkspaceState = {
  repertoireId: string | null;
  chapterId: string | null;
  /** The repertoire's colour (the side whose moves are choices). */
  color: RepertoireColor;
  chapter: RepertoireChapter | null;
  selectedNodeId: string;
  orientation: Color;
  dirty: boolean;
  generation: number;
  saveState: AutosaveSaveState;
  /** The repertoire revision the draft is based on (`expectedRevision` of the next write). */
  baseRevision: number;
  undoStack: RepertoireChapter[];
  /** Decisions written this session (until the API can read them back). */
  decisions: Record<string, RepertoireDecision>;
};

type Actions = {
  loadChapter: (
    detail: RepertoireDetail,
    chapter: RepertoireChapter,
    options?: { nodeId?: string | null; orientation?: Color | null }
  ) => void;
  reset: () => void;
  selectNode: (nodeId: string) => void;
  /** Plays a move from the selected node: selects an existing child or adds a new one. */
  playMove: (uci: string, san: string, fenAfter: string) => { nodeId: string; created: boolean };
  /**
   * Stages a move from another screen (a game's opening comparison) under `parentNodeId`: an
   * existing child is only selected; a new one is added with `edge` and selected, unsaved until
   * autosave. Null when the parent is unknown or the move is illegal there.
   */
  stageMove: (
    parentNodeId: string,
    uci: string,
    edge: RepertoireNodeMeta["edge"]
  ) => { nodeId: string; created: boolean } | null;
  setNodeMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  setComment: (nodeId: string, text: string) => void;
  setShapes: (nodeId: string, arrows: BoardArrow[], highlights: BoardHighlight[]) => void;
  setChapterFields: (
    patch: Partial<Pick<RepertoireChapter, "title" | "kind" | "enabled" | "sortOrder">>
  ) => void;
  deleteLine: (nodeId: string) => boolean;
  undo: () => boolean;
  promoteVariation: (nodeId: string) => void;
  flip: () => void;
  setOrientation: (orientation: Color) => void;
  markSaving: () => void;
  saveSucceeded: (result: ChapterSaveResult, generationAtSave: number) => void;
  saveFailed: (message: string, stale: boolean) => void;
  /** Clears a save error so autosave resumes (after Retry / Keep editing). */
  clearSaveError: () => void;
  /**
   * Another write (decision, chapter list) moved the repertoire to `revision`; `chapterRevision`
   * (the open chapter's stored revision) lets the draft overwrite it on its next save.
   */
  adoptRevision: (revision: number, chapterRevision?: number) => void;
  rememberDecision: (decision: RepertoireDecision) => void;
};

const initialState: RepertoireWorkspaceState = {
  repertoireId: null,
  chapterId: null,
  color: "white",
  chapter: null,
  selectedNodeId: REPERTOIRE_ROOT_NODE_ID,
  orientation: "white",
  dirty: false,
  generation: 0,
  saveState: { status: "idle" },
  baseRevision: 0,
  undoStack: [],
  decisions: {}
};

/** Removes `nodeId` and its subtree. Returns the tree, the removed ids and the parent id. */
export function removeSubtree(
  tree: readonly MoveNode[],
  nodeId: string
): { tree: MoveNode[]; removed: Set<string>; parentId: string | null } {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const target = byId.get(nodeId);
  if (!target || !target.parentId) return { tree: [...tree], removed: new Set(), parentId: null };
  const removed = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (removed.has(id)) continue;
    removed.add(id);
    for (const child of byId.get(id)?.children ?? []) stack.push(child);
  }
  const next = tree
    .filter((node) => !removed.has(node.id))
    .map((node) =>
      node.id === target.parentId
        ? { ...node, children: node.children.filter((id) => id !== nodeId) }
        : node
    );
  return { tree: next, removed, parentId: target.parentId };
}

/** Moves `nodeId` to the front of its parent's children (it becomes the main line). */
export function promoteChild(tree: readonly MoveNode[], nodeId: string): MoveNode[] {
  const node = tree.find((item) => item.id === nodeId);
  if (!node?.parentId) return [...tree];
  return tree.map((item) =>
    item.id === node.parentId && item.children[0] !== nodeId
      ? { ...item, children: [nodeId, ...item.children.filter((id) => id !== nodeId)] }
      : item
  );
}

/** The SAN and resulting position of `uci` from `fen`, or null when it isn't legal there. */
export function playUci(fen: string, uci: string): { san: string; fenAfter: string } | null {
  try {
    const position = positionFromFen(fen);
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) return null;
    const san = makeSanAndPlay(position, move);
    return { san, fenAfter: makeFen(position.toSetup()) };
  } catch {
    return null;
  }
}

function withUndo(
  stack: readonly RepertoireChapter[],
  draft: RepertoireChapter
): RepertoireChapter[] {
  return [...stack, draft].slice(-UNDO_LIMIT);
}

export const useRepertoireWorkspaceStore = create<RepertoireWorkspaceState & Actions>(
  (set, get) => {
    /** Applies an edit to the draft (bumps the generation, marks it dirty). */
    const edit = (
      change: (chapter: RepertoireChapter) => RepertoireChapter,
      options: { undoable?: boolean; selectedNodeId?: string } = {}
    ) => {
      const { chapter, generation, undoStack } = get();
      if (!chapter) return;
      set({
        chapter: change(chapter),
        dirty: true,
        generation: generation + 1,
        undoStack: options.undoable ? withUndo(undoStack, chapter) : undoStack,
        ...(options.selectedNodeId ? { selectedNodeId: options.selectedNodeId } : {})
      });
    };

    const patchNode = (nodeId: string, patch: Partial<MoveNode>) =>
      edit((chapter) => ({
        ...chapter,
        tree: chapter.tree.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
      }));

    return {
      ...initialState,

      loadChapter: (detail, chapter, options = {}) => {
        const nodeId =
          options.nodeId && chapter.tree.some((node) => node.id === options.nodeId)
            ? options.nodeId
            : REPERTOIRE_ROOT_NODE_ID;
        set({
          ...initialState,
          decisions: get().repertoireId === detail.id ? get().decisions : {},
          repertoireId: detail.id,
          chapterId: chapter.id,
          color: detail.color,
          chapter,
          selectedNodeId: nodeId,
          orientation: options.orientation ?? detail.workspace?.orientation ?? detail.color,
          baseRevision: detail.revision
        });
      },

      reset: () => set(initialState),

      selectNode: (nodeId) => {
        const { chapter } = get();
        if (chapter?.tree.some((node) => node.id === nodeId)) set({ selectedNodeId: nodeId });
      },

      playMove: (rawUci, san, fenAfter) => {
        const { chapter, selectedNodeId, color } = get();
        const parent = chapter?.tree.find((node) => node.id === selectedNodeId);
        if (!chapter || !parent) return { nodeId: selectedNodeId, created: false };
        const uci = standardCastlingUci(parent.fenAfter, rawUci);
        const existing = chapter.tree.find(
          (node) => node.parentId === parent.id && node.uci === uci
        );
        if (existing) {
          set({ selectedNodeId: existing.id });
          return { nodeId: existing.id, created: false };
        }
        const added = addMoveNode(chapter.tree, parent.id, san, uci, parent.fenAfter, fenAfter);
        edit(
          (current) => ({
            ...current,
            tree: added.moveTree,
            nodeMeta: {
              ...current.nodeMeta,
              [added.node.id]: { edge: defaultEdgeForNewMove(parent.fenAfter, color) }
            }
          }),
          { selectedNodeId: added.node.id }
        );
        return { nodeId: added.node.id, created: true };
      },

      stageMove: (parentNodeId, uci, edge) => {
        const parent = get().chapter?.tree.find((node) => node.id === parentNodeId);
        if (!parent) return null;
        const played = playUci(parent.fenAfter, uci);
        if (!played) return null;
        const { san, fenAfter } = played;
        set({ selectedNodeId: parent.id });
        const result = get().playMove(uci, san, fenAfter);
        const meta = get().chapter?.nodeMeta[result.nodeId];
        if (result.created) {
          if (meta?.edge !== edge) get().setNodeMeta(result.nodeId, { edge });
        } else if (edge !== "reference") {
          // An existing move staged as covered/included takes that edge and is re-enabled; a
          // reference stage never demotes a move the chapter already has (it's only selected).
          const current = nodeMetaOf(get().chapter!.nodeMeta, result.nodeId);
          if (current.edge !== edge || current.disabled) {
            get().setNodeMeta(result.nodeId, { edge, disabled: false });
          }
        }
        return result;
      },

      setNodeMeta: (nodeId, patch) =>
        edit((chapter) => {
          const merged: RepertoireNodeMeta = { ...nodeMetaOf(chapter.nodeMeta, nodeId), ...patch };
          // Unset flags are dropped so the stored metadata stays minimal.
          for (const key of ["trainingStart", "trainingStop", "disabled"] as const) {
            if (!merged[key]) delete merged[key];
          }
          return { ...chapter, nodeMeta: { ...chapter.nodeMeta, [nodeId]: merged } };
        }),

      setComment: (nodeId, text) => patchNode(nodeId, { comment: text.trim() ? text : null }),

      setShapes: (nodeId, arrows, highlights) => patchNode(nodeId, { arrows, highlights }),

      setChapterFields: (patch) => edit((chapter) => ({ ...chapter, ...patch })),

      deleteLine: (nodeId) => {
        const { chapter, selectedNodeId } = get();
        if (!chapter || nodeId === REPERTOIRE_ROOT_NODE_ID) return false;
        const { tree, removed, parentId } = removeSubtree(chapter.tree, nodeId);
        if (!removed.size || !parentId) return false;
        const nodeMeta = Object.fromEntries(
          Object.entries(chapter.nodeMeta).filter(([id]) => !removed.has(id))
        );
        edit((current) => ({ ...current, tree, nodeMeta }), {
          undoable: true,
          selectedNodeId: removed.has(selectedNodeId) ? parentId : selectedNodeId
        });
        return true;
      },

      undo: () => {
        const { undoStack, selectedNodeId, generation } = get();
        const previous = undoStack[undoStack.length - 1];
        if (!previous) return false;
        set({
          chapter: previous,
          undoStack: undoStack.slice(0, -1),
          dirty: true,
          generation: generation + 1,
          selectedNodeId: previous.tree.some((node) => node.id === selectedNodeId)
            ? selectedNodeId
            : REPERTOIRE_ROOT_NODE_ID
        });
        return true;
      },

      promoteVariation: (nodeId) =>
        edit((chapter) => ({ ...chapter, tree: promoteChild(chapter.tree, nodeId) }), {
          undoable: true
        }),

      flip: () =>
        set((state) => ({ orientation: state.orientation === "white" ? "black" : "white" })),
      setOrientation: (orientation) => set({ orientation }),

      markSaving: () => set({ saveState: { status: "saving" } }),

      saveSucceeded: (result, generationAtSave) => {
        const state = get();
        // The draft moved to another chapter while this save ran: only the revision matters.
        if (state.chapterId !== result.chapter.id || state.repertoireId !== result.repertoire.id) {
          if (state.repertoireId === result.repertoire.id) {
            set({ baseRevision: Math.max(state.baseRevision, result.repertoire.revision) });
          }
          return;
        }
        const baseRevision = result.repertoire.revision;
        if (shouldAdoptSaveResult(generationAtSave, state.generation)) {
          set({
            chapter: result.chapter,
            dirty: false,
            baseRevision,
            saveState: { status: "idle" },
            selectedNodeId: result.chapter.tree.some((node) => node.id === state.selectedNodeId)
              ? state.selectedNodeId
              : REPERTOIRE_ROOT_NODE_ID
          });
        } else {
          // Newer edits are kept (still dirty); they save next against the new revision.
          set({
            baseRevision,
            saveState: { status: "idle" },
            chapter: state.chapter ? { ...state.chapter, revision: result.chapter.revision } : null
          });
        }
      },

      saveFailed: (message, stale) => set({ saveState: { status: "error", message, stale } }),
      clearSaveError: () => set({ saveState: { status: "idle" } }),
      adoptRevision: (revision, chapterRevision) =>
        set((state) => ({
          baseRevision: Math.max(state.baseRevision, revision),
          ...(chapterRevision !== undefined && state.chapter
            ? {
                chapter: {
                  ...state.chapter,
                  revision: Math.max(state.chapter.revision, chapterRevision)
                }
              }
            : {})
        })),
      rememberDecision: (decision) =>
        set((state) => ({ decisions: { ...state.decisions, [decision.positionKey]: decision } }))
    };
  }
);
