import { useEffect, useMemo, useRef } from "react";
import { BookOpen, GraduationCap, Sparkles } from "lucide-react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { chapterTraining } from "@chaturanga/shared/chess/repertoire-training";
import type { PracticeMode, RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cardPadded } from "@/lib/ui";
import { useRepertoireChapterQuery } from "../../queries/repertoire";
import {
  blockerExplanation,
  blockerFocusNodeId,
  practiceEmptyExplanation,
  trainingFix
} from "./training-explanations";

/**
 * Why practice has nothing to ask (after a start came back empty, or before any start when the
 * repertoire has no decision at all). The scope's chapter is read to name the cause; when it has
 * nothing to practise the way back is Study at the chapter and move in question, otherwise the
 * mode explains what it found (offering Learn new after an empty review).
 */
export function PracticeEmptyState({
  detail,
  mode,
  chapterId,
  starting,
  onLearnNew,
  onStudy
}: {
  detail: RepertoireDetail;
  mode: PracticeMode;
  /** The chapter to explain (the rehearsed one, the first in scope); null: the mode alone. */
  chapterId: string | null;
  starting: boolean;
  onLearnNew: () => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
}) {
  const query = useRepertoireChapterQuery(chapterId ? detail.id : null, chapterId);
  const chapter = chapterId && query.data?.id === chapterId ? query.data : null;
  const explained = useMemo(() => {
    if (!chapter) return null;
    const lookup = buildChapterLookup(chapter);
    const { blocker } = chapterTraining(detail.color, chapter, lookup);
    if (!blocker) return { chapter, blocker: null, explanation: null, focus: null };
    return {
      chapter,
      blocker,
      explanation: blockerExplanation(blocker, chapter.title, lookup, detail.color),
      focus: blockerFocusNodeId(blocker, lookup)
    };
  }, [chapter, detail.color]);
  const ref = useRef<HTMLDivElement | null>(null);
  const ready = !chapterId || explained !== null || query.isError;
  // The setup's Start sits below: bring the answer into view where it appears.
  useEffect(() => {
    if (ready) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [ready, mode, chapterId]);
  if (!ready) return null;

  const empty = practiceEmptyExplanation(
    mode,
    explained?.explanation ?? null,
    explained?.chapter.title ?? null
  );
  const fix = explained?.blocker ? trainingFix(explained.blocker) : null;
  return (
    <div ref={ref} role="status" aria-live="polite">
      <EmptyState
        className={cardPadded}
        icon={explained?.blocker ? <BookOpen /> : <GraduationCap />}
        title={empty.title}
        description={empty.detail}
        action={
          explained?.blocker ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => onStudy({ chapterId: explained.chapter.id, nodeId: explained.focus })}
            >
              <BookOpen />
              {fix ? "Fix in Study" : "Open in Study"}
            </Button>
          ) : empty.offerLearnNew ? (
            <Button type="button" variant="primary" disabled={starting} onClick={onLearnNew}>
              <Sparkles />
              Learn new
            </Button>
          ) : null
        }
      />
    </div>
  );
}
