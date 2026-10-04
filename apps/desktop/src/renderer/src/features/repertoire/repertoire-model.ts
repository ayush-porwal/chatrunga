import {
  collectDecisions,
  computeScopeStates,
  effectivePreferredUci,
  nodeMetaOf,
  type ChapterLookup,
  type ScopeState
} from "@chaturanga/shared/chess/repertoire-index";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { applyUserMove, positionFromFen } from "@chaturanga/shared/chess/position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { BoardArrow, BoardHighlight } from "@chaturanga/shared/types/chess";
import {
  CHAPTER_NOT_FOUND_ERROR,
  POSITION_NOT_FOUND_ERROR,
  REPERTOIRE_NOT_FOUND_ERROR,
  type PracticeAnswer,
  type PracticeCard,
  type PracticeLeadUpMove,
  type PracticeSummary,
  type PracticeTotals,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireDecision,
  type RepertoireNodeMeta,
  type RepertoireOccurrence,
  type UpdateDecisionInput
} from "@chaturanga/shared/types/repertoire";
import { uciSquares } from "@chaturanga/shared/chess/square";

/*
 * Pure view logic for the repertoire study and practice screens: the choices panel, boundary
 * effects, transpositions, move labels, autosave decisions and practice progress. No React, no
 * store, so it is unit-tested directly.
 */

/* ------------------------------------------------------------------ choices panel */

/** How one continuation counts, as the choices panel names it (text, never colour alone). */
export type ChoiceState = "preferred" | "accepted" | "reference" | "covered" | "untrained";

export type ChoiceRow = {
  nodeId: string;
  uci: string;
  san: string;
  state: ChoiceState;
  disabled: boolean;
  /** The move's own edge kind (what the edge toggles change), whatever its training scope. */
  edge: RepertoireNodeMeta["edge"];
};

export type ChoicesView = {
  /** Whose move it is at the position: the repertoire player's, or the opponent's. */
  side: "player" | "opponent";
  rows: ChoiceRow[];
};

export const CHOICE_LABELS: Record<ChoiceState, string> = {
  preferred: "Preferred",
  accepted: "Accepted",
  reference: "Reference only",
  covered: "Covered",
  untrained: "Not practised"
};

/** What each state means for practice (the badge's description). */
export const CHOICE_DESCRIPTIONS: Record<ChoiceState, string> = {
  preferred: "Correct in practice, and the move hints point at.",
  accepted: "Also correct in practice.",
  reference: "Kept for study only: practice doesn't count it as correct. Accept it to practise it.",
  covered: "A reply you prepare for: practice plays it to you and goes on from there.",
  untrained: "This position isn't practised, so the move isn't asked or played in practice."
};

/**
 * The continuations of `nodeId` with their states. At a player-to-move position an `included`
 * edge is accepted and the effective preference (stored, else the first accepted move, as
 * reconciliation would choose) is preferred; anything else is reference only. At an
 * opponent-to-move position an `included`/`covered` edge is covered.
 *
 * Moves outside training scope (a reference or disabled chapter, before a start marker, after a
 * stop, under a reference or disabled branch) are "untrained": accepting or preferring them can't
 * make a decision, so the panel offers neither.
 */
export function deriveChoices(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">,
  lookup: ChapterLookup,
  nodeId: string,
  color: RepertoireColor,
  decision: Pick<RepertoireDecision, "acceptedUcis" | "preferredUci"> | null,
  scopes: ReadonlyMap<string, ScopeState> = computeScopeStates(chapter, lookup)
): ChoicesView {
  const node = lookup.nodesById.get(nodeId);
  if (!node) return { side: "player", rows: [] };
  const side = playerToMove(node.fenAfter) === color ? "player" : "opponent";
  const children = (lookup.childrenById.get(nodeId) ?? [])
    .map((id) => lookup.nodesById.get(id)!)
    .filter((child) => child.uci);
  const metaOf = (id: string) => nodeMetaOf(chapter.nodeMeta, id);
  // Both the position and the move must be in scope (collectDecisions); a move whose own edge is
  // reference under an active position is still a plain reference choice (Accept makes it train).
  const parentActive = scopes.get(nodeId) === "active";
  const trained = (id: string) => {
    const state = scopes.get(id);
    return parentActive && (state === "active" || state === "reference");
  };
  const base = (child: (typeof children)[number]) => ({
    nodeId: child.id,
    uci: child.uci!,
    san: child.san ?? child.uci!,
    disabled: Boolean(metaOf(child.id).disabled),
    edge: metaOf(child.id).edge
  });

  if (side === "opponent") {
    return {
      side,
      rows: children.map((child) => ({
        ...base(child),
        state: !trained(child.id)
          ? "untrained"
          : metaOf(child.id).edge === "reference"
            ? "reference"
            : "covered"
      }))
    };
  }

  const included = children
    .filter((child) => trained(child.id) && metaOf(child.id).edge === "included")
    .map((child) => child.uci!);
  const supported = new Set(included);
  const stored = decision?.preferredUci ?? null;
  // The preference is repertoire-wide: one stored for a move this occurrence doesn't have (it's
  // played at another chapter or route reaching this position) marks nothing here preferred,
  // instead of naming a local move that hints don't point at.
  const preferredElsewhere = Boolean(
    stored &&
    decision!.acceptedUcis.includes(stored) &&
    !children.some((child) => child.uci === stored)
  );
  const preferred = preferredElsewhere
    ? null
    : ((decision ? effectivePreferredUci(decision, supported) : null) ?? included[0] ?? null);
  return {
    side,
    rows: children.map((child) => {
      const accepted = supported.has(child.uci!);
      return {
        ...base(child),
        state: !trained(child.id)
          ? "untrained"
          : !accepted
            ? "reference"
            : child.uci === preferred
              ? "preferred"
              : "accepted"
      };
    })
  };
}

/** A button of a choice row: what it does to the move, and how prominent it is. */
export type ChoiceAction = {
  kind: "accept" | "prefer" | "make-reference" | "cover";
  variant: "outline" | "ghost";
};

/**
 * The actions a choice row offers. A move outside training scope can only be kept as reference
 * (or covered again, at the opponent's turn): accepting or preferring it can't make a decision.
 * In scope, the player's reference move can be accepted, any accepted move preferred, and a
 * trained move made reference; an opponent's reply toggles between covered and reference.
 */
export function choiceActions(
  row: Pick<ChoiceRow, "state" | "edge">,
  side: ChoicesView["side"]
): ChoiceAction[] {
  if (row.state === "untrained") {
    if (side === "player") {
      return row.edge === "reference" ? [] : [{ kind: "make-reference", variant: "ghost" }];
    }
    return [{ kind: row.edge === "reference" ? "cover" : "make-reference", variant: "ghost" }];
  }
  if (side === "opponent") {
    return row.state === "covered"
      ? [{ kind: "make-reference", variant: "ghost" }]
      : [{ kind: "cover", variant: "outline" }];
  }
  const actions: ChoiceAction[] = [];
  if (row.state === "reference") actions.push({ kind: "accept", variant: "outline" });
  if (row.state !== "preferred") actions.push({ kind: "prefer", variant: "outline" });
  if (row.state !== "reference") actions.push({ kind: "make-reference", variant: "ghost" });
  return actions;
}

/** Default edge of a move added while studying (§5.2): own moves reference, replies covered. */
export function defaultEdgeForNewMove(
  fenBefore: string,
  color: RepertoireColor
): RepertoireNodeMeta["edge"] {
  return playerToMove(fenBefore) === color ? "reference" : "covered";
}

/* ------------------------------------------------------------------ boundaries */

type CountableChapter = Pick<
  RepertoireChapter,
  "id" | "kind" | "enabled" | "sortOrder" | "tree" | "nodeMeta"
>;

/** Unique trainable decisions this chapter supports on its own. */
export function trainableDecisionCount(color: RepertoireColor, chapter: CountableChapter): number {
  return collectDecisions(color, [chapter]).size;
}

/** The chapter's trainable decision count if `nodeId`'s metadata were patched. */
export function decisionCountWithMeta(
  color: RepertoireColor,
  chapter: CountableChapter,
  nodeId: string,
  patch: Partial<RepertoireNodeMeta>
): number {
  const meta = { ...nodeMetaOf(chapter.nodeMeta, nodeId), ...patch };
  return trainableDecisionCount(color, {
    ...chapter,
    nodeMeta: { ...chapter.nodeMeta, [nodeId]: meta }
  });
}

/** "+2 decisions" / "−1 decision" / "no change", for a boundary toggle's effect. */
export function decisionDeltaLabel(delta: number): string {
  if (delta === 0) return "no change";
  const count = Math.abs(delta);
  return `${delta > 0 ? "+" : "−"}${count} decision${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ positions and labels */

/** Other nodes of the chapter that reach the same position as `nodeId` (transpositions). */
export function transpositionsOf(lookup: ChapterLookup, nodeId: string): string[] {
  const key = lookup.positionKeys.get(nodeId);
  if (!key) return [];
  return lookup.order.filter((id) => id !== nodeId && lookup.positionKeys.get(id) === key);
}

/**
 * Stored occurrences of a position outside the open chapter (its own ones come from the draft,
 * which may be ahead of what is saved), in chapter then ply order, one per chapter node.
 */
export function occurrencesInOtherChapters(
  occurrences: readonly RepertoireOccurrence[],
  chapterId: string
): RepertoireOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((occurrence) => {
    const key = `${occurrence.chapterId}:${occurrence.nodeId}`;
    if (occurrence.chapterId === chapterId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Fullmove number and side to move of a FEN (defaults: move 1, White). */
function moveNumberOf(fen: string): { fullmove: number; white: boolean } {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Number.parseInt(fields[5] ?? "1", 10);
  return {
    fullmove: Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1,
    white: fields[1] !== "b"
  };
}

/** SAN with its move number as it reads at the start of a line: `3. Bc4` / `3... Bc5`. */
export function numberedSan(fenBefore: string, san: string, first: boolean): string {
  const { fullmove, white } = moveNumberOf(fenBefore);
  if (white) return `${fullmove}. ${san}`;
  return first ? `${fullmove}... ${san}` : san;
}

/** The moves from the chapter root to `nodeId`, numbered: `1. e4 c5 2. Nf3`. "Start" at the root. */
export function pathLabel(lookup: ChapterLookup, nodeId: string): string {
  const path = (lookup.parentPath.get(nodeId) ?? []).slice(1);
  if (!path.length) return "Start";
  return path
    .map((id, index) => {
      const node = lookup.nodesById.get(id)!;
      return numberedSan(node.fenBefore, node.san ?? node.uci ?? "?", index === 0);
    })
    .join(" ");
}

/** The last move into `nodeId` as from/to squares, for the board's highlight. */
export function lastMoveOf(uci: string | null | undefined): readonly [string, string] | null {
  return uci && uci.length >= 4 ? [uci.slice(0, 2), uci.slice(2, 4)] : null;
}

/* ------------------------------------------------------------------ autosave */

/** Whether a finished save may replace the draft: only when nothing was edited while it ran. */
export function shouldAdoptSaveResult(
  generationAtSave: number,
  currentGeneration: number
): boolean {
  return generationAtSave === currentGeneration;
}

/**
 * The main process refused a write because the repertoire or the chapter moved on since it was
 * read (a stale draft): "Invalid expectedRevision: repertoire changed (stored 5, expected 4)" or
 * "Invalid chapter.revision: chapter changed (…)". A revision refused for any other reason (missing,
 * malformed, a replace that needs one) isn't stale: reloading wouldn't fix it.
 */
export function isStaleRevisionError(message: string): boolean {
  return /^Invalid (?:expectedRevision: repertoire|chapter\.revision: chapter) changed\b/.test(message);
}

/** The main process can't find the repertoire (deleted): the draft has nowhere to go. */
export function isMissingTargetError(message: string): boolean {
  return /not found|no longer exists/i.test(message);
}

/**
 * The repertoire (or the chapter) was deleted, or a decision's position is in none of its
 * chapters any more: the main process's not-found error for that id (`message` as ipcErrorMessage
 * leaves it). Any other read failure is worth a retry.
 */
export function isNotFoundError(
  message: string,
  target: "repertoire" | "chapter" | "position"
): boolean {
  return message.startsWith(
    target === "repertoire"
      ? REPERTOIRE_NOT_FOUND_ERROR
      : target === "chapter"
        ? CHAPTER_NOT_FOUND_ERROR
        : POSITION_NOT_FOUND_ERROR
  );
}

/** A decision change whose position left the repertoire (its move undone or line deleted). */
export const POSITION_GONE_MESSAGE = "This position is no longer in the repertoire.";

export type AutosaveSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string; stale: boolean };

export type DecisionTextField = "prompt" | "hint";

/** The longest prompt, hint or feedback a decision write accepts (the main process's limit). */
export const MAX_DECISION_TEXT_LENGTH = 2_000;

/** How the scope of the repertoire-wide decision fields is described in Study. */
export const DECISION_SCOPE_TEXT =
  "Repertoire-wide: applies wherever this position occurs, in every chapter and transposition.";

/**
 * What a decision draft changes at a position: the prompt or hint, the feedback for one wrong
 * move (the draft's `uci`), or whether the decision is paused.
 */
export type DecisionDraftField = DecisionTextField | "feedback" | "paused";

/** Why a decision draft's last write (or Keep mine's read) was refused. */
export type DecisionDraftError = {
  message: string;
  /** The repertoire moved on: Keep mine or Discard decides (Retry would be refused again). */
  stale: boolean;
  /**
   * Its position is in no chapter any more (its move undone, its line deleted): every flush tries
   * it again (it saves once the move is back), and it holds back no navigation meanwhile.
   */
  missing?: boolean;
};

/** What a decision draft changes, as typed or toggled. */
export type DecisionDraftChange = {
  repertoireId: string;
  positionKey: string;
  field: DecisionDraftField;
  /** The wrong move (UCI) a feedback draft explains. */
  uci?: string;
  /** The prompt, hint or feedback as typed (sent trimmed; blank clears it). Unused for a pause. */
  text: string;
  /** Whether a pause draft pauses (true) or resumes (false) the decision. */
  paused?: boolean;
};

/**
 * A decision change made at a position (a practice prompt or hint, wrong-move feedback, pausing)
 * and not yet confirmed saved. It outlives the notes panel (and the study page), so a failed
 * write keeps the change until it is retried or discarded. Its state moves only through
 * nextDecisionDraft: pending (waiting for a write), saving (a write is running; `saveAgain` when
 * it was committed again meanwhile) or error (the refusal, until Retry, Keep mine or Discard).
 */
export type DecisionTextDraft = DecisionDraftChange & {
  /** Counts edits: a save clears the draft only when nothing was typed while it ran. */
  generation: number;
} & (
    | { status: "pending"; error?: undefined; saveAgain?: undefined }
    | {
        status: "saving";
        error?: undefined;
        /**
         * Committed again (a blur, Add, Remove or the pause switch) while the write ran: written
         * again once it settles, with whatever was typed meanwhile.
         */
        saveAgain?: boolean;
      }
    | { status: "error"; error: DecisionDraftError; saveAgain?: undefined }
  );

/** What happens to a decision draft (see nextDecisionDraft). */
export type DecisionDraftEvent =
  /** Typed or toggled: creates the draft, or edits it (a new generation; its state stays). */
  | { type: "edit"; change: DecisionDraftChange }
  /** A write of it started. */
  | { type: "saving" }
  /** Committed again: while a write runs, it is written again once that write settles. */
  | { type: "commit" }
  /** The write of `generation` was confirmed. */
  | { type: "saved"; generation: number }
  | { type: "failed"; error: DecisionDraftError }
  /** Retry (a failure that isn't stale), or Keep mine (`stale`: any failure): pending again. */
  | { type: "retry"; stale?: boolean };

/**
 * The one state machine of a decision draft: the draft after `event` (null: it is gone, saved as
 * typed), and whether it must be written again now (committed while a write ran that has just
 * settled; never after a stale refusal, which waits for Keep mine or Discard).
 */
export function nextDecisionDraft(
  draft: DecisionTextDraft | undefined,
  event: DecisionDraftEvent
): { draft: DecisionTextDraft | null; writeAgain: boolean } {
  const unchanged = { draft: draft ?? null, writeAgain: false };
  if (event.type === "edit") {
    // The key names the field and move, so an edit's change replaces the draft's as a whole.
    const content = contentOf({ ...event.change, generation: (draft?.generation ?? 0) + 1 });
    return {
      draft: draft ? { ...draft, ...content } : { ...content, status: "pending" },
      writeAgain: false
    };
  }
  if (!draft) return unchanged;
  const content = contentOf(draft);
  switch (event.type) {
    case "saving":
      return { draft: { ...content, status: "saving" }, writeAgain: false };
    case "commit":
      return draft.status === "saving"
        ? { draft: { ...draft, saveAgain: true }, writeAgain: false }
        : unchanged;
    case "saved": {
      const writeAgain = draft.status === "saving" && draft.saveAgain === true;
      // Typed while it saved: the newer text stays, pending its own write.
      if (draft.generation !== event.generation) {
        return { draft: { ...content, status: "pending" }, writeAgain };
      }
      return { draft: null, writeAgain: false };
    }
    case "failed":
      return {
        draft: { ...content, status: "error", error: event.error },
        writeAgain: draft.status === "saving" && draft.saveAgain === true && !event.error.stale
      };
    case "retry":
      return draft.status === "error" && (event.stale || !draft.error.stale)
        ? { draft: { ...content, status: "pending" }, writeAgain: false }
        : unchanged;
  }
}

/** A draft's change and generation, without its state (an unset `uci` or `paused` left out). */
function contentOf(
  draft: DecisionDraftChange & { generation: number }
): DecisionDraftChange & { generation: number } {
  return {
    repertoireId: draft.repertoireId,
    positionKey: draft.positionKey,
    field: draft.field,
    text: draft.text,
    generation: draft.generation,
    ...(draft.uci !== undefined ? { uci: draft.uci } : {}),
    ...(draft.paused !== undefined ? { paused: draft.paused } : {})
  };
}

/**
 * Whether a write of the draft goes ahead: a pending one, or a failed one on Retry (`retry`)
 * unless the refusal was stale. One whose position left the repertoire is always tried again
 * (it saves once the move is back).
 */
export function decisionDraftWritable(draft: DecisionTextDraft, retry: boolean): boolean {
  if (draft.status !== "error") return true;
  return draft.error.missing === true || (retry && !draft.error.stale);
}

/** Whether the draft holds back leaving its repertoire (all but one whose position left it). */
export function decisionDraftHoldsBack(draft: DecisionTextDraft): boolean {
  return draft.status !== "error" || draft.error.missing !== true;
}

/**
 * What a refused decision write (or Keep mine's read of the repertoire) means for its draft, from
 * the main process's message: the repertoire was deleted (`"repertoire-gone"`: none of its drafts
 * has anywhere to go), or the draft's error (its position left the repertoire, a stale revision,
 * or another failure worth a Retry). `stale` forces a stale error (Keep mine's refused read).
 */
export function decisionWriteFailure(
  message: string,
  { stale = false }: { stale?: boolean } = {}
): "repertoire-gone" | DecisionDraftError {
  if (isNotFoundError(message, "repertoire")) return "repertoire-gone";
  if (isNotFoundError(message, "position")) {
    return { message: POSITION_GONE_MESSAGE, stale: false, missing: true };
  }
  return { message, stale: stale || isStaleRevisionError(message) };
}

/**
 * Where a decision draft lives in the workspace store (one per repertoire, position and field,
 * and per wrong move for feedback).
 */
export function decisionDraftKey(
  repertoireId: string,
  positionKey: string,
  field: DecisionDraftField,
  uci?: string
): string {
  return JSON.stringify(
    uci === undefined ? [repertoireId, positionKey, field] : [repertoireId, positionKey, field, uci]
  );
}

/** What a prompt, hint or feedback write sends: trimmed, or null for a blank field. */
export function decisionTextValue(text: string): string | null {
  return text.trim() ? text.trim() : null;
}

/**
 * The decision write a draft makes. Feedback is stored as one map per position, so its write
 * sends the stored map (`stored`, read just before) with this move's text set, or removed when
 * the text is blank; feedback for other moves stays as stored.
 */
export function decisionDraftPatch(
  draft: DecisionTextDraft,
  stored: Pick<RepertoireDecision, "wrongMoveFeedback"> | null
): UpdateDecisionInput["patch"] {
  if (draft.field === "paused") return { paused: draft.paused === true };
  if (draft.field === "feedback") {
    const wrongMoveFeedback = { ...stored?.wrongMoveFeedback };
    const text = decisionTextValue(draft.text);
    if (text) wrongMoveFeedback[draft.uci!] = text;
    else delete wrongMoveFeedback[draft.uci!];
    return { wrongMoveFeedback };
  }
  return { [draft.field]: decisionTextValue(draft.text) };
}

/** The draft holds what the decision already stores (it can be dropped without a write). */
export function decisionDraftMatches(
  draft: DecisionTextDraft,
  decision: Pick<RepertoireDecision, DecisionTextField | "wrongMoveFeedback" | "paused"> | null
): boolean {
  if (draft.field === "paused") return draft.paused === (decision?.paused ?? false);
  const stored =
    draft.field === "feedback"
      ? (decision?.wrongMoveFeedback[draft.uci!] ?? null)
      : (decision?.[draft.field] ?? null);
  return decisionTextValue(draft.text) === stored;
}

/** A legal move at a position, as wrong-move feedback lists it. */
export type MoveOption = { uci: string; san: string };

/**
 * The legal moves at `fen` other than `excluded` (the accepted moves, and moves that already have
 * feedback), by SAN: what "Add feedback" offers. Castling is listed king-two-squares, as the main
 * process stores it; a promotion is listed once per piece.
 */
export function wrongMoveOptions(fen: string, excluded: ReadonlySet<string>): MoveOption[] {
  let position: ReturnType<typeof positionFromFen>;
  try {
    position = positionFromFen(fen);
  } catch {
    return [];
  }
  const options = new Map<string, MoveOption>();
  for (const [from, dests] of position.allDests()) {
    for (const to of dests) {
      const promotes =
        position.board.get(from)?.role === "pawn" && (to >> 3 === 0 || to >> 3 === 7);
      for (const promotion of promotes
        ? (["queen", "rook", "bishop", "knight"] as const)
        : [undefined]) {
        const move = { from, to, ...(promotion ? { promotion } : {}) };
        const uci = standardCastlingUci(fen, makeUci(move));
        if (excluded.has(uci) || options.has(uci)) continue;
        options.set(uci, { uci, san: makeSan(position, move) });
      }
    }
  }
  return [...options.values()].sort((a, b) => a.san.localeCompare(b.san));
}

/** How notices name a draft's change ("the hint", "the feedback for d4"…). */
export function decisionDraftName(draft: DecisionTextDraft, moveLabel?: string): string {
  switch (draft.field) {
    case "prompt":
      return "practice prompt";
    case "hint":
      return "hint";
    case "feedback":
      return `feedback for ${moveLabel ?? draft.uci}`;
    case "paused":
      return draft.paused ? "pause" : "resume";
  }
}

/** The decision drafts of one repertoire, as the save status needs them (flat, so selectable). */
export type DecisionTextStatus = {
  dirty: boolean;
  saving: boolean;
  /** The first failed write's message, or null. */
  errorMessage: string | null;
  /** Every failed write is a stale refusal (Retry would only be refused again). */
  errorStale: boolean;
  /**
   * Whether its drafts hold back leaving the repertoire (decisionDraftHoldsBack), and how:
   * `stale` when every failure among them was refused as stale (only Keep mine or Discard helps).
   */
  holdsBack: "unsaved" | "stale" | null;
};

export function decisionTextStatus(
  drafts: Readonly<Record<string, DecisionTextDraft>>,
  repertoireId: string | null
): DecisionTextStatus {
  const own = Object.values(drafts).filter((draft) => draft.repertoireId === repertoireId);
  const failed = own.filter((draft) => draft.status === "error");
  const holding = own.filter(decisionDraftHoldsBack);
  const holdingFailed = holding.filter((draft) => draft.status === "error");
  return {
    dirty: own.length > 0,
    saving: own.some((draft) => draft.status === "saving"),
    errorMessage: failed[0]?.error.message ?? null,
    errorStale: failed.length > 0 && failed.every((draft) => draft.error.stale),
    holdsBack: !holding.length
      ? null
      : holdingFailed.length && holdingFailed.every((draft) => draft.error.stale)
        ? "stale"
        : "unsaved"
  };
}

/**
 * What the autosave loop does now: `schedule` a debounced save, `wait` for the running one,
 * stay `blocked` on an error until the user retries (a stale draft must never save over newer
 * content on its own), or nothing (`idle`).
 */
export function autosaveStep(state: {
  dirty: boolean;
  saveState: AutosaveSaveState;
}): "idle" | "schedule" | "wait" | "blocked" {
  if (state.saveState.status === "saving") return "wait";
  if (state.saveState.status === "error") return "blocked";
  return state.dirty ? "schedule" : "idle";
}

/**
 * Titlebar text for the save state: the chapter draft's, and the prompt and hint writes at its
 * positions (never "Saved" while one of them is pending or failed).
 */
export function saveStatusLabel(state: {
  dirty: boolean;
  saveState: AutosaveSaveState;
  decisionText?: Pick<DecisionTextStatus, "dirty" | "saving" | "errorMessage">;
}): string {
  const decisionText = state.decisionText;
  if (state.saveState.status === "error") return `Unsaved — ${state.saveState.message}`;
  if (decisionText?.errorMessage) return `Unsaved — ${decisionText.errorMessage}`;
  if (state.saveState.status === "saving" || decisionText?.saving) return "Saving…";
  return state.dirty || decisionText?.dirty ? "Unsaved changes" : "Saved";
}

/* ------------------------------------------------------------------ practice */

/** Totals recomputed from the cards (the server's totals are a snapshot of session start). */
export function totalsOf(cards: readonly PracticeCard[]): PracticeTotals {
  const count = (state: PracticeCard["state"]) =>
    cards.filter((card) => card.state === state).length;
  const correct = count("answered-correct");
  const wrong = count("answered-wrong");
  const revealed = count("revealed");
  const skipped = count("skipped");
  const answered = correct + wrong + revealed + skipped;
  return {
    total: cards.length,
    answered,
    correct,
    wrong,
    revealed,
    skipped,
    remaining: cards.length - answered
  };
}

/** A card whose grade is final (nothing more to submit on it). */
export function isCardFinished(card: Pick<PracticeCard, "state">): boolean {
  return card.state !== "unanswered";
}

/** The next unanswered card after `from` (wrapping to earlier ones), or -1 when all are done. */
export function nextUnansweredIndex(cards: readonly PracticeCard[], from: number): number {
  for (let offset = 1; offset <= cards.length; offset += 1) {
    const index = (from + offset) % cards.length;
    if (!isCardFinished(cards[index])) return index;
  }
  return -1;
}

/** Board marks for a hint stage: the piece's square at stage 2, the move's arrow at stage 3. */
export function hintMarks(
  stage: number,
  preferredUci: string | null
): { arrows: BoardArrow[]; highlights: BoardHighlight[] } {
  const squares = preferredUci ? uciSquares(preferredUci) : null;
  if (!squares || stage < 2) return { arrows: [], highlights: [] };
  const [from, to] = squares;
  if (stage === 2) return { arrows: [], highlights: [{ square: from, color: "green" }] };
  return { arrows: [{ orig: from, dest: to, color: "green" }], highlights: [] };
}

/** Arrows for revealed moves (preferred in green, other accepted moves in blue). */
export function revealArrows(ucis: readonly string[], preferredUci: string | null): BoardArrow[] {
  return ucis.flatMap((uci) => {
    const squares = uciSquares(uci);
    if (!squares) return [];
    const [orig, dest] = squares;
    return [{ orig, dest, color: uci === preferredUci ? "green" : "blue" } as BoardArrow];
  });
}

/** A missed decision as the summary lists it: where to study it and the moves that lead there. */
export type MissedPosition = {
  positionKey: string;
  chapterId: string;
  nodeId: string;
  /** The authored moves from the chapter start, numbered (`1. e4 e5 2. Nf3`), or "Start". */
  path: string;
};

/** Every missed decision of a session the session's cards can place, in the summary's order. */
export function missedPositions(
  summary: Pick<PracticeSummary, "missedPositionKeys">,
  cards: readonly Pick<PracticeCard, "positionKey" | "chapterId" | "nodeId" | "leadUp">[]
): MissedPosition[] {
  return summary.missedPositionKeys.flatMap((positionKey) => {
    const card = cards.find((item) => item.positionKey === positionKey);
    return card
      ? [
          {
            positionKey,
            chapterId: card.chapterId,
            nodeId: card.nodeId,
            path: leadUpLabel(card.leadUp)
          }
        ]
      : [];
  });
}

/**
 * A card's lead-up as numbered moves (`1. e4 c5 2. Nf3`, `3... Nc6` when Black moved first); "Start"
 * when the decision is at the chapter start. Numbers come from each move's resulting position.
 */
export function leadUpLabel(leadUp: readonly Pick<PracticeLeadUpMove, "san" | "fen">[]): string {
  if (!leadUp.length) return "Start";
  return leadUp
    .map((move, index) => {
      const after = moveNumberOf(move.fen);
      // White to move after it: Black just moved, in the move numbered one lower.
      if (!after.white) return `${after.fullmove}. ${move.san}`;
      return index === 0 ? `${Math.max(1, after.fullmove - 1)}... ${move.san}` : move.san;
    })
    .join(" ");
}

/**
 * The preview node an import report's path names (`1. e4 e5 2. Nf3`: the parent of an illegal
 * move), so "Exclude line" can drop the incomplete line that led to it. Null for the root.
 */
export function nodeIdForPathLabel(lookup: ChapterLookup, label: string): string | null {
  if (!label.trim()) return null;
  return lookup.order.find((id) => id !== "root" && pathLabel(lookup, id) === label) ?? null;
}

/* ------------------------------------------------------------------ practice text */

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king"
};

/** The piece standing on `square` in `fen` ("knight"), or null. */
export function pieceNameAt(fen: string, square: string): string | null {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  if (file < 0 || file > 7 || !(rank >= 1 && rank <= 8)) return null;
  const row = fen.trim().split(/\s+/)[0]?.split("/")[8 - rank];
  if (!row) return null;
  let column = 0;
  for (const char of row) {
    if (/\d/.test(char)) column += Number(char);
    else {
      if (column === file) return PIECE_NAMES[char.toLowerCase()] ?? null;
      column += 1;
    }
    if (column > file) return null;
  }
  return null;
}

/** SAN of `uci` in `fen`, or the UCI itself when it isn't legal there. */
export function sanOf(fen: string, uci: string): string {
  try {
    const squares = uciSquares(uci);
    if (!squares) return uci;
    const moved = applyUserMove(fen, {
      from: squares[0],
      to: squares[1],
      ...(uci[4] ? { promotion: PROMOTIONS[uci[4]] } : {})
    });
    return moved?.san ?? uci;
  } catch {
    return uci;
  }
}

const PROMOTIONS: Record<string, "queen" | "rook" | "bishop" | "knight"> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight"
};

/** Words for a reveal (the live region): "Preferred: Nf3 · also accepted: Bc4". */
export function revealText(
  fen: string,
  ucis: readonly string[],
  preferredUci: string | null
): string {
  if (!ucis.length) return "No accepted move was found for this position.";
  const preferred = preferredUci && ucis.includes(preferredUci) ? preferredUci : ucis[0];
  const others = ucis.filter((uci) => uci !== preferred).map((uci) => sanOf(fen, uci));
  return `Preferred: ${sanOf(fen, preferred)}${others.length ? ` · also accepted: ${others.join(", ")}` : ""}`;
}

/** What the answer notes say once a card is decided: the moves, then the authored notes. */
export type AnswerView = {
  /** "You played e4." after a correct answer; the reveal's words otherwise. */
  answer: string;
  /** The other accepted moves after a correct answer ("Also accepted: d4 (preferred), c4"). */
  alternatives: string | null;
  /** The position's explanation (its comment, else the decision's hint). */
  explanation: string | null;
  /** Comments of the accepted moves, preferred first. */
  moveNotes: { uci: string; san: string; text: string }[];
};

/**
 * The answer notes of a decided card. `playedUci` is the accepted move just played (null for a
 * reveal). Only for an answer the main process gave out with the grade, so never before it.
 */
export function answerView(
  fen: string,
  answer: PracticeAnswer,
  playedUci: string | null
): AnswerView {
  const preferred =
    answer.preferredUci && answer.ucis.includes(answer.preferredUci)
      ? answer.preferredUci
      : (answer.ucis[0] ?? null);
  const ordered = preferred
    ? [preferred, ...answer.ucis.filter((uci) => uci !== preferred)]
    : [...answer.ucis];
  const played = playedUci && answer.ucis.includes(playedUci) ? playedUci : null;
  const others = ordered
    .filter((uci) => uci !== played)
    .map((uci) => `${sanOf(fen, uci)}${uci === preferred ? " (preferred)" : ""}`);
  return {
    answer: played
      ? `You played ${sanOf(fen, played)}.`
      : revealText(fen, answer.ucis, answer.preferredUci),
    alternatives: played && others.length ? `Also accepted: ${others.join(", ")}` : null,
    explanation: answer.explanation?.trim() || null,
    moveNotes: ordered.flatMap((uci) => {
      const text = answer.moveComments?.[uci]?.trim();
      return text ? [{ uci, san: sanOf(fen, uci), text }] : [];
    })
  };
}

/** The answer has authored words to read (an explanation or a move's comment). */
export function hasAnswerNotes(answer: PracticeAnswer | null): boolean {
  if (!answer) return false;
  return (
    Boolean(answer.explanation?.trim()) ||
    Object.values(answer.moveComments ?? {}).some((text) => text.trim())
  );
}

/**
 * How long a correct answer stays before the next card comes by itself, or null when the player
 * moves on with Next: auto-advance is off (`delayMs` 0), or the answer has notes to read.
 */
export function autoAdvanceDelay(delayMs: number, answer: PracticeAnswer | null): number | null {
  if (delayMs <= 0 || hasAnswerNotes(answer)) return null;
  return delayMs;
}

/**
 * Whether a key press is practice's "next" (Space or Enter): not while typing, while a dialog or
 * menu owns the keyboard, or on a focused control that Space / Enter already presses (a button,
 * a link, a switch); not with a modifier held, on key repeat, or once something handled it.
 */
export function isPracticeNextKey(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented"
  >,
  { typing, blocked, onControl }: { typing: boolean; blocked: boolean; onControl: boolean }
): boolean {
  if (event.key !== " " && event.key !== "Enter") return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat)
    return false;
  return !event.defaultPrevented && !typing && !blocked && !onControl;
}

/** Words for a board hint: stage 2 "Move the knight", stage 3 "g1 to f3"; null otherwise. */
export function hintStageText(fen: string, stage: number, uci: string | null): string | null {
  if (!uci || uci.length < 4 || stage < 2) return null;
  const from = uci.slice(0, 2);
  if (stage === 2) {
    const piece = pieceNameAt(fen, from);
    return piece ? `Move the ${piece}` : `Move the piece on ${from}`;
  }
  return `${from} to ${uci.slice(2, 4)}`;
}

/**
 * The hint line for a card whose hints were taken before this screen (a resumed session): what
 * the card records, since the hint text and move aren't sent again.
 */
export function resumedHintText(card: Pick<PracticeCard, "hintStage" | "prompt">): string | null {
  if (!card.hintStage) return null;
  const stages = ["", "the written hint", "the piece to move", "the move"][card.hintStage];
  return `${card.prompt ? `${card.prompt} · ` : ""}Hints used earlier: ${stages}.`;
}
