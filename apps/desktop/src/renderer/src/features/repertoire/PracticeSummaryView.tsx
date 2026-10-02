import { BookOpen, Route, RotateCcw } from "lucide-react";
import type {
  PracticeCard,
  PracticeSummary,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page";
import { Stat, StatGroup } from "@/components/ui/stat";
import { cardPadded } from "@/lib/ui";
import { firstMissedTarget } from "./repertoire-model";

/**
 * Session summary (§5.3): unaided recalls, assisted answers, missed and skipped decisions, the
 * chapters practised, and the ways on. Counts describe decision recall — no "mastered" score. A
 * line rehearsal also counts lines started and completed and answers that belonged to another
 * line, and offers "Rehearse again" (nothing in it was scheduled).
 */
export function PracticeSummaryView({
  detail,
  summary,
  cards,
  onStudy,
  onAgain,
  onRehearseAgain
}: {
  detail: RepertoireDetail;
  summary: PracticeSummary;
  cards: readonly PracticeCard[];
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  onAgain: () => void;
  /** A rehearsal's summary: the same rehearsal again. */
  onRehearseAgain?: () => void;
}) {
  const titles = new Map(detail.chapters.map((chapter) => [chapter.id, chapter.title]));
  const missed = firstMissedTarget(summary, cards);
  const rehearsal = summary.rehearsal ?? null;
  const hasMissed = summary.missedPositionKeys.length > 0;
  return (
    <div className="scroll-area h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl content-start gap-5 px-(--page-gutter) py-(--page-gutter-y)">
        <section className={`${cardPadded} grid gap-5`} aria-labelledby="practice-summary-title">
          <SectionHeader
            title={
              <span id="practice-summary-title">
                {rehearsal ? "Rehearsal complete" : "Session complete"}
              </span>
            }
            description={
              rehearsal
                ? "Results stay in this session: nothing was scheduled. A move from another line isn't a miss."
                : "Recall counts each decision once: any accepted move is a correct answer."
            }
          />
          {rehearsal ? (
            <StatGroup>
              <Stat label="Lines started" value={String(rehearsal.linesStarted)} />
              <Stat label="Lines completed" value={String(rehearsal.linesCompleted)} />
              <Stat label="Other-line answers" value={String(rehearsal.otherLineAnswers)} />
            </StatGroup>
          ) : null}
          <StatGroup>
            <Stat label="Unaided" value={String(summary.unaided)} />
            <Stat label="With a hint" value={String(summary.assisted)} />
            <Stat label="Missed" value={String(summary.missed)} />
            {rehearsal ? null : <Stat label="Skipped" value={String(summary.skipped)} />}
          </StatGroup>
          {summary.chapters.length ? (
            <p className="text-xs text-fg-muted">
              Chapters:{" "}
              {summary.chapters.map((id) => titles.get(id) ?? "Removed chapter").join(", ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {hasMissed ? (
              <Button
                type="button"
                variant="primary"
                disabled={!missed && !summary.chapters[0]}
                onClick={() => onStudy(missed ?? { chapterId: summary.chapters[0], nodeId: null })}
              >
                <BookOpen />
                Study missed positions
              </Button>
            ) : null}
            {onRehearseAgain ? (
              <Button
                type="button"
                variant={hasMissed ? "outline" : "primary"}
                onClick={onRehearseAgain}
              >
                <Route />
                Rehearse again
              </Button>
            ) : null}
            <Button
              type="button"
              variant={hasMissed || onRehearseAgain ? "outline" : "primary"}
              onClick={onAgain}
            >
              <RotateCcw />
              {onRehearseAgain ? "Set up another session" : "Practice again"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
