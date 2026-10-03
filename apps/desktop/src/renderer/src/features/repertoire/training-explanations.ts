import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { ScopeCause, TrainingBlocker } from "@chaturanga/shared/chess/repertoire-training";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type ChapterKind,
  type PracticeMode,
  type RepertoireColor,
  type RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { COLOR_LABELS } from "./repertoire-chapters";
import { decisionDeltaLabel, numberedSan } from "./repertoire-model";

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

export type Explanation = { title: string; detail: string };

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
        detail:
          "It is switched off for practice in the Chapters list, so none of its moves are asked."
      };
    case "reference-chapter":
      return {
        title: `“${chapterTitle}” is a reference chapter`,
        detail:
          "Reference chapters are kept for study only: none of their moves are asked in practice."
      };
    case "reference-move":
      return isOwnMove(lookup, blocker.nodeId, color)
        ? {
            title: "Your moves here are kept as reference",
            detail: `${move} is reference only (study material), so nothing from it on is asked in practice. Moves you play while studying, and whole games added from the board, start this way until you accept them.`
          }
        : {
            title: "A reply here is kept as reference",
            detail: `${move} is reference only (study material), so nothing after it is asked in practice.`
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
        detail: `${move} is marked “Start practice here”: moves before it, and lines that don't pass through it, are played for you and never asked.`
      };
    case "no-moves":
      return {
        title: "No moves yet",
        detail:
          "Play your moves on the board to build this chapter, then accept the ones to practise."
      };
    case "no-own-moves":
      return {
        title: "No moves of yours here",
        detail: `This chapter only has the opponent's moves (you play ${COLOR_LABELS[color]}). Add your replies on the board.`
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
        label: "Practise this chapter",
        description:
          "Includes the chapter in practice and accepts your first move at each position (replies are covered), as an import does. Other moves stay reference; Undo puts the moves back as they were."
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
    description:
      "Practice begins at this move: earlier moves are played for you, and lines that don't pass through here aren't asked."
  },
  trainingStop: {
    label: "End practice here",
    description: "Practice ends after this move: later moves stay for study but aren't asked."
  },
  disabled: {
    label: "Leave out of practice",
    description: "This move and everything after it stay in the chapter but are never asked."
  }
};

/** What switching a mark does to the chapter's decisions, e.g. "Turning it on adds 2 decisions". */
export function markEffect(on: boolean, delta: number): string {
  if (delta === 0) return "No change to what this chapter practises";
  return `Turning it ${on ? "off" : "on"}: ${decisionDeltaLabel(delta)}`;
}

/* ------------------------------------------------------------------ practice setup */

/** A practice start with nothing to ask: why, and whether "Learn new" is worth offering. */
export type PracticeEmpty = Explanation & { offerLearnNew: boolean };

/**
 * The practice setup's empty state. With a blocker (the scope's chapter has nothing to practise)
 * it names the chapter and the cause; otherwise the mode explains what it found.
 */
export function practiceEmptyExplanation(
  mode: PracticeMode,
  blocker: Explanation | null,
  chapterTitle: string | null
): PracticeEmpty {
  if (blocker) {
    return {
      title: chapterTitle ? `Nothing to practise in “${chapterTitle}”` : "Nothing to practise yet",
      detail: `${blocker.title}. ${blocker.detail}`,
      offerLearnNew: false
    };
  }
  switch (mode) {
    case "review-due":
      return {
        title: "No reviews due",
        detail:
          "Everything in this scope is scheduled for later. Learn new practises the decisions you haven't seen yet.",
        offerLearnNew: true
      };
    case "learn-new":
      return {
        title: "Nothing new to learn",
        detail:
          "Every decision in this scope has been practised already (paused ones are left out). Review due asks them again when they are due.",
        offerLearnNew: false
      };
    case "rehearse-lines":
      return {
        title: "Nothing to rehearse from here",
        detail:
          "No line from this start asks a move of yours: its decisions may be paused, or deeper than the max depth. Pick another start or raise the depth.",
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
}): string | null {
  if (!state.decisionCount || !state.practicableChapters) {
    return "Nothing in this repertoire is practised yet — see why above.";
  }
  if (state.rehearsing && !state.rehearseChapterId) return "Choose a chapter to rehearse.";
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
    text: `${decisions} decision${decisions === 1 ? "" : "s"} to practise: your first move at each position. Your other moves stay reference until you accept them in Study.`,
    warn: false
  };
}

/** The import preview's explanation of the two kinds of chapter. */
export const IMPORT_KIND_HELP =
  "Opening chapters are practised: your first move at each position is accepted, the opponent's replies are covered, and your other moves stay reference until you accept them. Reference chapters (model games, notes) are kept for study only.";
