import { type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  DEFAULT_REHEARSAL_DEPTH_PLIES,
  continuations,
  isDecisionNode,
  rehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type PracticeMode,
  type PracticeScope,
  type PracticeSummary,
  type RepertoireChapter,
  type RepertoireChapterSummary,
  type RepertoireColor,
  type RepertoireDetail,
  type StartPracticeInput
} from "@chaturanga/shared/types/repertoire";

/** Pure rules of the practice setup form: defaults, the saved draft, and the main's limits. */

export const DEFAULT_CARD_LIMIT = 20;
export const DEFAULT_NEW_CARD_LIMIT = 5;
/** The main process's validators refuse anything above these. */
export const MAX_CARD_LIMIT = 500;
export const MAX_DEPTH_PLIES = 512;

/** Chapters practice can draw from: enabled opening chapters. */
export function practicableChapterIds(
  chapters: readonly Pick<RepertoireChapterSummary, "id" | "kind" | "enabled">[]
): Set<string> {
  return new Set(
    chapters.filter((chapter) => chapter.kind === "opening" && chapter.enabled).map((c) => c.id)
  );
}

/** The chapter (and optional branch) a line rehearsal plays. */
export type RehearseTarget = NonNullable<PracticeScope["rehearse"]>;

/**
 * What a practice screen opens with: chapters / mode to preselect ("Practice this chapter",
 * "Review due"), a targeted queue of decisions (`positionKeys`, e.g. "Refresh this decision"
 * from a game's opening comparison), or a line rehearsal (`rehearse`, "Rehearse from here"). A
 * targeted queue or a rehearsal starts on its own when `autoStart` is set.
 */
export type PracticePreset = {
  chapterIds?: string[];
  mode?: PracticeMode;
  positionKeys?: string[];
  /** A targeted queue as ungraded extra practice ("Retry missed"): no schedule changes. */
  ungraded?: boolean;
  rehearse?: RehearseTarget;
  /** Rehearsal only: the depth limit to start with ("Rehearse again" keeps the session's). */
  maxDepthPlies?: number;
  autoStart?: boolean;
};

/** The preset that rehearses `target` at once (Study's "Rehearse this chapter / from here"). */
export function rehearsePreset(target: RehearseTarget, maxDepthPlies?: number): PracticePreset {
  return {
    mode: "rehearse-lines",
    rehearse: {
      chapterId: target.chapterId,
      ...(target.fromNodeId ? { fromNodeId: target.fromNodeId } : {})
    },
    ...(maxDepthPlies ? { maxDepthPlies } : {}),
    autoStart: true
  };
}

/**
 * "Retry missed": the session's missed decisions as a targeted queue, started at once; null when
 * nothing was missed. It is a new session, so the missed session's own answers and summary stay
 * as they were, and it is ungraded: its answers are recorded with it, but the first scored
 * attempt's schedule (a missed decision's relearn step, its lapses) stays as it was. "Refresh
 * this decision" is a graded targeted queue.
 */
export function retryMissedPreset(
  summary: Pick<PracticeSummary, "missedPositionKeys">
): PracticePreset | null {
  const positionKeys = [...new Set(summary.missedPositionKeys)];
  return positionKeys.length
    ? { mode: "review-due", positionKeys, ungraded: true, autoStart: true }
    : null;
}

/** A targeted queue (exact decisions, due or not) is extra practice, not the scheduled review. */
export function isExtraPractice(scope: Pick<PracticeScope, "positionKeys">): boolean {
  return Boolean(scope.positionKeys?.length);
}

/**
 * Whether starting `input` saves it as the repertoire's practice setup draft: only a start from
 * the setup form does. An auto-started preset (a targeted queue, a rehearsal from Study or the
 * summary) is a one-off, so the next setup opens as the player left it.
 */
export function savesPracticeDraft(input: StartPracticeInput, fromPreset: boolean): boolean {
  return !fromPreset && !input.positionKeys?.length;
}

/**
 * The start input of an auto-started preset (a targeted queue or a line rehearsal), or null when
 * the preset doesn't start on its own.
 */
export function autoStartPracticeInput(
  repertoireId: string,
  preset: PracticePreset | null
): StartPracticeInput | null {
  if (preset?.autoStart && preset.mode === "rehearse-lines" && preset.rehearse) {
    const { rehearse } = rehearsePreset(preset.rehearse);
    const depth =
      preset.maxDepthPlies !== undefined ? clamp(preset.maxDepthPlies, 1, MAX_DEPTH_PLIES) : 0;
    return {
      repertoireId,
      mode: "rehearse-lines",
      rehearse,
      ...(depth ? { maxDepthPlies: depth } : {})
    };
  }
  return targetedPracticeInput(repertoireId, preset);
}

/**
 * The start input of an auto-started targeted preset, or null when the preset isn't one. Only
 * the named decisions are queued (no saved chapter filter or depth applies), each whether due or
 * new.
 */
export function targetedPracticeInput(
  repertoireId: string,
  preset: PracticePreset | null
): StartPracticeInput | null {
  const positionKeys = [...new Set(preset?.positionKeys ?? [])];
  if (!preset?.autoStart || !positionKeys.length) return null;
  const limit = clamp(positionKeys.length, 1, MAX_CARD_LIMIT);
  return {
    repertoireId,
    mode: preset.mode ?? "review-due",
    positionKeys,
    cardLimit: limit,
    newCardLimit: limit,
    ...(preset.ungraded ? { ungraded: true } : {})
  };
}

/**
 * The preset "Practice again" keeps: a targeted queue or a rehearsal isn't repeated (the setup
 * opens instead, a rehearsal's chapter and branch preselected).
 */
export function presetForSetup(preset: PracticePreset | null): PracticePreset | null {
  if (!preset || (!preset.autoStart && !preset.positionKeys)) return preset;
  const { chapterIds, mode, rehearse, maxDepthPlies } = preset;
  const kept: PracticePreset = {
    ...(chapterIds ? { chapterIds } : {}),
    ...(mode ? { mode } : {}),
    ...(rehearse ? { rehearse } : {}),
    ...(rehearse && maxDepthPlies ? { maxDepthPlies } : {})
  };
  return Object.keys(kept).length ? kept : null;
}

/**
 * The setup's starting values: the saved draft or the defaults, then a preset. Chapter ids that
 * no longer exist, are disabled or are reference chapters are dropped (the key too when none is
 * left, meaning every enabled opening chapter), so a stale draft can't be refused on Start.
 */
export function initialPracticeInput(
  detail: Pick<RepertoireDetail, "id" | "chapters" | "workspace">,
  preset: PracticePreset | null
): StartPracticeInput {
  const saved = detail.workspace?.practiceDraft;
  const base: StartPracticeInput =
    saved && saved.repertoireId === detail.id
      ? saved
      : {
          repertoireId: detail.id,
          mode: "review-due",
          cardLimit: DEFAULT_CARD_LIMIT,
          newCardLimit: DEFAULT_NEW_CARD_LIMIT
        };
  const merged: StartPracticeInput = {
    ...base,
    ...(preset?.chapterIds ? { chapterIds: preset.chapterIds } : {}),
    ...(preset?.mode ? { mode: preset.mode } : {}),
    ...(preset?.rehearse ? { rehearse: preset.rehearse } : {}),
    ...(preset?.rehearse && preset.maxDepthPlies ? { maxDepthPlies: preset.maxDepthPlies } : {})
  };
  const allowed = practicableChapterIds(detail.chapters);
  const { chapterIds, rehearse, ...rest } = merged;
  // A targeted queue is never the setup's form (it starts on its own).
  delete rest.positionKeys;
  const kept = (chapterIds ?? []).filter((id) => allowed.has(id));
  // A rehearsal of a chapter that is gone, disabled or reference falls back to the chapter picker.
  const keptRehearse = rehearse && allowed.has(rehearse.chapterId) ? rehearse : null;
  return {
    ...rest,
    ...(kept.length ? { chapterIds: kept } : {}),
    ...(keptRehearse ? { rehearse: keptRehearse } : {}),
    ...(rest.cardLimit !== undefined
      ? { cardLimit: clamp(rest.cardLimit, 1, MAX_CARD_LIMIT) }
      : {}),
    ...(rest.newCardLimit !== undefined
      ? { newCardLimit: clamp(rest.newCardLimit, 0, MAX_CARD_LIMIT) }
      : {}),
    ...(rest.maxDepthPlies !== undefined
      ? { maxDepthPlies: clamp(rest.maxDepthPlies, 1, MAX_DEPTH_PLIES) }
      : {})
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** A whole number typed into a field, clamped to `max`; undefined when empty, invalid or < `min`. */
export function boundedInt(value: string, min: number, max: number): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return undefined;
  return Math.min(parsed, max);
}

/**
 * The start input built from the form's fields, within the main process's limits. A rehearsal
 * sends its chapter, optional branch and depth only: card limits don't apply to it.
 */
export function practiceInputFromForm(form: {
  repertoireId: string;
  mode: PracticeMode;
  chapterIds: readonly string[];
  depth: string;
  cards: string;
  fresh: string;
  /** Rehearsal: the chapter, and the branch's node ("" or absent: the chapter start). */
  rehearseChapterId?: string;
  rehearseFromNodeId?: string;
}): StartPracticeInput {
  const depth = boundedInt(form.depth, 1, MAX_DEPTH_PLIES);
  if (form.mode === "rehearse-lines") {
    return {
      repertoireId: form.repertoireId,
      mode: form.mode,
      ...(form.rehearseChapterId
        ? {
            rehearse: {
              chapterId: form.rehearseChapterId,
              ...(form.rehearseFromNodeId ? { fromNodeId: form.rehearseFromNodeId } : {})
            }
          }
        : {}),
      ...(depth ? { maxDepthPlies: depth } : {})
    };
  }
  return {
    repertoireId: form.repertoireId,
    mode: form.mode,
    ...(form.chapterIds.length ? { chapterIds: [...form.chapterIds] } : {}),
    ...(depth ? { maxDepthPlies: depth } : {}),
    cardLimit: boundedInt(form.cards, 1, MAX_CARD_LIMIT) ?? DEFAULT_CARD_LIMIT,
    newCardLimit: boundedInt(form.fresh, 0, MAX_CARD_LIMIT) ?? 0
  };
}

/** How many branch starts the setup's picker lists before it says the rest are left out. */
export const MAX_REHEARSE_STARTS = 200;

export type RehearseStart = { nodeId: string; path: string };

/**
 * Where a rehearsal can start inside a chapter: positions in training scope where the player is
 * to move and has a repertoire move within the depth limit, in authored order. The chapter start
 * is the picker's default and isn't listed; `label` names a node's path ("1. e4 e5 2. Nf3").
 */
export function rehearseStarts(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">,
  color: RepertoireColor,
  label: (lookup: ChapterLookup, nodeId: string) => string,
  limit = MAX_REHEARSE_STARTS,
  maxDepthPlies = DEFAULT_REHEARSAL_DEPTH_PLIES
): { starts: RehearseStart[]; truncated: boolean } {
  const context = rehearsalContext(chapter, color, maxDepthPlies);
  const starts: RehearseStart[] = [];
  for (const id of context.lookup.order) {
    if (id === REPERTOIRE_ROOT_NODE_ID || !isDecisionNode(context, id)) continue;
    if (!continuations(context, id).children.length) continue;
    if (starts.length >= limit) return { starts, truncated: true };
    starts.push({ nodeId: id, path: label(context.lookup, id) });
  }
  return { starts, truncated: false };
}
