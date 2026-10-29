import type {
  PracticeScope,
  PracticeSessionSnapshot,
  PracticeSummary,
  RepertoireChapterSummary,
  RepertoireDetail,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";
import { sortedChapters } from "./repertoire-chapters";

/**
 * Pure rules of starting practice: the repertoire's practice settings (its saved draft, edited in
 * the repertoire settings dialog), what Practice starts with them, the presets other screens start
 * (a targeted queue, a line rehearsal), and the main process's limits.
 */

export const DEFAULT_CARD_LIMIT = 20;
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
 * A session another screen starts at once: a targeted queue of decisions (`positionKeys`, e.g.
 * "Refresh this decision" from a game's opening comparison, or "Retry missed"), or a line
 * rehearsal (`rehearse`, e.g. "Rehearse again"). An empty preset is plain Practice: the
 * repertoire's practice settings (practiceStartInput). Each navigation to practice carries its own
 * preset object, so a page shown again for it never starts twice.
 */
export type PracticePreset = {
  mode?: StartPracticeInput["mode"];
  positionKeys?: string[];
  /** A targeted queue as ungraded extra practice ("Retry missed"): no schedule changes. */
  ungraded?: boolean;
  rehearse?: RehearseTarget;
  /** Rehearsal only: the depth limit to start with ("Rehearse again" keeps the session's). */
  maxDepthPlies?: number;
  /** Plain Practice from Study: its chapter, which a rehearsal of lines plays. */
  chapterId?: string;
  /* Practice home presets (docs/repertoire-games-and-practice.md §2, §4). */
  /** A Practice tab set: the repertoires it queues together (the route names the first). */
  repertoireIds?: string[];
  /** Practise these chapters only (the hub's chapter row): due positions first, then new ones. */
  chapterIds?: string[];
  /** Review what is due and nothing new (a set's Review; Learn new asks the new ones). */
  dueOnly?: boolean;
  /** The Repertoire tab it was started from: the summary offers the way back to it. */
  returnTab?: RepertoireHubTab;
};

/** The Repertoire tab a preset's session leads back to (null: none). */
export function returnTabOf(preset: PracticePreset | null): RepertoireHubTab | null {
  return preset?.returnTab ?? null;
}

/**
 * Weak-spots practice (`weak` mode): every forgotten position across `repertoireIds` (the route
 * names the first), or the one position a report row names (in its repertoire).
 */
export function weakSpotsPreset(
  target: { repertoireId: string; positionKey: string } | null,
  repertoireIds: readonly string[],
  returnTab: RepertoireHubTab
): PracticePreset {
  return target
    ? { mode: "weak", positionKeys: [target.positionKey], returnTab }
    : { mode: "weak", repertoireIds: [...repertoireIds], returnTab };
}

/** The modes a preset starts as they are, without the repertoire's practice settings. */
const OWN_MODES: readonly NonNullable<PracticePreset["mode"]>[] = [
  "learn-new",
  "practice-early",
  "weak"
];

/**
 * The start input of a Practice home preset (a set's Review / Practice early / Learn new, weak
 * spots, one chapter), or null when the preset isn't one.
 */
function homePracticeInput(
  repertoireId: string,
  preset: PracticePreset | null
): StartPracticeInput | null {
  if (!preset) return null;
  const own = preset.mode !== undefined && OWN_MODES.includes(preset.mode);
  if (!own && !preset.repertoireIds && !preset.chapterIds && !preset.dueOnly) return null;
  return {
    repertoireId,
    mode: preset.mode ?? "review-due",
    ...(preset.repertoireIds ? { repertoireIds: [...preset.repertoireIds] } : {}),
    ...(preset.chapterIds ? { chapterIds: [...preset.chapterIds] } : {}),
    ...(preset.positionKeys?.length ? { positionKeys: [...new Set(preset.positionKeys)] } : {}),
    ...(preset.dueOnly ? { newCardLimit: 0 } : {})
  };
}

/** The preset that rehearses `target` at once ("Rehearse again", another line's chapter). */
export function rehearsePreset(target: RehearseTarget, maxDepthPlies?: number): PracticePreset {
  return {
    mode: "rehearse-lines",
    rehearse: {
      chapterId: target.chapterId,
      ...(target.fromNodeId ? { fromNodeId: target.fromNodeId } : {})
    },
    ...(maxDepthPlies ? { maxDepthPlies } : {})
  };
}

/**
 * "Retry missed": the session's missed decisions as a targeted queue; null when nothing was
 * missed. It is a new session, so the missed session's own answers and summary stay as they were,
 * and it is ungraded: its answers are recorded with it, but the first scored attempt's schedule (a
 * missed decision's relearn step, its lapses) stays as it was. "Refresh this decision" is a graded
 * targeted queue.
 */
export function retryMissedPreset(
  summary: Pick<PracticeSummary, "missedPositionKeys">
): PracticePreset | null {
  const positionKeys = [...new Set(summary.missedPositionKeys)];
  return positionKeys.length ? { mode: "review-due", positionKeys, ungraded: true } : null;
}

/**
 * The new sessions a finished session's summary offers: "Retry missed", or for a line rehearsal
 * "Rehearse again" (its chapter, branch and depth) instead (its misses are lines, not cards).
 */
export function summaryPresets(
  session: Pick<PracticeSessionSnapshot, "mode" | "scope"> | null,
  summary: Pick<PracticeSummary, "missedPositionKeys">
): { retryMissed: PracticePreset | null; rehearseAgain: PracticePreset | null } {
  const rehearsed = session?.mode === "rehearse-lines" ? session.scope : null;
  if (!rehearsed) return { retryMissed: retryMissedPreset(summary), rehearseAgain: null };
  return {
    retryMissed: null,
    rehearseAgain: rehearsed.rehearse
      ? rehearsePreset(rehearsed.rehearse, rehearsed.maxDepthPlies)
      : null
  };
}

/** A targeted queue (exact decisions, due or not) is extra practice, not the scheduled review. */
export function isExtraPractice(scope: Pick<PracticeScope, "positionKeys">): boolean {
  return Boolean(scope.positionKeys?.length);
}

/**
 * The start input of a preset that names its session (a line rehearsal or a targeted queue), or
 * null for plain Practice (practiceStartInput then applies).
 */
export function autoStartPracticeInput(
  repertoireId: string,
  preset: PracticePreset | null
): StartPracticeInput | null {
  if (preset?.mode === "rehearse-lines" && preset.rehearse) {
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
  return homePracticeInput(repertoireId, preset) ?? targetedPracticeInput(repertoireId, preset);
}

/**
 * The start input of a targeted preset, or null when the preset isn't one. Only the named
 * decisions are queued (no saved chapter filter or depth applies), each whether due or new.
 */
export function targetedPracticeInput(
  repertoireId: string,
  preset: PracticePreset | null
): StartPracticeInput | null {
  const positionKeys = [...new Set(preset?.positionKeys)];
  if (!positionKeys.length) return null;
  const limit = clamp(positionKeys.length, 1, MAX_CARD_LIMIT);
  return {
    repertoireId,
    mode: preset?.mode ?? "review-due",
    positionKeys,
    cardLimit: limit,
    newCardLimit: limit,
    ...(preset?.ungraded ? { ungraded: true } : {})
  };
}

/**
 * The repertoire's practice settings: its saved draft or the defaults. Practice always reviews
 * due positions first, then new ones within the daily new limit (an older Learn new draft reads
 * as that; an older draft's own new-card count is dropped: one global limit replaced it), or
 * rehearses lines. Chapter ids that no longer exist, are disabled or are reference chapters are
 * dropped (the key too when none is left, meaning every enabled opening chapter), so a stale
 * draft can't be refused on start; limits are clamped to the main process's bounds.
 */
export function practiceSettings(
  detail: Pick<RepertoireDetail, "id" | "chapters" | "workspace">
): StartPracticeInput {
  const saved = detail.workspace?.practiceDraft;
  const base: StartPracticeInput =
    saved && saved.repertoireId === detail.id
      ? saved
      : { repertoireId: detail.id, mode: "review-due", cardLimit: DEFAULT_CARD_LIMIT };
  const allowed = practicableChapterIds(detail.chapters);
  const kept = (base.chapterIds ?? []).filter((id) => allowed.has(id));
  return {
    repertoireId: detail.id,
    mode: base.mode === "rehearse-lines" ? "rehearse-lines" : "review-due",
    ...(kept.length ? { chapterIds: kept } : {}),
    ...withinLimits(base)
  };
}

/**
 * What Practice starts: the practice settings' review (due positions first, then new ones), or a
 * rehearsal of one chapter's lines when the settings say so — `chapterId` (Study's open chapter),
 * else the chapter last studied, else the first in scope — falling back to the review when no
 * chapter can be rehearsed.
 */
export function practiceStartInput(
  detail: Pick<RepertoireDetail, "id" | "chapters" | "workspace">,
  chapterId: string | null = null
): StartPracticeInput {
  const settings = practiceSettings(detail);
  if (settings.mode !== "rehearse-lines") return settings;
  const allowed = practicableChapterIds(detail.chapters);
  const ordered = sortedChapters(detail.chapters).filter((chapter) => allowed.has(chapter.id));
  const inScope = settings.chapterIds?.length
    ? ordered.filter((chapter) => settings.chapterIds!.includes(chapter.id))
    : ordered;
  const rehearsed = [chapterId, detail.workspace?.lastChapterId ?? null, inScope.at(0)?.id ?? null]
    .filter((id): id is string => id !== null)
    .find((id) => allowed.has(id));
  if (!rehearsed) return { ...settings, mode: "review-due" };
  return {
    repertoireId: detail.id,
    mode: "rehearse-lines",
    rehearse: { chapterId: rehearsed },
    ...(settings.maxDepthPlies ? { maxDepthPlies: settings.maxDepthPlies } : {})
  };
}

/**
 * What a practice navigation starts with `detail`'s settings: its preset's own session (a line
 * rehearsal, a targeted queue), else what the practice settings start (from the preset's
 * chapter, for a rehearsal). `followsSettings`: the latter, so newly saved settings change it.
 */
export function presetPracticeInput(
  detail: Pick<RepertoireDetail, "id" | "chapters" | "workspace">,
  preset: PracticePreset
): { input: StartPracticeInput; followsSettings: boolean } {
  const own = autoStartPracticeInput(detail.id, preset);
  return own
    ? { input: own, followsSettings: false }
    : { input: practiceStartInput(detail, preset.chapterId ?? null), followsSettings: true };
}

/** The limits `input` sets, clamped to the main process's bounds (unset ones stay unset). */
function withinLimits(
  input: Pick<StartPracticeInput, "cardLimit" | "maxDepthPlies">
): Pick<StartPracticeInput, "cardLimit" | "maxDepthPlies"> {
  const { cardLimit, maxDepthPlies } = input;
  return {
    ...(cardLimit !== undefined ? { cardLimit: clamp(cardLimit, 1, MAX_CARD_LIMIT) } : {}),
    ...(maxDepthPlies !== undefined
      ? { maxDepthPlies: clamp(maxDepthPlies, 1, MAX_DEPTH_PLIES) }
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

/** The settings dialog's practice fields, as typed (numbers are text until read). */
export type PracticeSettingsForm = {
  /** Rehearse lines instead of reviewing positions. */
  lines: boolean;
  chapterIds: readonly string[];
  depth: string;
  cards: string;
};

/** The dialog's fields for the practice settings (unset limits show their defaults). */
export function practiceSettingsForm(settings: StartPracticeInput): PracticeSettingsForm {
  return {
    lines: settings.mode === "rehearse-lines",
    chapterIds: settings.chapterIds ?? [],
    depth: settings.maxDepthPlies ? String(settings.maxDepthPlies) : "",
    cards: String(settings.cardLimit ?? DEFAULT_CARD_LIMIT)
  };
}

/** The practice settings saved from the dialog's fields, within the main process's limits. */
export function practiceSettingsFromForm(
  form: PracticeSettingsForm & { repertoireId: string }
): StartPracticeInput {
  const depth = boundedInt(form.depth, 1, MAX_DEPTH_PLIES);
  return {
    repertoireId: form.repertoireId,
    mode: form.lines ? "rehearse-lines" : "review-due",
    ...(form.chapterIds.length ? { chapterIds: [...form.chapterIds] } : {}),
    ...(depth ? { maxDepthPlies: depth } : {}),
    cardLimit: boundedInt(form.cards, 1, MAX_CARD_LIMIT) ?? DEFAULT_CARD_LIMIT
  };
}

/** The most chapters of a scope read to explain an empty practice start. */
export const EXPLAINED_CHAPTER_LIMIT = 20;

/**
 * The chapters that explain a practice start with nothing to ask: the rehearsed chapter, else the
 * chapters in scope (the first EXPLAINED_CHAPTER_LIMIT). A start over every chapter names one only
 * when the whole repertoire has no decision: the chapter last studied, else the first one. Empty
 * when there is no such chapter (the mode's own explanation applies).
 */
export function explainedChapterIds(
  detail: Pick<RepertoireDetail, "chapters" | "workspace" | "decisionCount">,
  input: Pick<StartPracticeInput, "mode" | "chapterIds" | "rehearse">
): string[] {
  const known = new Set(detail.chapters.map((chapter) => chapter.id));
  if (input.mode === "rehearse-lines" && input.rehearse) {
    return known.has(input.rehearse.chapterId) ? [input.rehearse.chapterId] : [];
  }
  if (input.chapterIds?.length) {
    return input.chapterIds.filter((id) => known.has(id)).slice(0, EXPLAINED_CHAPTER_LIMIT);
  }
  if (detail.decisionCount > 0) return [];
  const last = detail.workspace?.lastChapterId;
  if (last && known.has(last)) return [last];
  const first = sortedChapters(detail.chapters).at(0);
  return first ? [first.id] : [];
}
