import { useMemo } from "react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  DEFAULT_REHEARSAL_DEPTH_PLIES,
  lineEnds,
  rehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import { chapterTraining } from "@chaturanga/shared/chess/repertoire-training";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { useRepertoirePausedKeysQuery } from "../../queries/repertoire";
import { blockerExplanation, studyPracticeAvailability } from "./training-explanations";

/**
 * What the open chapter trains: why it trains nothing (`blocker`), how many decisions it asks,
 * where a rehearsal can run, and why Practice or Rehearse can't start.
 */
export function useStudyTraining({
  repertoireId,
  chapter,
  lookup,
  color
}: {
  repertoireId: string;
  chapter: RepertoireChapter | null;
  lookup: ChapterLookup | null;
  color: RepertoireColor;
}) {
  const training = useMemo(
    () => (chapter && lookup ? chapterTraining(color, chapter, lookup) : null),
    [chapter, lookup, color]
  );
  const pausedKeys = useRepertoirePausedKeysQuery(repertoireId).data;
  const paused = useMemo(() => new Set(pausedKeys), [pausedKeys]);
  // "Rehearse from here" is offered in training scope within the default depth limit only, where
  // a line asks a decision that isn't paused (a paused one is played as context).
  const rehearsal = useMemo(
    () =>
      chapter && lookup && chapter.enabled && chapter.kind === "opening"
        ? rehearsalContext(chapter, color, {
            maxDepthPlies: DEFAULT_REHEARSAL_DEPTH_PLIES,
            lookup,
            paused
          })
        : null,
    [chapter, lookup, color, paused]
  );
  const availability = useMemo(
    () =>
      studyPracticeAvailability({
        blocker:
          training?.blocker && lookup && chapter
            ? blockerExplanation(training.blocker, chapter.title, lookup, color)
            : null,
        decisionKeys: training?.decisionKeys ?? [],
        paused,
        rehearsableLines: rehearsal ? lineEnds(rehearsal, REPERTOIRE_ROOT_NODE_ID).length : 0
      }),
    [training, lookup, chapter, color, paused, rehearsal]
  );
  return {
    blocker: training?.blocker ?? null,
    decisionCount: training?.decisionKeys.length ?? 0,
    rehearsal,
    availability
  };
}
