import { GraduationCap, Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { StartPracticeInput } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useRepertoireQuery } from "../../queries/repertoire";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { PracticeSession } from "./PracticeSession";
import { PracticeSetup } from "./PracticeSetup";
import { initialPracticeInput, type PracticePreset } from "./practice-setup";
import { isEmptyTargetedStart, startShowsSpinner, type PracticeStart } from "./practice-start";
import { PracticeSummaryView } from "./PracticeSummaryView";
import { usePracticeResume } from "./usePracticeResume";
import { usePracticeStart, usePresetAutoStart } from "./usePracticeStart";

/**
 * Repertoire practice (design §5.3): setup, then one hidden-answer decision at a time (no tree,
 * notes or authored arrows; a safe prompt may show), then a summary. The main process grades every
 * move and persists hints, reveals and skips before the page shows their result; a failed write
 * keeps the card and offers Retry. Once a card is decided its answer shows with the authored notes
 * (the explanation, the accepted moves' comments); Next, Space or Enter moves on, and a correct
 * answer with nothing to read moves on by itself when auto-advance is on (the setup's "Next card").
 */
export function RepertoirePracticePage({
  repertoireId,
  sessionId,
  preset,
  onSessionStarted,
  onSetup,
  onStudy,
  onRehearse
}: {
  repertoireId: string;
  sessionId: string | null;
  /** Chapters / mode to preselect (e.g. "Practice this chapter"), or a targeted queue to start. */
  preset: PracticePreset | null;
  onSessionStarted: (sessionId: string) => void;
  /** Back to the setup (a new session). */
  onSetup: () => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  /**
   * A new session started from a preset, as a new step in history: "Rehearse again", or "Retry
   * missed" (the missed decisions as a targeted queue).
   */
  onRehearse: (preset: PracticePreset) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const detail = useRepertoireQuery(repertoireId);
  const { session, summary, endNote } = useRepertoirePracticeStore(
    useShallow((state) => ({
      session: state.session,
      summary: state.summary,
      endNote: state.endNote
    }))
  );
  const shownSession = session && session.sessionId === sessionId ? session : null;
  const { resumeError, resuming } = usePracticeResume({
    sessionId,
    desktop,
    shownSession,
    summary
  });
  const { startState, startSession } = usePracticeStart({
    repertoireId,
    detail: detail.data,
    onSessionStarted
  });
  const autoStartPending = usePresetAutoStart({
    detail: detail.data,
    sessionId,
    preset,
    startSession
  });

  if (!desktop) {
    return (
      <EmptyState
        className="self-center"
        icon={<GraduationCap />}
        title="Practice needs the desktop app"
        description="Practice results are graded and saved by the app."
      />
    );
  }
  if (!detail.data) {
    return detail.isError ? (
      <EmptyState className="self-center" title="That repertoire no longer exists." />
    ) : (
      <Spinner label="Loading repertoire" />
    );
  }

  if (summary && summary.sessionId === sessionId) {
    return (
      <PracticeSummaryView
        detail={detail.data}
        summary={summary}
        session={shownSession}
        note={endNote}
        onStudy={onStudy}
        onAgain={onSetup}
        onRehearse={onRehearse}
      />
    );
  }

  if (resuming) {
    return resumeError ? (
      <EmptyState
        className="self-center"
        icon={<GraduationCap />}
        title="This practice session can't be resumed"
        description={`${resumeError} Its completed answers are kept.`}
        action={
          <Button type="button" variant="primary" onClick={onSetup}>
            Start a new session
          </Button>
        }
      />
    ) : (
      <Spinner label="Resuming practice" />
    );
  }

  if (shownSession) {
    return (
      <PracticeSession
        key={shownSession.sessionId}
        detail={detail.data}
        session={shownSession}
        onRehearse={onRehearse}
      />
    );
  }

  if (autoStartPending || startShowsSpinner(startState)) {
    return <Spinner label="Starting practice" />;
  }

  const lastStart = lastStartFeedback(startState);
  return (
    <PracticeSetup
      key={detail.data.id}
      detail={detail.data}
      initial={initialPracticeInput(detail.data, preset)}
      starting={startState.status === "starting"}
      error={lastStart.error}
      empty={lastStart.empty}
      onStart={startSession}
      onStudy={onStudy}
    />
  );
}

/**
 * What the setup says about the last start: why it failed, that a targeted queue came back
 * empty, or the scope and mode that found nothing (`empty`, explained above the form).
 */
function lastStartFeedback(state: PracticeStart): {
  error: string | null;
  empty: StartPracticeInput | null;
} {
  if (state.status === "failed") return { error: state.message, empty: null };
  if (isEmptyTargetedStart(state)) {
    return {
      error:
        "That decision has nothing to practise right now (it may be paused or no longer among your choices). Set up a session below instead.",
      empty: null
    };
  }
  return { error: null, empty: state.status === "empty" ? state.input : null };
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="grid place-items-center" role="status" aria-label={label}>
      <Loader2 className="size-5 animate-spin text-fg-subtle" />
    </div>
  );
}
