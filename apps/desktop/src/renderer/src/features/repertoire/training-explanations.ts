import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  trainingPicks,
  type AcceptedAt,
  type ScopeCause,
  type TrainingBlocker,
  type TrainingPick
} from "@chaturanga/shared/chess/repertoire-training";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type ChapterKind,
  type PracticeMode,
  type RepertoireColor,
  type RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { COLOR_LABELS } from "./repertoire-chapters";
import { decisionDeltaLabel, numberedSan, pathLabel } from "./repertoire-model";

/*
 * Plain-language explanations of what practice asks and why it asks nothing: the study notice of
 * a chapter with nothing to practise, the reason a move isn't practised, the training marks and
 * the practice setup's empty states. Pure, so every text is unit-tested.
 */

/** A move as it reads on its own: `1. e4`, `2... d6`. */
export function moveLabel(lookup: ChapterLookup, nodeId: string): string {
  const node = lookup.nodesById.get(nodeId);
  if (!node?.san) return "the start";
  return numberedSan(node.fenBefore, node.san, true);
}

/* ------------------------------------------------------------------ why nothing is practised */

/**
 * A headline, one short sentence naming the cause (and the move it sits on), and, where it helps,
 * more context for an accessible description or tooltip rather than the page itself.
 */
export type Explanation = { title: string; detail: string; more?: string };

/**
 * Why a chapter has nothing to practise: a headline and what it means, naming the move the cause
 * sits on. `color` is the repertoire's side.
 */
export function blockerExplanation(
  blocker: TrainingBlocker,
  chapterTitle: string,
  lookup: ChapterLookup,
  color: RepertoireColor
): Explanation {
  const move = "nodeId" in blocker ? moveLabel(lookup, blocker.nodeId) : "";
  switch (blocker.kind) {
    case "left-out":
      return {
        title: `“${chapterTitle}” is left out of practice`,
        detail: `“${chapterTitle}” is switched off for practice in the Chapters list.`
      };
    case "reference-chapter":
      return {
        title: `“${chapterTitle}” is a reference chapter`,
        detail: `“${chapterTitle}” is a reference chapter, kept for study only.`
      };
    case "reference-move":
      return isOwnMove(lookup, blocker.nodeId, color)
        ? {
            title: "Your moves here are kept as reference",
            detail: `${move} is reference only, so nothing from it on is asked.`,
            more: "Moves you play in Study, and games added from the board, start as reference until you accept them."
          }
        : {
            title: "A reply here is kept as reference",
            detail: `${move} is reference only, so nothing after it is asked.`
          };
    case "disabled-branch":
      return {
        title: "This line is left out of practice",
        detail: `${move} is marked “Leave out of practice”, so nothing from it on is asked.`
      };
    case "stopped":
      return {
        title: "Practice ends before your first move",
        detail: `${move} is marked “End practice here”, so nothing after it is asked.`
      };
    case "before-start":
      return {
        title: "Practice starts on another line",
        detail: `${move} is marked “Start practice here”.`,
        more: "Moves before it, and lines that don't pass through it, are played for you and never asked."
      };
    case "no-moves":
      return {
        title: "No moves yet",
        detail: "Play your moves on the board to build this chapter."
      };
    case "no-own-moves":
      return {
        title: "No moves of yours here",
        detail: `Only the opponent's moves so far: add your replies (you play ${COLOR_LABELS[color]}).`
      };
  }
}

function isOwnMove(lookup: ChapterLookup, nodeId: string, color: RepertoireColor): boolean {
  const node = lookup.nodesById.get(nodeId);
  return node !== undefined && playerToMove(node.fenBefore) === color;
}

/**
 * The one-click fix for a blocker: make the chapter practised like an import (switched on, an
 * opening chapter, the first own move at each position accepted, replies covered), or remove the
 * training mark in the way. None when the chapter needs moves.
 */
export type TrainingFix =
  | { kind: "make-trainable"; label: string; description: string }
  | {
      kind: "clear-mark";
      nodeId: string;
      patch: Partial<RepertoireNodeMeta>;
      label: string;
      description: string;
    };

export function trainingFix(blocker: TrainingBlocker): TrainingFix | null {
  switch (blocker.kind) {
    case "left-out":
    case "reference-chapter":
    case "reference-move":
      return {
        kind: "make-trainable",
        label: "Include in practice",
        description:
          "Switches the chapter on and accepts your first move at each position, as an import does; replies are covered. Undo reverts it."
      };
    case "disabled-branch":
      return {
        kind: "clear-mark",
        nodeId: blocker.nodeId,
        patch: { disabled: false },
        label: "Include the line again",
        description: "Removes “Leave out of practice” from that move."
      };
    case "stopped":
      return {
        kind: "clear-mark",
        nodeId: blocker.nodeId,
        patch: { trainingStop: false },
        label: "Remove the end",
        description: "Removes “End practice here” from that move."
      };
    case "before-start":
      return {
        kind: "clear-mark",
        nodeId: blocker.nodeId,
        patch: { trainingStart: false },
        label: "Remove the start",
        description: "Removes “Start practice here” from that move."
      };
    case "no-moves":
    case "no-own-moves":
      return null;
  }
}

/**
 * "Include in practice", read against the repertoire before it applies: what the other chapters
 * practise at the positions where it accepts a move (`read`, for the positions not read yet),
 * asked again while accepting another move reaches new positions. `acceptedAt` then makes it
 * accept the moves other chapters practise; `widened` lists the picks that still add a move to a
 * position other chapters answer differently (the player is asked first).
 */
export async function includeInPracticePlan(
  color: RepertoireColor,
  chapter: Parameters<typeof trainingPicks>[1],
  read: (positionKeys: string[]) => Promise<Record<string, readonly string[]>>
): Promise<{ acceptedAt: AcceptedAt; widened: TrainingPick[] }> {
  const known = new Map<string, readonly string[]>();
  const acceptedAt: AcceptedAt = (key) => known.get(key);
  for (;;) {
    const picks = trainingPicks(color, chapter, acceptedAt);
    const unread = [...new Set(picks.map((pick) => pick.positionKey))].filter(
      (key) => !known.has(key)
    );
    if (!unread.length) return { acceptedAt, widened: picks.filter((pick) => pick.widens) };
    const practised = await read(unread);
    for (const key of unread) known.set(key, practised[key] ?? []);
  }
}

/** What the include plan reads of the open study: its chapter, and the generation of its edits. */
export type IncludeSnapshot<C> = { chapter: C; generation: number } | null;

/**
 * includeInPracticePlan for the chapter as it is once the plan is ready: an edit while the plan
 * reads (the board stays usable) plans again from the edited chapter, so a position the edit
 * reached is read (and asked about) too. `snapshot` reads the open chapter (null once it is no
 * longer open: then null). Returns the plan with the chapter and generation it holds for.
 */
export async function currentIncludePlan<C extends Parameters<typeof trainingPicks>[1]>(
  color: RepertoireColor,
  snapshot: () => IncludeSnapshot<C>,
  read: (positionKeys: string[]) => Promise<Record<string, readonly string[]>>
): Promise<{
  chapter: C;
  generation: number;
  acceptedAt: AcceptedAt;
  widened: TrainingPick[];
} | null> {
  for (;;) {
    const before = snapshot();
    if (!before) return null;
    const plan = await includeInPracticePlan(color, before.chapter, read);
    const after = snapshot();
    if (!after) return null;
    if (after.generation === before.generation) return { ...before, ...plan };
  }
}

/** The question before "Include in practice" widens decisions other chapters share. */
export function wideningQuestion(lookup: ChapterLookup, widened: readonly TrainingPick[]): string {
  const [first, ...rest] = widened;
  if (!first) return "";
  const where =
    first.nodeId === REPERTOIRE_ROOT_NODE_ID
      ? "at the start"
      : `after ${pathLabel(lookup, first.nodeId)}`;
  const more = rest.length ? ` (and ${rest.length} more)` : "";
  return `Your other chapters play a different move ${where}. Including also accepts ${moveLabel(lookup, first.childId)} there${more}.`;
}

/**
 * Where Study should open to show a blocker: the position whose choices list the reference move,
 * the marked move itself, or the chapter start.
 */
export function blockerFocusNodeId(blocker: TrainingBlocker, lookup: ChapterLookup): string {
  if (blocker.kind === "reference-move") {
    return lookup.nodesById.get(blocker.nodeId)?.parentId ?? REPERTOIRE_ROOT_NODE_ID;
  }
  return "nodeId" in blocker ? blocker.nodeId : REPERTOIRE_ROOT_NODE_ID;
}

/* ------------------------------------------------------------------ one position */

/** Why a position isn't practised, in a few words ("1. e4 is reference only"). */
export function scopeReason(cause: ScopeCause, lookup: ChapterLookup): string {
  const move = "nodeId" in cause ? moveLabel(lookup, cause.nodeId) : "";
  switch (cause.kind) {
    case "left-out":
      return "the chapter is left out of practice";
    case "reference-chapter":
      return "this is a reference chapter";
    case "reference-move":
      return `${move} is reference only`;
    case "disabled-branch":
      return `${move} is left out of practice`;
    case "stopped":
      return `practice ends at ${move}`;
    case "before-start":
      return `practice starts at ${move}`;
  }
}

/** How the selected position takes part in practice: "Practised", or why not. */
export function scopeStatus(cause: ScopeCause | null, lookup: ChapterLookup): string {
  if (!cause) return "Practised";
  const reason = scopeReason(cause, lookup);
  return cause.kind === "before-start" ? `Played for you: ${reason}` : `Not practised: ${reason}`;
}

/** A move's own mark, as the choices list names it next to "Not practised". */
export const EDGE_NOTES: Record<RepertoireNodeMeta["edge"], string> = {
  included: "accepted",
  covered: "covered",
  reference: "kept as reference"
};

/* ------------------------------------------------------------------ training marks */

export type MarkKey = "trainingStart" | "trainingStop" | "disabled";

/** Each training mark: its plain name and what it does to practice. */
export const MARK_TEXT: Record<MarkKey, { label: string; description: string }> = {
  trainingStart: {
    label: "Start practice here",
    description: "Practice begins at this move; earlier moves and other lines aren't asked."
  },
  trainingStop: {
    label: "End practice here",
    description: "Practice ends after this move; later moves are for study only."
  },
  disabled: {
    label: "Leave out of practice",
    description: "This move and what follows stay in the chapter but are never asked."
  }
};

/** What switching a mark does to the chapter's decisions, e.g. "Turning it on adds 2 decisions". */
export function markEffect(on: boolean, delta: number): string {
  if (delta === 0) return "No change to what this chapter practises";
  return `Turning it ${on ? "off" : "on"}: ${decisionDeltaLabel(delta)}`;
}

/* ------------------------------------------------------------------ practice setup */

/**
 * A practice start with nothing to ask: why, whether "Learn new" is worth offering, and a
 * secondary note naming chapters in scope that practise nothing when they aren't the cause.
 */
export type PracticeEmpty = Explanation & { offerLearnNew: boolean; note?: string };

/** A chapter in a practice scope that has nothing to practise, and why. */
export type BlockedChapter = { title: string; explanation: Explanation };

/**
 * The practice setup's empty state, from what the scope's chapters practise. When none of them
 * practises anything (`blocked` are all of them), the first is named with its cause. Otherwise
 * the mode explains what it found, and the chapters that practise nothing are only a note.
 */
export function practiceEmptyExplanation(
  mode: PracticeMode,
  blocked: readonly BlockedChapter[],
  othersPractise: boolean
): PracticeEmpty {
  const [first, ...rest] = blocked;
  if (first && !othersPractise) {
    return {
      title: `Nothing to practise in “${first.title}”`,
      detail: first.explanation.detail,
      ...(first.explanation.more ? { more: first.explanation.more } : {}),
      offerLearnNew: false,
      ...(rest.length
        ? {
            note: `${countOf(rest.length, "other chapter")} in scope ${rest.length === 1 ? "has" : "have"} nothing to practise either.`
          }
        : {})
    };
  }
  const note = first
    ? `“${first.title}”${rest.length ? ` and ${countOf(rest.length, "other chapter")}` : ""} in scope ${blocked.length === 1 ? "has" : "have"} nothing to practise yet.`
    : undefined;
  return { ...modeEmptyExplanation(mode), ...(note ? { note } : {}) };
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a practice mode found when its scope practises something but nothing was asked. */
function modeEmptyExplanation(mode: PracticeMode): PracticeEmpty {
  switch (mode) {
    case "review-due":
      return {
        title: "No reviews due",
        detail: "Everything in this scope is scheduled for later.",
        offerLearnNew: true
      };
    case "learn-new":
      return {
        title: "Nothing new to learn",
        detail: "You've practised every decision in this scope (paused ones are left out).",
        offerLearnNew: false
      };
    case "rehearse-lines":
      return {
        title: "Nothing to rehearse from here",
        detail:
          "No line from this start asks a move of yours within the max depth (paused decisions are played for you).",
        offerLearnNew: false
      };
  }
}

/** Why the setup's Start can't run (null when it can). */
export function startUnavailableReason(state: {
  decisionCount: number;
  practicableChapters: number;
  rehearsing: boolean;
  rehearseChapterId: string;
  /**
   * Whether a rehearsal of the chosen chapter from its start asks a move (false: every line only
   * plays paused decisions, replies or lead-up); null while that isn't known yet.
   */
  rehearseChapterAsks?: boolean | null;
}): string | null {
  if (!state.decisionCount || !state.practicableChapters) {
    return "Nothing in this repertoire is practised yet — see why above.";
  }
  if (state.rehearsing && !state.rehearseChapterId) return "Choose a chapter to rehearse.";
  if (state.rehearsing && state.rehearseChapterAsks === false) {
    return "No line in this chapter asks a move of yours that isn't paused.";
  }
  return null;
}

/* ------------------------------------------------------------------ study actions */

/** Why Study's "Practice this chapter" and "Rehearse this chapter" can't run (null: they can). */
export type StudyPracticeAvailability = { practice: string | null; rehearse: string | null };

export function studyPracticeAvailability(input: {
  /** The headline of the chapter's blocker, when it has nothing to practise. */
  blocker: Explanation | null;
  decisionKeys: readonly string[];
  paused: ReadonlySet<string>;
  /** Lines a rehearsal from the chapter start would play. */
  rehearsableLines: number;
}): StudyPracticeAvailability {
  if (input.blocker) {
    const reason = `Nothing to practise yet: ${lowerFirst(input.blocker.title)}.`;
    return { practice: reason, rehearse: reason };
  }
  if (input.decisionKeys.every((key) => input.paused.has(key))) {
    const reason = "Every decision in this chapter is paused (see Notes).";
    return { practice: reason, rehearse: reason };
  }
  return {
    practice: null,
    rehearse: input.rehearsableLines ? null : "No line in this chapter asks a move of yours."
  };
}

/** "Your moves…" → "your moves…"; a quoted chapter title is left as it is. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/* ------------------------------------------------------------------ import preview */

/** What one previewed game will practise as the chosen kind of chapter. */
export function importPracticeNote(
  kind: ChapterKind,
  decisions: number,
  color: RepertoireColor
): { text: string; warn: boolean } {
  if (kind === "reference") {
    return { text: "Reference: kept for study only, never practised.", warn: false };
  }
  if (!decisions) {
    return {
      text: `No moves of yours (${COLOR_LABELS[color]}) to practise in this game.`,
      warn: true
    };
  }
  return {
    text: `${decisions} decision${decisions === 1 ? "" : "s"} to practise (your first move at each position).`,
    warn: false
  };
}

/** The import preview's explanation of the two kinds of chapter. */
export const IMPORT_KIND_HELP =
  "Opening chapters are practised: your first move at each position is accepted and replies are covered (other moves stay reference). Reference chapters are for study only.";
