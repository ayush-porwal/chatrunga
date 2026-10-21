import { useMemo } from "react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  chapterTraining,
  type TrainingBlocker
} from "@chaturanga/shared/chess/repertoire-training";
import type { RepertoireChapter, RepertoireColor } from "@chaturanga/shared/types/repertoire";

/** Why the open chapter practises nothing (null: it practises something, or isn't loaded). */
export function useStudyTraining({
  chapter,
  lookup,
  color
}: {
  chapter: RepertoireChapter | null;
  lookup: ChapterLookup | null;
  color: RepertoireColor;
}): TrainingBlocker | null {
  return useMemo(
    () => (chapter && lookup ? chapterTraining(color, chapter, lookup).blocker : null),
    [chapter, lookup, color]
  );
}
