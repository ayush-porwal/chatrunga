import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, GraduationCap, Loader2, RotateCcw, Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { RepertoireDetail, StartPracticeInput } from "@chaturanga/shared/types/repertoire";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useRepertoireQuery } from "../../queries/repertoire";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { PracticeEmptyState } from "./PracticeEmptyState";
import { PracticeSession } from "./PracticeSession";
import {
  explainedChapterIds,
  presetPracticeInput,
  returnTabOf,
  type PracticePreset
} from "./practice-setup";
import { isEmptyTargetedStart, type PracticeStart } from "./practice-start";
import { PracticeSummaryView } from "./PracticeSummaryView";
import { RepertoireSettingsDialog } from "./RepertoireSettingsDialog";
import { usePracticeResume } from "./usePracticeResume";
import { useAutoStart, usePracticeStart } from "./usePracticeStart";

/**
 * Repertoire practice (design §5.3): one entry. Practice starts a session at once — the preset's
 * (a targeted queue, a rehearsal) or what the repertoire's settings start (due positions first,
 * then new ones; or a chapter's lines) — then shows one hidden-answer decision at a time (no tree,
 * notes or authored arrows; a safe prompt may show), then a summary. The main process grades
 * every move and persists hints, reveals and skips before the page shows their result; a failed
 * write keeps the card and offers Retry. A start with nothing to ask says why, with the way to
 * Study and to the settings (the cog, as in Study).
 */
export function RepertoirePracticePage({
  repertoireId,
  sessionId,
  preset,
  onSessionStarted,
  onAgain,
  onStudy,
  onRehearse,
  onReturnToHub
}: {
  repertoireId: string;
  sessionId: string | null;
  /** The session to start (an empty preset: the repertoire's practice settings). */
  preset: PracticePreset | null;
  onSessionStarted: (sessionId: string) => void;
  /** Practice again: a new session with the settings, as a new step in history. */
  onAgain: () => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  /**
   * A new session from a preset, as a new step in history: "Rehearse again", "Retry missed" (the
   * missed decisions as a targeted queue), or another line's chapter.
   */
  onRehearse: (preset: PracticePreset) => void;
  /** Back to the Repertoire tab the session was started from (Practice, Insights). */
  onReturnToHub: (tab: RepertoireHubTab) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const detail = useRepertoireQuery(repertoireId);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const showing = useMemo(() => ({ sessionId, preset }), [sessionId, preset]);
  const { startState, startSession } = usePracticeStart({ showing, onSessionStarted });
  const autoStart = useAutoStart({
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

  const openSettings = () => setSettingsOpen(true);
  const settingsDialog = settingsOpen ? (
    <RepertoireSettingsDialog
      detail={detail.data}
      onClose={() => setSettingsOpen(false)}
      onSaved={(saved) => {
        const input = restartInput(startState, preset, saved);
        if (input) startSession(input);
      }}
    />
  ) : null;
  const withSettings = (page: ReactNode) => (
    <>
      {page}
      {settingsDialog}
    </>
  );

  if (summary && summary.sessionId === sessionId) {
    return withSettings(
      <PracticeSummaryView
        detail={detail.data}
        summary={summary}
        session={shownSession}
        note={endNote}
        onStudy={onStudy}
        onAgain={onAgain}
        onRehearse={onRehearse}
        onSettings={openSettings}
        returnTab={returnTabOf(preset)}
        onReturnToHub={onReturnToHub}
      />
    );
  }

  if (resuming) return <Resuming error={resumeError} onAgain={onAgain} />;

  if (shownSession) {
    return withSettings(
      <PracticeSession
        key={shownSession.sessionId}
        detail={detail.data}
        session={shownSession}
        onRehearse={onRehearse}
        onSettings={openSettings}
      />
    );
  }

  if (startState.status === "failed" || startState.status === "empty") {
    return withSettings(
      <StartFeedback
        detail={detail.data}
        startState={startState}
        currentInput={autoStart.input}
        onStart={startSession}
        onStudy={onStudy}
        onSettings={openSettings}
      />
    );
  }

  return <Spinner label={autoStart.pending ? "Starting practice" : "Loading practice"} />;
}

/**
 * After the settings are saved: a start that failed or found nothing starts again with them,
 * when they decide what it starts (not a preset's own session). Null: nothing to restart.
 */
function restartInput(
  startState: PracticeStart,
  preset: PracticePreset | null,
  saved: RepertoireDetail
): StartPracticeInput | null {
  if (!preset || (startState.status !== "failed" && startState.status !== "empty")) return null;
  const next = presetPracticeInput(saved, preset);
  return next.followsSettings ? next.input : null;
}

/**
 * A start that failed (why, Try again: what the navigation starts with the settings now,
 * `currentInput`) or found nothing to ask (why, and the ways on).
 */
function StartFeedback({
  detail,
  startState,
  currentInput,
  onStart,
  onStudy,
  onSettings
}: {
  detail: RepertoireDetail;
  startState: Extract<PracticeStart, { status: "failed" | "empty" }>;
  currentInput: StartPracticeInput | null;
  onStart: (input: StartPracticeInput) => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  onSettings: () => void;
}) {
  if (startState.status === "failed") {
    return (
      <EmptyState
        className="self-center"
        icon={<CircleAlert />}
        title="Practice couldn't start"
        description={startState.message}
        action={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => onStart(currentInput ?? startState.input)}
            >
              <RotateCcw />
              Try again
            </Button>
            <SettingsButton onClick={onSettings} />
          </div>
        }
      />
    );
  }
  return (
    <NothingToPractise
      detail={detail}
      input={startState.input}
      targeted={isEmptyTargetedStart(startState)}
      onLearnNew={() => onStart({ ...startState.input, mode: "learn-new" })}
      onStudy={onStudy}
      onSettings={onSettings}
    />
  );
}

/** A start with nothing to ask: why (the chapter in question, or what the mode found). */
function NothingToPractise({
  detail,
  input,
  targeted,
  onLearnNew,
  onStudy,
  onSettings
}: {
  detail: RepertoireDetail;
  input: StartPracticeInput;
  /** A targeted queue ("Refresh this decision") came back empty. */
  targeted: boolean;
  onLearnNew: () => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
  onSettings: () => void;
}) {
  const chapterIds = targeted ? [] : explainedChapterIds(detail, input);
  return (
    <div className="mx-auto grid w-full max-w-xl content-center gap-3 px-(--page-gutter) py-(--page-gutter-y)">
      <h1 className="sr-only">Practice {detail.name}</h1>
      {targeted ? (
        <EmptyState
          icon={<GraduationCap />}
          title="Nothing to practise there"
          description="That decision has nothing to practise right now: it may be paused or no longer among your choices."
        />
      ) : (
        <PracticeEmptyState
          detail={detail}
          mode={input.mode}
          chapterIds={chapterIds}
          scopeLarger={(input.chapterIds?.length ?? 0) > chapterIds.length}
          starting={false}
          onLearnNew={onLearnNew}
          onStudy={onStudy}
        />
      )}
      <div className="flex justify-center">
        <SettingsButton onClick={onSettings} />
      </div>
    </div>
  );
}

/** Resuming a session named by the route: a spinner, or why it can't be resumed. */
function Resuming({ error, onAgain }: { error: string | null; onAgain: () => void }) {
  return error ? (
    <EmptyState
      className="self-center"
      icon={<GraduationCap />}
      title="This practice session can't be resumed"
      description={`${error} Its completed answers are kept.`}
      action={
        <Button type="button" variant="primary" onClick={onAgain}>
          Start a new session
        </Button>
      }
    />
  ) : (
    <Spinner label="Resuming practice" />
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onClick}>
      <Settings />
      Practice settings
    </Button>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="grid place-items-center" role="status" aria-label={label}>
      <Loader2 className="size-5 animate-spin text-fg-subtle" />
    </div>
  );
}
