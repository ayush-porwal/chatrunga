import { BookOpen, RotateCcw } from "lucide-react";
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
 * chapters practised, and the ways on. Counts describe decision recall — no "mastered" score.
 */
export function PracticeSummaryView({
  detail,
  summary,
  cards,
  onStudy,
  onAgain
}: {
  detail: RepertoireDetail;
  summary: PracticeSummary;
  cards: readonly PracticeCard[];
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  onAgain: () => void;
}) {
  const titles = new Map(detail.chapters.map((chapter) => [chapter.id, chapter.title]));
  const missed = firstMissedTarget(summary, cards);
  return (
    <div className="scroll-area h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl content-start gap-5 px-(--page-gutter) py-(--page-gutter-y)">
        <section className={`${cardPadded} grid gap-5`} aria-labelledby="practice-summary-title">
          <SectionHeader
            title={<span id="practice-summary-title">Session complete</span>}
            description="Recall counts each decision once: any accepted move is a correct answer."
          />
          <StatGroup>
            <Stat label="Unaided" value={String(summary.unaided)} />
            <Stat label="With a hint" value={String(summary.assisted)} />
            <Stat label="Missed" value={String(summary.missed)} />
            <Stat label="Skipped" value={String(summary.skipped)} />
          </StatGroup>
          {summary.chapters.length ? (
            <p className="text-xs text-fg-muted">
              Chapters:{" "}
              {summary.chapters.map((id) => titles.get(id) ?? "Removed chapter").join(", ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {summary.missedPositionKeys.length ? (
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
            <Button
              type="button"
              variant={summary.missedPositionKeys.length ? "outline" : "primary"}
              onClick={onAgain}
            >
              <RotateCcw />
              Practice again
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
