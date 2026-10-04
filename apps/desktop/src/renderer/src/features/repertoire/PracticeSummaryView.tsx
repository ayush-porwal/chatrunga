import { BookOpen, RefreshCcw, Route, RotateCcw } from "lucide-react";
import type {
  PracticeCard,
  PracticeSummary,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page";
import { Stat, StatGroup } from "@/components/ui/stat";
import { cardPadded } from "@/lib/ui";
import { missedPositions } from "./repertoire-model";

/**
 * Session summary (§5.3): unaided recalls, assisted answers, missed and skipped decisions, the
 * chapters practised, and the ways on. Counts describe decision recall — no "mastered" score.
 * Every missed decision is listed with its chapter and moves and a link to study it; "Retry
 * missed" practises them again as ungraded extra practice (a new targeted session: this one's
 * answers stay as they were, and no schedule changes). A line rehearsal also counts lines started
 * and completed and answers that belonged to another line, and offers "Rehearse again" (nothing
 * in it was scheduled).
 */
export function PracticeSummaryView({
  detail,
  summary,
  cards,
  extraPractice = false,
  ungraded = false,
  onStudy,
  onAgain,
  onRetryMissed,
  onRehearseAgain,
  note
}: {
  detail: RepertoireDetail;
  summary: PracticeSummary;
  cards: readonly PracticeCard[];
  /** The session was itself extra practice (a targeted queue, e.g. a retry of missed decisions). */
  extraPractice?: boolean;
  /** The session was ungraded extra practice (Retry missed): nothing in it was scheduled. */
  ungraded?: boolean;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  onAgain: () => void;
  /** Practise the missed decisions again, as extra practice. */
  onRetryMissed?: () => void;
  /** A rehearsal's summary: the same rehearsal again. */
  onRehearseAgain?: () => void;
  /** Why the session ended early (its chapter changed). */
  note?: string | null;
}) {
  const titles = new Map(detail.chapters.map((chapter) => [chapter.id, chapter.title]));
  const missed = missedPositions(summary, cards);
  const rehearsal = summary.rehearsal ?? null;
  const retry = summary.missedPositionKeys.length ? onRetryMissed : undefined;
  return (
    <div className="scroll-area h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl content-start gap-5 px-(--page-gutter) py-(--page-gutter-y)">
        <section className={`${cardPadded} grid gap-5`} aria-labelledby="practice-summary-title">
          <SectionHeader
            title={
              <span id="practice-summary-title">
                {rehearsal
                  ? "Rehearsal complete"
                  : extraPractice
                    ? "Extra practice complete"
                    : "Session complete"}
              </span>
            }
            description={
              rehearsal
                ? "Results stay in this session: nothing was scheduled. A move from another line isn't a miss."
                : ungraded
                  ? "Results stay in this session: nothing was scheduled, so each decision's next review is as your first answer left it."
                  : "Recall counts each decision once: any accepted move is a correct answer."
            }
          />
          {note ? (
            <p role="status" className="text-sm text-fg-muted">
              {note}
            </p>
          ) : null}
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
          {missed.length ? (
            <section aria-labelledby="practice-missed-title" className="grid gap-1">
              <h3 id="practice-missed-title" className="text-xs font-medium text-fg-secondary">
                Missed positions
              </h3>
              <ul
                aria-labelledby="practice-missed-title"
                className="grid divide-y divide-line-subtle"
              >
                {missed.map((position) => {
                  const chapterTitle = titles.get(position.chapterId) ?? "Removed chapter";
                  return (
                    <li
                      key={position.positionKey}
                      className="flex min-w-0 items-center justify-between gap-3 py-2"
                    >
                      <div className="grid min-w-0 gap-0.5">
                        <span className="truncate text-sm text-fg">{chapterTitle}</span>
                        <span className="truncate font-mono text-xs text-fg-muted">
                          {position.path}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Study ${chapterTitle}: ${position.path}`}
                        disabled={!titles.has(position.chapterId)}
                        onClick={() =>
                          onStudy({ chapterId: position.chapterId, nodeId: position.nodeId })
                        }
                      >
                        <BookOpen />
                        Study
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {retry ? (
            <p className="text-xs text-fg-muted">
              Retry missed is extra practice: this session&apos;s answers stay as recorded, and the
              retry changes no schedule — each decision&apos;s next review stays as your first
              answer set it.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {retry ? (
              <Button type="button" variant="primary" onClick={retry}>
                <RefreshCcw />
                Retry missed
              </Button>
            ) : null}
            {onRehearseAgain ? (
              <Button
                type="button"
                variant={retry ? "outline" : "primary"}
                onClick={onRehearseAgain}
              >
                <Route />
                Rehearse again
              </Button>
            ) : null}
            <Button
              type="button"
              variant={retry || onRehearseAgain ? "outline" : "primary"}
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
