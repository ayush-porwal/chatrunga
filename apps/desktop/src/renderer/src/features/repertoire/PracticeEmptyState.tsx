import { useEffect, useId, useMemo, useRef } from "react";
import { BookOpen, GraduationCap, Sparkles } from "lucide-react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  chapterTraining,
  type TrainingBlocker
} from "@chaturanga/shared/chess/repertoire-training";
import type {
  PracticeMode,
  RepertoireChapter,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cardPadded } from "@/lib/ui";
import { useRepertoireChaptersQuery } from "../../queries/repertoire";
import {
  blockerExplanation,
  blockerFocusNodeId,
  practiceEmptyExplanation,
  trainingFix,
  type Explanation
} from "./training-explanations";

/** A chapter in scope with nothing to practise: why, and where Study shows it. */
type Blocked = {
  chapter: RepertoireChapter;
  blocker: TrainingBlocker;
  explanation: Explanation;
  focus: string;
};

/** Why `chapter` practises nothing (null: it practises something). */
function blockedChapter(chapter: RepertoireChapter, detail: RepertoireDetail): Blocked | null {
  const lookup = buildChapterLookup(chapter);
  const { blocker } = chapterTraining(detail.color, chapter, lookup);
  if (!blocker) return null;
  return {
    chapter,
    blocker,
    explanation: blockerExplanation(blocker, chapter.title, lookup, detail.color),
    focus: blockerFocusNodeId(blocker, lookup)
  };
}

/**
 * Why practice has nothing to ask (after a start came back empty, or before any start when the
 * repertoire has no decision at all). The scope's chapters are read to name the cause: when none
 * of them practises anything, the first is named with the way back to Study at the chapter and
 * move in question; otherwise the mode explains what it found (offering Learn new after an empty
 * review), and the chapters that practise nothing are only a note with a Study link.
 */
export function PracticeEmptyState({
  detail,
  mode,
  chapterIds,
  scopeLarger = false,
  starting,
  onLearnNew,
  onStudy
}: {
  detail: RepertoireDetail;
  mode: PracticeMode;
  /** The chapters to explain (the rehearsed one, those in scope); none: the mode alone. */
  chapterIds: readonly string[];
  /** The scope has more chapters than `chapterIds` (any of them may practise something). */
  scopeLarger?: boolean;
  starting: boolean;
  onLearnNew: () => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
}) {
  const moreId = useId();
  const queries = useRepertoireChaptersQuery(chapterIds.length ? detail.id : null, chapterIds);
  const settled = queries.every((query) => query.data !== undefined || query.isError);
  // The query results are new arrays each render: recomputed only when a chapter read changes.
  const readKey = queries.map((query) => `${query.dataUpdatedAt}:${query.isError}`).join();
  const scope = useMemo(() => {
    const blocked = queries.flatMap((query) =>
      query.data ? (blockedChapter(query.data, detail) ?? []) : []
    );
    // A chapter not read (an error, past the limit) may practise something: not the cause then.
    return { blocked, othersPractise: scopeLarger || blocked.length < queries.length };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `queries` changes with `readKey`.
  }, [readKey, detail, scopeLarger]);
  const ref = useRef<HTMLDivElement | null>(null);
  // The setup's Start sits below: bring the answer into view where it appears.
  useEffect(() => {
    if (settled) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [settled, mode, chapterIds]);
  if (!settled) return null;

  const empty = practiceEmptyExplanation(
    mode,
    scope.blocked.map(({ chapter, explanation }) => ({ title: chapter.title, explanation })),
    scope.othersPractise
  );
  const [first] = scope.blocked;
  const cause = first && !scope.othersPractise ? first : null;
  const fix = cause ? trainingFix(cause.blocker) : null;
  const study = (blocked: Blocked) =>
    onStudy({ chapterId: blocked.chapter.id, nodeId: blocked.focus });
  return (
    <div ref={ref} role="status" aria-live="polite">
      <EmptyState
        className={cardPadded}
        icon={cause ? <BookOpen /> : <GraduationCap />}
        title={empty.title}
        description={
          <>
            {empty.detail}
            {/* More about the cause, read with the Study button (and its tooltip). */}
            {empty.more ? (
              <span id={moreId} className="sr-only">
                {` ${empty.more}`}
              </span>
            ) : null}
            {empty.note && first && !cause ? (
              <span className="mt-1 block text-2xs text-fg-subtle">
                {empty.note}{" "}
                <Button type="button" variant="link" size="xs" onClick={() => study(first)}>
                  Open “{first.chapter.title}” in Study
                </Button>
              </span>
            ) : empty.note ? (
              <span className="mt-1 block text-2xs text-fg-subtle">{empty.note}</span>
            ) : null}
          </>
        }
        action={
          cause ? (
            <Button
              type="button"
              variant="primary"
              title={empty.more}
              aria-describedby={empty.more ? moreId : undefined}
              onClick={() => study(cause)}
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
