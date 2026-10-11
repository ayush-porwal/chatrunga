import {
  canRehearseFrom,
  type RehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { useEventCallback } from "@/lib/use-event-callback";
import type { RehearseTarget } from "./practice-setup";

/**
 * Study's ways into practice: the chapter's decisions, or rehearsing its lines from the start or
 * from the selected move. Each saves the chapter first (`flush`) and reports a failed save on the
 * page's error line (`setError`).
 */
export function useStudyPracticeHandoffs({
  chapterId,
  node,
  rehearsal,
  flush,
  setError,
  onPractice,
  onRehearse
}: {
  chapterId: string;
  /** The selected node (null until the chapter is loaded). */
  node: MoveNode | null;
  /** Where a rehearsal of the chapter can run (null: nowhere). */
  rehearsal: RehearsalContext | null;
  flush: () => Promise<boolean>;
  setError: (message: string | null) => void;
  onPractice: (chapterIds: string[]) => void;
  onRehearse?: (target: RehearseTarget) => void;
}): {
  practiceChapter: () => void;
  /** Rehearse from the chapter start (absent: rehearsal isn't offered). */
  rehearseChapter?: () => void;
  /** "Rehearse from here", at the selected move (absent: unavailable there). */
  rehearseFromHere?: () => void;
} {
  const practiceChapter = useEventCallback(async () => {
    setError(null);
    if (await flush()) onPractice([chapterId]);
    else setError("This chapter isn't saved yet — retry the save before practising.");
  });

  const rehearse = useEventCallback(async (fromNodeId: string | null) => {
    if (!onRehearse) return;
    setError(null);
    if (await flush()) {
      onRehearse({ chapterId, ...(fromNodeId ? { fromNodeId } : {}) });
    } else setError("This chapter isn't saved yet — retry the save before rehearsing.");
  });

  return {
    practiceChapter: () => void practiceChapter(),
    rehearseChapter: onRehearse ? () => void rehearse(null) : undefined,
    rehearseFromHere:
      onRehearse && rehearsal && node && canRehearseFrom(rehearsal, node.id)
        ? () => void rehearse(node.id)
        : undefined
  };
}
