import { useId } from "react";
import { BookOpen, RefreshCcw, Route, RotateCcw } from "lucide-react";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type {
  PracticeSessionSnapshot,
  PracticeSummary,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { Stat, StatGroup } from "@/components/ui/stat";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { BoardStage, BoardWorkspace } from "../board/BoardWorkspace";
import { ControlledBoard } from "../board/ControlledBoard";
import { isExtraPractice, summaryPresets, type PracticePreset } from "./practice-setup";
import { PracticeTabBar } from "./PracticeTabBar";
import { missedPositions, type MissedPosition } from "./repertoire-model";

const noMove = () => false;

/**
 * Session summary (§5.3), in the board workspace as Review's: the last position on the board, the
 * recall counts in the panel's summary strip, then the chapters practised and every missed
 * decision with a link to study it; the ways on in the footer. Counts describe decision recall —
 * no "mastered" score. "Retry missed" practises the misses again as ungraded extra practice (a new
 * targeted session: this one's answers stay as they were, and no schedule changes). A line
 * rehearsal also counts lines started and completed and answers that belonged to another line,
 * and offers "Rehearse again" (nothing in it was scheduled).
 */
export function PracticeSummaryView({
  detail,
  summary,
  session,
  onStudy,
  onAgain,
  onRehearse,
  onSettings,
  note
}: {
  detail: RepertoireDetail;
  summary: PracticeSummary;
  /** The finished session, when the page still holds it (its cards place the missed decisions). */
  session: PracticeSessionSnapshot | null;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  onAgain: () => void;
  /** A new session from the summary: "Retry missed" or "Rehearse again". */
  onRehearse: (preset: PracticePreset) => void;
  onSettings: () => void;
  /** Why the session ended early (its chapter changed). */
  note?: string | null;
}) {
  const panelId = useId();
  const orientation = useRepertoirePracticeStore((state) => state.orientation);
  const rehearsal = summary.rehearsal ?? null;
  const { retryMissed, rehearseAgain } = summaryPresets(session, summary);
  const lastFen = session?.cards.at(-1)?.fen ?? START_FEN;
  return (
    <BoardWorkspace
      panelLabel="Practice summary"
      board={
        <BoardStage
          top={<p className="flex h-8 items-center text-sm text-fg-secondary">{detail.name}</p>}
          bottom={<span className="block h-8" />}
        >
          <ControlledBoard fen={lastFen} orientation={orientation} movable="none" onMove={noMove} />
        </BoardStage>
      }
      tabPanel={tabPanelProps(panelId, "practice")}
      tabBar={<PracticeTabBar panelId={panelId} label="Summary" onSettings={onSettings} />}
      flushBody
      summary={
        <StatGroup className="w-full">
          <Stat label="Unaided" value={String(summary.unaided)} />
          <Stat label="With a hint" value={String(summary.assisted)} />
          <Stat label="Missed" value={String(summary.missed)} />
          {rehearsal ? null : <Stat label="Skipped" value={String(summary.skipped)} />}
        </StatGroup>
      }
      footer={
        <SummaryWaysOn
          retry={retryMissed ? () => onRehearse(retryMissed) : undefined}
          onRehearseAgain={rehearseAgain ? () => onRehearse(rehearseAgain) : undefined}
          onAgain={onAgain}
        />
      }
    >
      <SummaryDetails
        detail={detail}
        summary={summary}
        session={session}
        note={note ?? null}
        retryOffered={retryMissed !== null}
        onStudy={onStudy}
      />
    </BoardWorkspace>
  );
}

/**
 * The panel's body: what the counts mean, why the session ended early, a rehearsal's line counts,
 * the chapters practised and the missed positions.
 */
function SummaryDetails({
  detail,
  summary,
  session,
  note,
  retryOffered,
  onStudy
}: {
  detail: RepertoireDetail;
  summary: PracticeSummary;
  session: PracticeSessionSnapshot | null;
  note: string | null;
  retryOffered: boolean;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
}) {
  const titles = new Map(detail.chapters.map((chapter) => [chapter.id, chapter.title]));
  const missed = missedPositions(summary, session?.cards ?? []);
  const rehearsal = summary.rehearsal ?? null;
  // A targeted queue (e.g. a retry of missed decisions) is extra practice; a retry is ungraded:
  // nothing in it was scheduled.
  const extraPractice = Boolean(session && isExtraPractice(session.scope));
  const ungraded = session?.scope.ungraded === true;
  const heading = summaryHeading({ rehearsal: Boolean(rehearsal), extraPractice, ungraded });
  return (
    <section
      className="scroll-area grid h-full min-h-0 content-start gap-4 overflow-y-auto p-3"
      aria-labelledby="practice-summary-title"
    >
      <div className="grid gap-1">
        <h2 id="practice-summary-title" className="text-sm font-semibold text-fg">
          {heading.title}
        </h2>
        <p className="text-xs text-fg-muted">{heading.description}</p>
      </div>
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
      {summary.chapters.length ? (
        <p className="text-xs text-fg-muted">
          Chapters: {summary.chapters.map((id) => titles.get(id) ?? "Removed chapter").join(", ")}
        </p>
      ) : null}
      {missed.length ? (
        <MissedPositionsList missed={missed} titles={titles} onStudy={onStudy} />
      ) : null}
      {retryOffered ? (
        <p className="text-xs text-fg-subtle">
          Retry missed is extra practice: this session&apos;s answers stay as recorded, and the
          retry changes no schedule — each decision&apos;s next review stays as your first answer
          set it.
        </p>
      ) : null}
    </section>
  );
}

/** The summary's title and what its counts mean: a rehearsal and ungraded practice schedule nothing. */
function summaryHeading({
  rehearsal,
  extraPractice,
  ungraded
}: {
  rehearsal: boolean;
  extraPractice: boolean;
  ungraded: boolean;
}): { title: string; description: string } {
  if (rehearsal) {
    return {
      title: "Rehearsal complete",
      description:
        "Results stay in this session: nothing was scheduled. A move from another line isn't a miss."
    };
  }
  return {
    title: extraPractice ? "Extra practice complete" : "Session complete",
    description: ungraded
      ? "Results stay in this session: nothing was scheduled, so each decision's next review is as your first answer left it."
      : "Recall counts each decision once: any accepted move is a correct answer."
  };
}

/** Every missed decision with its chapter and moves, and a link to study it there. */
function MissedPositionsList({
  missed,
  titles,
  onStudy
}: {
  missed: readonly MissedPosition[];
  /** Chapter titles by id: a missed decision in a removed chapter can't be studied. */
  titles: ReadonlyMap<string, string>;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
}) {
  return (
    <section aria-labelledby="practice-missed-title" className="grid gap-1">
      <h3 id="practice-missed-title" className="text-xs font-medium text-fg-secondary">
        Missed positions
      </h3>
      <ul aria-labelledby="practice-missed-title" className="grid divide-y divide-line-subtle">
        {missed.map((position) => {
          const chapterTitle = titles.get(position.chapterId) ?? "Removed chapter";
          return (
            <li
              key={position.positionKey}
              className="flex min-w-0 items-center justify-between gap-3 py-2"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm text-fg">{chapterTitle}</span>
                <span className="truncate font-mono text-xs text-fg-muted">{position.path}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Study ${chapterTitle}: ${position.path}`}
                disabled={!titles.has(position.chapterId)}
                onClick={() => onStudy({ chapterId: position.chapterId, nodeId: position.nodeId })}
              >
                <BookOpen />
                Study
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The ways on from the summary (the footer); the first one offered is the primary action. */
function SummaryWaysOn({
  retry,
  onRehearseAgain,
  onAgain
}: {
  /** Retry missed (only when something was missed). */
  retry: (() => void) | undefined;
  onRehearseAgain: (() => void) | undefined;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2">
      {retry ? (
        <Button type="button" variant="primary" size="sm" onClick={retry}>
          <RefreshCcw />
          Retry missed
        </Button>
      ) : null}
      {onRehearseAgain ? (
        <Button
          type="button"
          variant={retry ? "outline" : "primary"}
          size="sm"
          onClick={onRehearseAgain}
        >
          <Route />
          Rehearse again
        </Button>
      ) : null}
      <Button
        type="button"
        variant={retry || onRehearseAgain ? "outline" : "primary"}
        size="sm"
        onClick={onAgain}
      >
        <RotateCcw />
        Practice again
      </Button>
    </div>
  );
}
