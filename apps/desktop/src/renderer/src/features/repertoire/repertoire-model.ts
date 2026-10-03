import {
  collectDecisions,
  computeScopeStates,
  effectivePreferredUci,
  nodeMetaOf,
  type ChapterLookup,
  type ScopeState
} from "@chaturanga/shared/chess/repertoire-index";
import { applyUserMove } from "@chaturanga/shared/chess/position";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { BoardArrow, BoardHighlight, Square } from "@chaturanga/shared/types/chess";
import type {
  PracticeCard,
  PracticeSummary,
  PracticeTotals,
  RepertoireChapter,
  RepertoireColor,
  RepertoireDecision,
  RepertoireNodeMeta,
  RepertoireOccurrence
} from "@chaturanga/shared/types/repertoire";

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
  untrained: "Not trained here"
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

/** The main process refused a save because the repertoire or chapter moved on (a stale draft). */
export function isStaleRevisionError(message: string): boolean {
  return /expectedRevision|chapter\.revision|(repertoire|chapter) changed/i.test(message);
}

/** The main process can't find the repertoire (deleted): the draft has nowhere to go. */
export function isMissingTargetError(message: string): boolean {
  return /not found|no longer exists/i.test(message);
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
    const moved = applyUserMove(fen, {
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
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
