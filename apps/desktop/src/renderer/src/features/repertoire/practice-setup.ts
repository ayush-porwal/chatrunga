import type {
  PracticeMode,
  RepertoireChapterSummary,
  RepertoireDetail,
  StartPracticeInput
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

/**
 * The setup's starting values: the saved draft or the defaults, then a preset. Chapter ids that
 * no longer exist, are disabled or are reference chapters are dropped (the key too when none is
 * left, meaning every enabled opening chapter), so a stale draft can't be refused on Start.
 */
export function initialPracticeInput(
  detail: Pick<RepertoireDetail, "id" | "chapters" | "workspace">,
  preset: { chapterIds?: string[]; mode?: PracticeMode } | null
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
    ...(preset?.mode ? { mode: preset.mode } : {})
  };
  const allowed = practicableChapterIds(detail.chapters);
  const { chapterIds, ...rest } = merged;
  const kept = (chapterIds ?? []).filter((id) => allowed.has(id));
  return {
    ...rest,
    ...(kept.length ? { chapterIds: kept } : {}),
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

/** The start input built from the form's fields, within the main process's limits. */
export function practiceInputFromForm(form: {
  repertoireId: string;
  mode: PracticeMode;
  chapterIds: readonly string[];
  depth: string;
  cards: string;
  fresh: string;
}): StartPracticeInput {
  const depth = boundedInt(form.depth, 1, MAX_DEPTH_PLIES);
  return {
    repertoireId: form.repertoireId,
    mode: form.mode,
    ...(form.chapterIds.length ? { chapterIds: [...form.chapterIds] } : {}),
    ...(depth ? { maxDepthPlies: depth } : {}),
    cardLimit: boundedInt(form.cards, 1, MAX_CARD_LIMIT) ?? DEFAULT_CARD_LIMIT,
    newCardLimit: boundedInt(form.fresh, 0, MAX_CARD_LIMIT) ?? 0
  };
}
