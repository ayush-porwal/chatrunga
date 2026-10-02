import {
  collectDecisions,
  effectivePreferredUci,
  nodeMetaOf,
  type ChapterLookup
} from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { BoardArrow, BoardHighlight, Square } from "@chaturanga/shared/types/chess";
import type {
  PracticeCard,
  PracticeSummary,
  PracticeTotals,
  RepertoireChapter,
  RepertoireColor,
  RepertoireDecision,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";

/*
 * Pure view logic for the repertoire study and practice screens: the choices panel, boundary
 * effects, transpositions, move labels, autosave decisions and practice progress. No React, no
 * store, so it is unit-tested directly.
 */

/* ------------------------------------------------------------------ choices panel */

/** How one continuation counts, as the choices panel names it (text, never colour alone). */
export type ChoiceState = "preferred" | "accepted" | "reference" | "covered";

export type ChoiceRow = {
  nodeId: string;
  uci: string;
  san: string;
  state: ChoiceState;
  disabled: boolean;
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
  covered: "Covered"
};

/**
 * The continuations of `nodeId` with their states. At a player-to-move position an `included`
 * edge is accepted and the effective preference (stored, else the first accepted move, as
 * reconciliation would choose) is preferred; anything else is reference only. At an
 * opponent-to-move position an `included`/`covered` edge is covered.
 */
export function deriveChoices(
  chapter: Pick<RepertoireChapter, "nodeMeta">,
  lookup: ChapterLookup,
  nodeId: string,
  color: RepertoireColor,
  decision: Pick<RepertoireDecision, "acceptedUcis" | "preferredUci"> | null
): ChoicesView {
  const node = lookup.nodesById.get(nodeId);
  if (!node) return { side: "player", rows: [] };
  const side = playerToMove(node.fenAfter) === color ? "player" : "opponent";
  const children = (lookup.childrenById.get(nodeId) ?? [])
    .map((id) => lookup.nodesById.get(id)!)
    .filter((child) => child.uci);
  const metaOf = (id: string) => nodeMetaOf(chapter.nodeMeta, id);

  if (side === "opponent") {
    return {
      side,
      rows: children.map((child) => ({
        nodeId: child.id,
        uci: child.uci!,
        san: child.san ?? child.uci!,
        state: metaOf(child.id).edge === "reference" ? "reference" : "covered",
        disabled: Boolean(metaOf(child.id).disabled)
      }))
    };
  }

  const included = children
    .filter((child) => metaOf(child.id).edge === "included")
    .map((child) => child.uci!);
  const supported = new Set(included);
  const preferred =
    (decision ? effectivePreferredUci(decision, supported) : null) ?? included[0] ?? null;
  return {
    side,
    rows: children.map((child) => {
      const accepted = supported.has(child.uci!);
      return {
        nodeId: child.id,
        uci: child.uci!,
        san: child.san ?? child.uci!,
        state: !accepted ? "reference" : child.uci === preferred ? "preferred" : "accepted",
        disabled: Boolean(metaOf(child.id).disabled)
      };
    })
  };
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

/** The main process refused a save because the repertoire moved on (a stale draft). */
export function isStaleRevisionError(message: string): boolean {
  return /expectedRevision|repertoire changed/i.test(message);
}

export type AutosaveSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string; stale: boolean };

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

/** Titlebar text for the save state. */
export function saveStatusLabel(state: { dirty: boolean; saveState: AutosaveSaveState }): string {
  if (state.saveState.status === "saving") return "Saving…";
  if (state.saveState.status === "error") return `Unsaved — ${state.saveState.message}`;
  return state.dirty ? "Unsaved changes" : "Saved";
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
  const squares = lastMoveOf(preferredUci);
  if (!squares || stage < 2) return { arrows: [], highlights: [] };
  const [from, to] = squares as [Square, Square];
  if (stage === 2) return { arrows: [], highlights: [{ square: from, color: "green" }] };
  return { arrows: [{ orig: from, dest: to, color: "green" }], highlights: [] };
}

/** Arrows for revealed moves (preferred in green, other accepted moves in blue). */
export function revealArrows(ucis: readonly string[], preferredUci: string | null): BoardArrow[] {
  return ucis.flatMap((uci) => {
    const squares = lastMoveOf(uci);
    if (!squares) return [];
    const [orig, dest] = squares as [Square, Square];
    return [{ orig, dest, color: uci === preferredUci ? "green" : "blue" } as BoardArrow];
  });
}

/** Where "Study missed positions" opens: the first missed card's chapter and node, when known. */
export function firstMissedTarget(
  summary: Pick<PracticeSummary, "missedPositionKeys">,
  cards: readonly Pick<PracticeCard, "positionKey" | "chapterId" | "nodeId">[]
): { chapterId: string; nodeId: string } | null {
  for (const key of summary.missedPositionKeys) {
    const card = cards.find((item) => item.positionKey === key);
    if (card) return { chapterId: card.chapterId, nodeId: card.nodeId };
  }
  return null;
}

/**
 * The preview node an import report's path names (`1. e4 e5 2. Nf3`: the parent of an illegal
 * move), so "Exclude line" can drop the incomplete line that led to it. Null for the root.
 */
export function nodeIdForPathLabel(lookup: ChapterLookup, label: string): string | null {
  if (!label.trim()) return null;
  return lookup.order.find((id) => id !== "root" && pathLabel(lookup, id) === label) ?? null;
}
