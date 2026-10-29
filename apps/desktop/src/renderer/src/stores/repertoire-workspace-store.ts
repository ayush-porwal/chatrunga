import { create } from "zustand";
import { promoteChild, promotionTarget } from "@chaturanga/shared/chess/move-tree-promote";
import { nodeMetaOf } from "@chaturanga/shared/chess/repertoire-index";
import { trainableChapter, type AcceptedAt } from "@chaturanga/shared/chess/repertoire-training";
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
  nextDecisionDraft,
  shouldAdoptSaveResult,
  type AutosaveSaveState,
  type DecisionDraftChange,
  type DecisionDraftEvent,
  type DecisionTextDraft,
  type DecisionTextField
} from "../features/repertoire/repertoire-model";
import {
  chapterWithLines,
  chapterWithStaged,
  dropStaged,
  liveStaged,
  playUcis,
  stageLine,
  stagedLines,
  treeWithStaged
} from "../features/repertoire/study-staging";

/**
 * The repertoire study draft: one chapter being edited, its selected node and board orientation,
 * and the autosave bookkeeping. Ephemeral — the main process owns the saved chapter; this store
 * never touches the game store (game autosave would turn it into a library game).
 *
 * `generation` counts edits. A save remembers the generation it sent, and its result only replaces
 * the draft when no edit happened meanwhile (`shouldAdoptSaveResult`); otherwise the newer draft
 * stays dirty and saves next against the revision the save returned.
 *
 * `staged` holds the moves played in Study that the chapter doesn't have yet (study-staging.ts):
 * shown in the tree and selectable, but never saved and outside Undo until Add puts them in the
 * chapter as one edit. Loading a chapter drops them, and so does leaving Study (its page).
 *
 * `decisionDrafts` hold decision changes made at a position (practice prompts and hints,
 * wrong-move feedback, pausing) until their write is confirmed (see decision-text-drafts.ts). They belong to no chapter: opening another chapter or
 * resetting the draft keeps them, so a failed write is never lost by moving on.
 */

/** Structural edits kept for Undo (and as many undone ones for Redo). */
export const UNDO_LIMIT = 20;

/**
 * Staged moves added to another chapter of the repertoire: their lines (UCI moves from `rootFen`,
 * the chapter they were staged in), applied once that chapter is loaded.
 */
type PendingAdd = {
  repertoireId: string;
  chapterId: string;
  rootFen: string;
  lines: string[][];
  studyOnly: boolean;
};

export type RepertoireWorkspaceState = {
  repertoireId: string | null;
  chapterId: string | null;
  /** The repertoire's colour (the side whose moves are choices). */
  color: RepertoireColor;
  chapter: RepertoireChapter | null;
  /** Moves played here that aren't in the chapter yet (see above); never saved, never undone. */
  staged: MoveNode[];
  /**
   * Staged moves on their way to another chapter, once Study opened it (applied when it loads;
   * loading any other chapter, leaving Study or a reset drops them).
   */
  pendingAdd: PendingAdd | null;
  /** The selected node: one of the chapter's or a staged move. */
  selectedNodeId: string;
  orientation: Color;
  dirty: boolean;
  generation: number;
  saveState: AutosaveSaveState;
  /** The repertoire revision the draft is based on (`expectedRevision` of the next write). */
  baseRevision: number;
  /**
   * The chapter before each structural edit (adding a move, deleting a line, promoting a
   * variation, edge and training-mark changes, "Include in practice"), newest last. Comments,
   * shapes and chapter fields aren't undone here (their text fields keep native undo); undoing
   * restores the tree's shape and metadata and keeps the current comments and shapes of the moves
   * it keeps. The one exception is "Include in practice": its step also puts back the chapter's
   * practice fields (on for practice, kind) it changed. Both stacks reset when a chapter loads
   * (another chapter, or a reload after a conflict).
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
  /**
   * A move made on the board at the selected node: selects the move the chapter (or the staged
   * moves) has there, else stages it. The move selected, and whether it was staged.
   */
  playMove: (uci: string, san: string, fenAfter: string) => { nodeId: string; staged: boolean };
  /**
   * Stages `ucis` from `fromNodeId` (an engine line picked in Study, the explorer, a move another
   * screen asks for): moves the chapter or the staged moves have are followed, the rest staged.
   * Selects the last move. Null, changing nothing, when the node isn't shown, the line is empty or
   * a move is illegal where it's played.
   */
  playLine: (
    fromNodeId: string,
    ucis: readonly string[]
  ) => { nodeId: string; staged: boolean } | null;
  /** Drops a staged move and what follows it (its parent is selected if it was). */
  dropStaged: (nodeId: string) => void;
  /** Drops every staged move. */
  discardStaged: () => void;
  /**
   * Adds the staged moves to the chapter as one undoable edit: the player's as practised moves
   * (study-only with `studyOnly`), the opponent's as covered. Returns how many were added.
   */
  addStaged: (options?: { studyOnly?: boolean }) => number;
  /**
   * Hands the staged lines to `chapterId` (another chapter of the repertoire; see applyPendingAdd)
   * once `open` opened it, and drops them here. Until then they stay staged: when it doesn't open
   * (a save that failed, a newer navigation) nothing is handed over. False then, or when nothing
   * is staged.
   */
  addStagedElsewhere: (
    chapterId: string,
    open: () => Promise<boolean>,
    options?: { studyOnly?: boolean }
  ) => Promise<boolean>;
  /**
   * Adds the lines handed over by addStagedElsewhere to the chapter now loaded, as one undoable
   * edit selecting the end: "none" when there are none for it, "failed" (dropped) when they reach
   * none of its positions.
   */
  applyPendingAdd: () => "applied" | "failed" | "none";
  /** Drops the lines handed to another chapter that hasn't loaded them (Study was left). */
  dropPendingAdd: () => void;
  setNodeMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  /**
   * "Include in practice": switches the chapter on as an opening chapter and accepts the first
   * own move wherever none is accepted (one the repertoire already accepts there, per
   * `acceptedAt`), covering reference replies (`trainableChapter`). One undo step puts back all
   * of it: the moves' marks and whether the chapter was on for practice and of which kind.
   */
  makeChapterTrainable: (acceptedAt?: AcceptedAt) => void;
  setComment: (nodeId: string, text: string) => void;
  setShapes: (nodeId: string, arrows: BoardArrow[], highlights: BoardHighlight[]) => void;
  setChapterFields: (
    patch: Partial<Pick<RepertoireChapter, "title" | "kind" | "enabled" | "sortOrder" | "opening">>
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
   * Moves the draft at `key` through `event` (nextDecisionDraft, the one state machine of a
   * draft). Returns whether it must be written again now.
   */
  updateDecisionDraft: (
    key: string,
    event: Exclude<DecisionDraftEvent, { type: "edit" }>
  ) => boolean;
};

const initialState: RepertoireWorkspaceState = {
  repertoireId: null,
  chapterId: null,
  color: "white",
  chapter: null,
  staged: [],
  pendingAdd: null,
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

/** `pending` when it is for this chapter, else null. */
function pendingAddFor(
  pending: PendingAdd | null,
  repertoireId: string,
  chapterId: string
): PendingAdd | null {
  return pending?.repertoireId === repertoireId && pending.chapterId === chapterId ? pending : null;
}

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

/**
 * `snapshot`'s tree shape and metadata with `current`'s chapter fields, and the current comments,
 * shapes and NAGs of the moves both have: what Undo and Redo restore.
 */
function withStructureOf(
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
  const field = (value: object, key: string): unknown => Reflect.get(value, key);
  const keys = Object.keys(a).filter((key) => field(a, key) != null);
  const otherKeys = Object.keys(b).filter((key) => field(b, key) != null);
  return (
    keys.length === otherKeys.length && keys.every((key) => sameValue(field(a, key), field(b, key)))
  );
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

function withUndo(
  stack: readonly RepertoireChapter[],
  draft: RepertoireChapter
): RepertoireChapter[] {
  return [...stack, draft].slice(-UNDO_LIMIT);
}

export const useRepertoireWorkspaceStore = create<RepertoireWorkspaceState & Actions>(
  (set, get) => {
    /**
     * Undo / Redo entries that also restore the chapter's practice fields (enabled, kind): the
     * chapter before "Include in practice", and the ones its Undo and Redo leave on the other stack.
     */
    const practiceFieldSteps = new WeakSet<RepertoireChapter>();

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
      set({
        chapter: next,
        dirty: true,
        generation: generation + 1,
        undoStack: options.undoable ? withUndo(undoStack, chapter) : undoStack,
        redoStack: options.undoable ? [] : redoStack,
        ...followTree(chapter, next, options.selectedNodeId ?? get().selectedNodeId)
      });
    };

    /**
     * The staged moves and selection once the chapter's tree went from `before`'s to `after`'s:
     * staged moves whose parent went drop out, and a selection that went moves to its nearest
     * remaining ancestor.
     */
    const followTree = (before: RepertoireChapter, after: RepertoireChapter, selected: string) => {
      const { staged } = get();
      const kept = after.tree === before.tree ? staged : liveStaged(after.tree, staged);
      const shown = treeWithStaged(after.tree, kept);
      return {
        staged: kept === staged ? staged : [...kept],
        selectedNodeId: nearestKept(shown, treeWithStaged(before.tree, staged), selected)
      };
    };

    /** Undo / Redo: moves the draft to the top of `from`, keeping the current one on `to`. */
    const step = (from: "undoStack" | "redoStack", to: "undoStack" | "redoStack") => {
      const state = get();
      const target = state[from].at(-1);
      if (!target || !state.chapter) return false;
      const structure = withStructureOf(target, state.chapter);
      const fields = practiceFieldSteps.has(target);
      const chapter = fields
        ? { ...structure, kind: target.kind, enabled: target.enabled }
        : structure;
      if (fields) practiceFieldSteps.add(state.chapter);
      set({
        chapter,
        [from]: state[from].slice(0, -1),
        [to]: withUndo(state[to], state.chapter),
        dirty: true,
        generation: state.generation + 1,
        ...followTree(state.chapter, chapter, state.selectedNodeId)
      });
      return true;
    };

    /** Moves one decision draft through `event` (see nextDecisionDraft). */
    const transitionDraft = (key: string, event: DecisionDraftEvent): boolean => {
      const { draft, writeAgain } = nextDecisionDraft(get().decisionDrafts[key], event);
      set((state) => {
        const decisionDrafts = { ...state.decisionDrafts };
        if (draft) decisionDrafts[key] = draft;
        else delete decisionDrafts[key];
        return { decisionDrafts };
      });
      return writeAgain;
    };

    /** Creates or edits a decision draft (an edit bumps its generation; its status stays). */
    const putDecisionDraft = (change: DecisionDraftChange) =>
      transitionDraft(
        decisionDraftKey(change.repertoireId, change.positionKey, change.field, change.uci),
        { type: "edit", change }
      );

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
          // Only the chapter they were handed to takes them; any other drops them.
          pendingAdd: pendingAddFor(get().pendingAdd, detail.id, chapter.id),
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
        const { chapter, staged } = get();
        if (chapter && treeWithStaged(chapter.tree, staged).some((node) => node.id === nodeId)) {
          set({ selectedNodeId: nodeId });
        }
      },

      playMove: (rawUci, san, fenAfter) => {
        const { chapter, selectedNodeId, staged } = get();
        const parent = chapter
          ? treeWithStaged(chapter.tree, staged).find((node) => node.id === selectedNodeId)
          : undefined;
        if (!chapter || !parent) return { nodeId: selectedNodeId, staged: false };
        const uci = standardCastlingUci(parent.fenAfter, rawUci);
        const result = stageLine(chapter.tree, staged, parent.id, [{ uci, san, fenAfter }])!;
        const added = result.staged.length > staged.length;
        set({ selectedNodeId: result.nodeId, ...(added ? { staged: result.staged } : {}) });
        return { nodeId: result.nodeId, staged: added };
      },

      playLine: (fromNodeId, rawUcis) => {
        const { chapter, staged } = get();
        const start = chapter
          ? treeWithStaged(chapter.tree, staged).find((node) => node.id === fromNodeId)
          : undefined;
        if (!chapter || !start || !rawUcis.length) return null;
        // Castling as the king's two-square move (as the chapter stores it), checked move by move:
        // an illegal move stages none of the line.
        const moves: Array<{ uci: string; san: string; fenAfter: string }> = [];
        let fen = start.fenAfter;
        for (const raw of rawUcis) {
          const uci = standardCastlingUci(fen, raw);
          const played = playUcis(fen, [uci]);
          if (!played) return null;
          moves.push(played[0]);
          fen = played[0].fenAfter;
        }
        const result = stageLine(chapter.tree, staged, start.id, moves);
        if (!result) return null;
        const added = result.staged.length > staged.length;
        set({ selectedNodeId: result.nodeId, ...(added ? { staged: result.staged } : {}) });
        return { nodeId: result.nodeId, staged: added };
      },

      dropStaged: (nodeId) => {
        const { staged, selectedNodeId, chapter } = get();
        const target = staged.find((node) => node.id === nodeId);
        if (!target || !chapter) return;
        const next = dropStaged(staged, nodeId);
        const shown = treeWithStaged(chapter.tree, next);
        set({
          staged: next,
          selectedNodeId: shown.some((node) => node.id === selectedNodeId)
            ? selectedNodeId
            : (target.parentId ?? REPERTOIRE_ROOT_NODE_ID)
        });
      },

      discardStaged: () => {
        const { staged, selectedNodeId, chapter } = get();
        if (!staged.length) return;
        set({
          staged: [],
          selectedNodeId: chapter
            ? nearestKept(chapter.tree, treeWithStaged(chapter.tree, staged), selectedNodeId)
            : selectedNodeId
        });
      },

      addStaged: ({ studyOnly = false } = {}) => {
        const { chapter, staged, color } = get();
        const count = chapter ? liveStaged(chapter.tree, staged).length : 0;
        if (!count) return 0;
        // The staged moves keep their ids, so the selection stays where it is.
        edit((current) => chapterWithStaged(current, staged, color, { studyOnly }), {
          undoable: true
        });
        set({ staged: [] });
        return count;
      },

      addStagedElsewhere: async (chapterId, open, { studyOnly = false } = {}) => {
        const { chapter, staged, repertoireId } = get();
        if (!chapter || !repertoireId) return false;
        const lines = stagedLines(chapter.tree, staged);
        if (!lines.length) return false;
        if (!(await open())) return false;
        // Still on the chapter they were staged in (the other one loads next): they leave it.
        const now = get();
        if (now.repertoireId === repertoireId && now.chapterId === chapter.id) now.discardStaged();
        set({
          pendingAdd: { repertoireId, chapterId, rootFen: chapter.rootFen, lines, studyOnly }
        });
        return true;
      },

      applyPendingAdd: () => {
        const { pendingAdd, chapter, repertoireId, chapterId, color } = get();
        if (
          !pendingAdd ||
          !chapter ||
          pendingAdd.repertoireId !== repertoireId ||
          pendingAdd.chapterId !== chapterId
        ) {
          return "none";
        }
        set({ pendingAdd: null });
        const added = chapterWithLines(chapter, { ...pendingAdd, color });
        if (!added) return "failed";
        edit(() => added.chapter, { undoable: true, selectedNodeId: added.nodeId });
        return "applied";
      },

      dropPendingAdd: () => {
        if (get().pendingAdd) set({ pendingAdd: null });
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

      makeChapterTrainable: (acceptedAt) => {
        const before = get().chapter;
        edit((chapter) => trainableChapter(get().color, chapter, acceptedAt), { undoable: true });
        if (before && get().undoStack.at(-1) === before) practiceFieldSteps.add(before);
      },

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
          const staged = liveStaged(tree, state.staged);
          const shown = treeWithStaged(tree, staged);
          set({
            chapter: { ...result.chapter, tree },
            staged: staged === state.staged ? state.staged : [...staged],
            dirty: false,
            baseRevision,
            saveState: { status: "idle" },
            selectedNodeId: shown.some((node) => node.id === state.selectedNodeId)
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
              nextDecisionDraft(draft, { type: "retry" }).draft!
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
          if (!Object.hasOwn(state.decisionDrafts, key)) return {};
          const decisionDrafts = { ...state.decisionDrafts };
          delete decisionDrafts[key];
          return { decisionDrafts };
        }),

      requestDecisionTextSaveAgain: (key) => {
        if (Object.hasOwn(get().decisionDrafts, key)) transitionDraft(key, { type: "commit" });
      },

      updateDecisionDraft: (key, event) =>
        Object.hasOwn(get().decisionDrafts, key) ? transitionDraft(key, event) : false
    };
  }
);

/** The decision change waiting under `key`: none once it is saved or dropped. */
export function pendingDecisionDraft(key: string): DecisionTextDraft | undefined {
  return useRepertoireWorkspaceStore.getState().decisionDrafts[key];
}

/**
 * Before leaving Study (or its chapter): staged moves are never saved, so leaving with some asks
 * first ("Discard 2 unsaved moves?"). True to go on (none staged, or the user agreed); false to
 * stay. It drops nothing itself: the moves go once the screen actually changes (the next chapter's
 * load, Study's page closing), so a navigation that doesn't happen (a save that failed, a Lichess
 * game in progress) keeps them.
 */
export function confirmLeavingStaged(): boolean {
  const { staged } = useRepertoireWorkspaceStore.getState();
  if (!staged.length) return true;
  const moves = staged.length === 1 ? "1 unsaved move" : `${staged.length} unsaved moves`;
  return window.confirm(`Discard ${moves}?`);
}

/**
 * The selected node when it is the chapter's, else its nearest ancestor that is (a staged move
 * isn't saved, so a history entry never names one).
 */
export function selectedChapterNodeId(state: RepertoireWorkspaceState): string {
  const { chapter, staged, selectedNodeId } = state;
  if (!chapter) return selectedNodeId;
  return nearestKept(chapter.tree, treeWithStaged(chapter.tree, staged), selectedNodeId);
}
