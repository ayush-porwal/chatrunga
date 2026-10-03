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
  decisionDraftKey,
  defaultEdgeForNewMove,
  shouldAdoptSaveResult,
  type AutosaveSaveState,
  type DecisionTextDraft,
  type DecisionTextField
} from "../features/repertoire/repertoire-model";

/**
 * The repertoire study draft: one chapter being edited, its selected node and board orientation,
 * and the autosave bookkeeping. Ephemeral — the main process owns the saved chapter; this store
 * never touches the game store (game autosave would turn it into a library game).
 *
 * `generation` counts edits. A save remembers the generation it sent, and its result only replaces
 * the draft when no edit happened meanwhile (`shouldAdoptSaveResult`); otherwise the newer draft
 * stays dirty and saves next against the revision the save returned.
 *
 * `decisionDrafts` hold decision changes made at a position (practice prompts and hints,
 * wrong-move feedback, pausing) until their write is confirmed (see decision-text-drafts.ts). They belong to no chapter: opening another chapter or
 * resetting the draft keeps them, so a failed write is never lost by moving on.
 */

/** Structural edits kept for Undo (and as many undone ones for Redo). */
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
  /**
   * The chapter before each structural edit (adding a move, deleting a line, promoting a
   * variation, edge and training-mark changes), newest last. Comments, shapes and chapter fields
   * aren't undone here (their text fields keep native undo); undoing restores the tree's shape and
   * metadata and keeps the current comments and shapes of the moves it keeps. Both stacks reset
   * when a chapter loads (another chapter, or a reload after a conflict).
   */
  undoStack: RepertoireChapter[];
  /** The chapter before each undo, newest last; a new structural edit clears it. */
  redoStack: RepertoireChapter[];
  /** Decisions written this session (until the API can read them back). */
  decisions: Record<string, RepertoireDecision>;
  /** Decision changes (prompt, hint, feedback, pause) not yet saved, by decisionDraftKey. */
  decisionDrafts: Record<string, DecisionTextDraft>;
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
   * autosave. A reference stage selects the parent instead, so Choices lists the move with Accept.
   * Null when the parent is unknown or the move is illegal there.
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
  redo: () => boolean;
  /**
   * Moves the variation holding `nodeId` one level up: the nearest move on its path that isn't
   * its parent's first continuation becomes the first (the chapter's authored main line there,
   * as PGN export writes it). False when the path is the main line already.
   */
  promoteVariation: (nodeId: string) => boolean;
  flip: () => void;
  setOrientation: (orientation: Color) => void;
  markSaving: () => void;
  saveSucceeded: (result: ChapterSaveResult, generationAtSave: number) => void;
  saveFailed: (message: string, stale: boolean) => void;
  /**
   * Clears a save error so autosave resumes (after Retry / Keep editing). A prompt or hint write
   * that failed (not as stale) becomes pending again, so the next flush retries it.
   */
  clearSaveError: () => void;
  /**
   * Another write (decision, chapter list) moved the repertoire to `revision`; `chapterRevision`
   * (the open chapter's stored revision) lets the draft overwrite it on its next save.
   */
  adoptRevision: (revision: number, chapterRevision?: number) => void;
  rememberDecision: (decision: RepertoireDecision) => void;
  /** The prompt or hint field as typed at a position (kept until saved or discarded). */
  setDecisionText: (
    repertoireId: string,
    positionKey: string,
    field: DecisionTextField,
    text: string
  ) => void;
  /** The feedback typed for one wrong move at a position (blank: remove it once saved). */
  setWrongMoveFeedback: (
    repertoireId: string,
    positionKey: string,
    uci: string,
    text: string
  ) => void;
  /** Pausing or resuming the decision at a position (kept until saved or discarded). */
  setDecisionPaused: (repertoireId: string, positionKey: string, paused: boolean) => void;
  discardDecisionText: (key: string) => void;
  /** Committed while its write runs: the draft is written again once that write settles. */
  requestDecisionTextSaveAgain: (key: string) => void;
  /**
   * After a write settled: whether the draft was committed again meanwhile and should be written
   * again now (never one refused as stale, which waits for Keep mine or Discard). Clears the mark.
   */
  takeDecisionTextSaveAgain: (key: string) => boolean;
  /** A write of the draft started; returns the generation it sends (null: no draft). */
  markDecisionTextSaving: (key: string) => number | null;
  /** The write of `generation` was confirmed: the draft goes, unless it was edited since. */
  decisionTextSaved: (key: string, generation: number) => void;
  /** The write was refused; `missing` when its position is in no chapter any more. */
  decisionTextFailed: (key: string, message: string, stale: boolean, missing?: boolean) => void;
  /** A failed draft becomes pending again (Retry, or Keep mine after a stale refusal). */
  clearDecisionTextError: (key: string) => void;
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
  redoStack: [],
  decisions: {},
  decisionDrafts: {}
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

/**
 * The move `promoteVariation` moves for `nodeId`: the node itself or its nearest ancestor that
 * isn't its parent's first child. Null on the main line (or for the root).
 */
export function promotionTarget(tree: readonly MoveNode[], nodeId: string): string | null {
  const byId = new Map(tree.map((node) => [node.id, node]));
  let node = byId.get(nodeId);
  while (node?.parentId) {
    const parent = byId.get(node.parentId);
    if (parent && parent.children[0] !== node.id) return node.id;
    node = parent;
  }
  return null;
}

/**
 * `snapshot`'s tree shape and metadata with `current`'s chapter fields, and the current comments,
 * shapes and NAGs of the moves both have: what Undo and Redo restore.
 */
export function withStructureOf(
  snapshot: RepertoireChapter,
  current: RepertoireChapter
): RepertoireChapter {
  const latest = new Map(current.tree.map((node) => [node.id, node]));
  return {
    ...current,
    nodeMeta: snapshot.nodeMeta,
    tree: snapshot.tree.map((node) => {
      const now = latest.get(node.id);
      return now
        ? {
            ...node,
            comment: now.comment,
            nags: now.nags,
            arrows: now.arrows,
            highlights: now.highlights
          }
        : node;
    })
  };
}

/** `nodeId` when `tree` has it, else its nearest ancestor (in `from`) that `tree` has. */
function nearestKept(tree: readonly MoveNode[], from: readonly MoveNode[], nodeId: string): string {
  const kept = new Set(tree.map((node) => node.id));
  const byId = new Map(from.map((node) => [node.id, node]));
  let id: string | null = nodeId;
  while (id && !kept.has(id)) id = byId.get(id)?.parentId ?? null;
  return id ?? REPERTOIRE_ROOT_NODE_ID;
}

/**
 * Field-wise equality of two plain values (arrays, objects, primitives). A null or undefined field
 * counts as absent, as a save's JSON round trip may drop it.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b || (a == null && b == null)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] != null);
  const otherKeys = Object.keys(right).filter((key) => right[key] != null);
  return keys.length === otherKeys.length && keys.every((key) => sameValue(left[key], right[key]));
}

/**
 * The saved tree, or the local one when the save returned the same content: the draft's tree
 * keeps its identity across autosaves, so the study page's lookup and tree rows (memoised on it)
 * aren't rebuilt after every save (design §11).
 */
export function reuseUnchangedTree(local: MoveNode[], saved: MoveNode[]): MoveNode[] {
  if (local.length !== saved.length) return saved;
  return local.every((node, index) => sameValue(node, saved[index])) ? local : saved;
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
    /** Set while a compound edit runs: it takes one undo step, recorded before it started. */
    let grouping = false;

    /**
     * Applies an edit to the draft (bumps the generation, marks it dirty). An undoable one keeps
     * the chapter before it for Undo and clears Redo. An edit that leaves the chapter as it was
     * (Prefer on a move already included, the same comment again) is none: no undo step, nothing
     * to save, and Redo stays (only its selection applies).
     */
    const edit = (
      change: (chapter: RepertoireChapter) => RepertoireChapter,
      options: { undoable?: boolean; selectedNodeId?: string } = {}
    ) => {
      const { chapter, generation, undoStack, redoStack } = get();
      if (!chapter) return;
      const next = change(chapter);
      if (sameValue(chapter, next)) {
        if (options.selectedNodeId) set({ selectedNodeId: options.selectedNodeId });
        return;
      }
      const recorded = options.undoable && !grouping;
      set({
        chapter: next,
        dirty: true,
        generation: generation + 1,
        undoStack: recorded ? withUndo(undoStack, chapter) : undoStack,
        redoStack: recorded ? [] : redoStack,
        ...(options.selectedNodeId ? { selectedNodeId: options.selectedNodeId } : {})
      });
    };

    /** Runs `edits` as one undo step (when they change the draft at all). */
    const group = <T>(edits: () => T): T => {
      const { chapter, undoStack } = get();
      grouping = true;
      try {
        return edits();
      } finally {
        grouping = false;
        if (chapter && get().chapter !== chapter) {
          set({ undoStack: withUndo(undoStack, chapter), redoStack: [] });
        }
      }
    };

    /** Undo / Redo: moves the draft to the top of `from`, keeping the current one on `to`. */
    const step = (from: "undoStack" | "redoStack", to: "undoStack" | "redoStack") => {
      const state = get();
      const target = state[from][state[from].length - 1];
      if (!target || !state.chapter) return false;
      const chapter = withStructureOf(target, state.chapter);
      set({
        chapter,
        [from]: state[from].slice(0, -1),
        [to]: withUndo(state[to], state.chapter),
        dirty: true,
        generation: state.generation + 1,
        selectedNodeId: nearestKept(chapter.tree, state.chapter.tree, state.selectedNodeId)
      });
      return true;
    };

    /** Creates or edits a decision draft (an edit bumps its generation; its status stays). */
    const putDecisionDraft = (
      change: Pick<DecisionTextDraft, "repertoireId" | "positionKey" | "field" | "uci" | "text"> &
        Pick<Partial<DecisionTextDraft>, "paused">
    ) =>
      set((state) => {
        const key = decisionDraftKey(
          change.repertoireId,
          change.positionKey,
          change.field,
          change.uci
        );
        const current = state.decisionDrafts[key];
        const draft: DecisionTextDraft = current
          ? { ...current, ...change, generation: current.generation + 1 }
          : { ...change, generation: 1, status: "pending" };
        if (draft.uci === undefined) delete draft.uci;
        if (draft.paused === undefined) delete draft.paused;
        return { decisionDrafts: { ...state.decisionDrafts, [key]: draft } };
      });

    /** stageMove's edits, once the move is known to be legal at `parentId`. */
    const stageAt = (
      parentId: string,
      uci: string,
      { san, fenAfter }: { san: string; fenAfter: string },
      edge: RepertoireNodeMeta["edge"]
    ) => {
      set({ selectedNodeId: parentId });
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
      if (edge === "reference") set({ selectedNodeId: parentId });
      return result;
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
          decisionDrafts: get().decisionDrafts,
          repertoireId: detail.id,
          chapterId: chapter.id,
          color: detail.color,
          chapter,
          selectedNodeId: nodeId,
          orientation: options.orientation ?? detail.workspace?.orientation ?? detail.color,
          baseRevision: detail.revision
        });
      },

      reset: () => set({ ...initialState, decisionDrafts: get().decisionDrafts }),

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
          { undoable: true, selectedNodeId: added.node.id }
        );
        return { nodeId: added.node.id, created: true };
      },

      stageMove: (parentNodeId, uci, edge) => {
        const parent = get().chapter?.tree.find((node) => node.id === parentNodeId);
        if (!parent) return null;
        const played = playUci(parent.fenAfter, uci);
        if (!played) return null;
        // Adding the move and setting its edge are one undo step.
        return group(() => stageAt(parent.id, uci, played, edge));
      },

      setNodeMeta: (nodeId, patch) =>
        edit(
          (chapter) => {
            const merged: RepertoireNodeMeta = {
              ...nodeMetaOf(chapter.nodeMeta, nodeId),
              ...patch
            };
            // Unset flags are dropped so the stored metadata stays minimal.
            for (const key of ["trainingStart", "trainingStop", "disabled"] as const) {
              if (!merged[key]) delete merged[key];
            }
            // What the move has already (a missing entry is an included edge): no edit.
            if (sameValue(nodeMetaOf(chapter.nodeMeta, nodeId), merged)) return chapter;
            return { ...chapter, nodeMeta: { ...chapter.nodeMeta, [nodeId]: merged } };
          },
          { undoable: true }
        ),

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

      undo: () => step("undoStack", "redoStack"),

      redo: () => step("redoStack", "undoStack"),

      promoteVariation: (nodeId) => {
        const target = promotionTarget(get().chapter?.tree ?? [], nodeId);
        if (!target) return false;
        edit((chapter) => ({ ...chapter, tree: promoteChild(chapter.tree, target) }), {
          undoable: true
        });
        return true;
      },

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
          const tree = state.chapter
            ? reuseUnchangedTree(state.chapter.tree, result.chapter.tree)
            : result.chapter.tree;
          set({
            chapter: { ...result.chapter, tree },
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
      clearSaveError: () =>
        set((state) => ({
          saveState: { status: "idle" },
          decisionDrafts: Object.fromEntries(
            Object.entries(state.decisionDrafts).map(([key, draft]) => [
              key,
              draft.status === "error" && !draft.error?.stale
                ? { ...draft, status: "pending" as const, error: undefined }
                : draft
            ])
          )
        })),
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
        set((state) => ({ decisions: { ...state.decisions, [decision.positionKey]: decision } })),

      setDecisionText: (repertoireId, positionKey, field, text) =>
        putDecisionDraft({ repertoireId, positionKey, field, text }),

      setWrongMoveFeedback: (repertoireId, positionKey, uci, text) =>
        putDecisionDraft({ repertoireId, positionKey, field: "feedback", uci, text }),

      setDecisionPaused: (repertoireId, positionKey, paused) =>
        putDecisionDraft({ repertoireId, positionKey, field: "paused", text: "", paused }),

      discardDecisionText: (key) =>
        set((state) => {
          if (!state.decisionDrafts[key]) return {};
          const decisionDrafts = { ...state.decisionDrafts };
          delete decisionDrafts[key];
          return { decisionDrafts };
        }),

      requestDecisionTextSaveAgain: (key) =>
        set((state) => {
          const draft = state.decisionDrafts[key];
          if (draft?.status !== "saving") return {};
          return {
            decisionDrafts: { ...state.decisionDrafts, [key]: { ...draft, saveAgain: true } }
          };
        }),

      takeDecisionTextSaveAgain: (key) => {
        const draft = get().decisionDrafts[key];
        if (!draft?.saveAgain) return false;
        const next = { ...draft };
        delete next.saveAgain;
        set((state) => ({ decisionDrafts: { ...state.decisionDrafts, [key]: next } }));
        return !(draft.status === "error" && draft.error?.stale);
      },

      markDecisionTextSaving: (key) => {
        const draft = get().decisionDrafts[key];
        if (!draft) return null;
        set((state) => ({
          decisionDrafts: {
            ...state.decisionDrafts,
            [key]: { ...draft, status: "saving", error: undefined }
          }
        }));
        return draft.generation;
      },

      decisionTextSaved: (key, generation) => {
        const draft = get().decisionDrafts[key];
        if (!draft) return;
        if (draft.generation === generation) get().discardDecisionText(key);
        else {
          // Typed while it saved: the newer text stays, pending its own write.
          set((state) => ({
            decisionDrafts: { ...state.decisionDrafts, [key]: { ...draft, status: "pending" } }
          }));
        }
      },

      decisionTextFailed: (key, message, stale, missing = false) =>
        set((state) => {
          const draft = state.decisionDrafts[key];
          if (!draft) return {};
          return {
            decisionDrafts: {
              ...state.decisionDrafts,
              [key]: {
                ...draft,
                status: "error",
                error: missing ? { message, stale, missing } : { message, stale }
              }
            }
          };
        }),

      clearDecisionTextError: (key) =>
        set((state) => {
          const draft = state.decisionDrafts[key];
          if (draft?.status !== "error") return {};
          return {
            decisionDrafts: {
              ...state.decisionDrafts,
              [key]: { ...draft, status: "pending", error: undefined }
            }
          };
        })
    };
  }
);
