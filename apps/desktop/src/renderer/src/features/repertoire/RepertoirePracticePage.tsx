import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  GraduationCap,
  Lightbulb,
  Loader2,
  Play,
  RotateCcw,
  Route,
  SkipForward,
  Square
} from "lucide-react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import type { Color } from "@chaturanga/shared/types/chess";
import type {
  PracticeAction,
  PracticeCard,
  PracticeMode,
  PracticeSessionSnapshot,
  RepertoireDetail,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Stat, StatGroup } from "@/components/ui/stat";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import {
  useEndPracticeMutation,
  useRecordAttemptMutation,
  useRecordPracticeActionMutation,
  useRepertoireQuery,
  useResumePracticeMutation,
  useSaveRepertoireWorkspaceMutation,
  useStartPracticeMutation
} from "../../queries/repertoire";
import {
  currentCard,
  rehearsalStepNumber,
  rehearsalTitle,
  useRepertoirePracticeStore
} from "../../stores/repertoire-practice-store";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useLichessStore } from "../../stores/lichess-store";
import { LIVE_GAME_NOTICE, repertoireCommandBlocked } from "./handoffs";
import { usePrefersReducedMotion } from "../board/board-motion";
import { BoardStage, BoardWorkspace } from "../board/BoardWorkspace";
import { ControlledBoard, TypedMoveButton, type TypedMoveControl } from "../board/ControlledBoard";
import { PracticeSetup, initialPracticeInput } from "./PracticeSetup";
import {
  autoStartPracticeInput,
  rehearsePreset,
  savesPracticeDraft,
  type PracticePreset
} from "./practice-setup";
import { PracticeSummaryView } from "./PracticeSummaryView";
import {
  hintMarks,
  hintStageText,
  lastMoveOf,
  nextUnansweredIndex,
  revealArrows,
  revealText
} from "./repertoire-model";

/** How long a correct answer stays on screen before the next card. */
const ADVANCE_DELAY_MS = 600;
/** Rehearsal: the brief confirmation before the authored reply is played. */
const REHEARSAL_CONFIRM_MS = 450;
/** Rehearsal: how long the reply stays on the board (its motion included) before the next step. */
const REHEARSAL_REPLY_MS = 650;
/** Rehearsal: how long "Line complete" shows before the next line starts. */
const LINE_ADVANCE_MS = 900;
const REPLAY_STEP_MS = 700;
const REPLAY_STEP_REDUCED_MS = 250;

const practice = () => useRepertoirePracticeStore.getState();

/**
 * Repertoire practice (design §5.3): setup, then one hidden-answer decision at a time (no tree,
 * notes or authored arrows; a safe prompt may show), then a summary. The main process grades every
 * move and persists hints, reveals and skips before the page shows their result; a failed write
 * keeps the card and offers Retry.
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
  /** "Rehearse again": a new rehearsal started from a preset (a new step in history). */
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
  const start = useStartPracticeMutation();
  const resume = useResumePracticeMutation();
  const endFinished = useEndPracticeMutation();
  const { mutate: endFinishedSession } = endFinished;
  /** The finished session whose summary was asked for (once; Retry asks again). */
  const summaryRequested = useRef<string | null>(null);
  // Revisiting a session (its summary since replaced by another's) asks for its summary again.
  useEffect(() => {
    summaryRequested.current = null;
  }, [sessionId]);
  const saveWorkspace = useSaveRepertoireWorkspaceMutation();
  const [nothingDue, setNothingDue] = useState<PracticeMode | null>(null);
  /** An auto-started targeted queue found nothing to practise (the setup shows why). */
  const [targetEmpty, setTargetEmpty] = useState(false);
  /** The targeted preset already started (once per preset; Back to it never restarts it). */
  const [autoStarted, setAutoStarted] = useState<PracticePreset | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const shownSession = session && session.sessionId === sessionId ? session : null;
  const { mutate: resumeSession } = resume;
  const finishedWithoutSummary =
    shownSession?.status === "finished" && summary?.sessionId !== shownSession.sessionId;

  // A session that already ended (Back after "Practice again", a restart) is never shown as live:
  // ending it again is idempotent and returns its summary.
  useEffect(() => {
    if (!finishedWithoutSummary || !shownSession) return;
    if (summaryRequested.current === shownSession.sessionId) return;
    summaryRequested.current = shownSession.sessionId;
    endFinishedSession(shownSession.sessionId, {
      onSuccess: (result) => practice().setSummary(result),
      onError: (error) =>
        setResumeError(ipcErrorMessage(error) || "That session's summary couldn't be read.")
    });
  }, [finishedWithoutSummary, shownSession, endFinishedSession]);

  // Opening a session's route (history, a restart): resume it from the main process.
  useEffect(() => {
    if (!sessionId || !desktop) return;
    if (practice().session?.sessionId === sessionId) return;
    // A Lichess game being played: nothing trains until it ends (the route is guarded in App too).
    if (repertoireCommandBlocked(useLichessStore.getState(), "resume-practice")) return;
    setResumeError(null);
    resumeSession(sessionId, {
      onSuccess: (snapshot) => practice().setSession(snapshot),
      onError: (error) => setResumeError(ipcErrorMessage(error) || "That session can't be resumed.")
    });
  }, [sessionId, desktop, resumeSession]);

  const startSession = useEventCallback((input: StartPracticeInput, fromPreset?: boolean) => {
    if (repertoireCommandBlocked(useLichessStore.getState(), "start-practice")) {
      useAppNoticeStore.getState().show(LIVE_GAME_NOTICE, { tone: "info" });
      return;
    }
    setNothingDue(null);
    setTargetEmpty(false);
    const loaded = detail.data;
    const targeted = Boolean(input.positionKeys?.length);
    if (loaded && savesPracticeDraft(input, fromPreset === true)) {
      saveWorkspace.mutate({
        repertoireId,
        workspace: {
          lastChapterId: loaded.workspace?.lastChapterId ?? null,
          lastNodeId: loaded.workspace?.lastNodeId ?? null,
          orientation: loaded.workspace?.orientation ?? loaded.color,
          practiceDraft: input
        },
        practiceSetup: true
      });
    }
    start.mutate(input, {
      onSuccess: (snapshot) => {
        if (!snapshot.cards.length) {
          if (targeted) setTargetEmpty(true);
          else setNothingDue(input.mode);
          return;
        }
        practice().setSession(snapshot);
        onSessionStarted(snapshot.sessionId);
      }
    });
  });

  // "Refresh this decision" / "Rehearse from here": the preset's session starts as soon as the
  // repertoire is known.
  const loadedId = detail.data?.id ?? null;
  const targetedInput = useMemo(
    () => (loadedId && !sessionId ? autoStartPracticeInput(loadedId, preset) : null),
    [loadedId, sessionId, preset]
  );
  const autoStartPending = Boolean(targetedInput && autoStarted !== preset);
  /** Set before starting, so StrictMode's repeated effect can't start a second session. */
  const autoStartedRef = useRef<PracticePreset | null>(null);
  useEffect(() => {
    if (!targetedInput || autoStarted === preset || autoStartedRef.current === preset) return;
    autoStartedRef.current = preset;
    setAutoStarted(preset);
    startSession(targetedInput, true);
  }, [targetedInput, autoStarted, preset, startSession]);

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
    const rehearsed = shownSession?.mode === "rehearse-lines" ? shownSession.scope : null;
    return (
      <PracticeSummaryView
        detail={detail.data}
        summary={summary}
        cards={shownSession?.cards ?? []}
        note={endNote}
        onStudy={onStudy}
        onAgain={onSetup}
        onRehearseAgain={
          rehearsed?.rehearse
            ? () => onRehearse(rehearsePreset(rehearsed.rehearse!, rehearsed.maxDepthPlies))
            : undefined
        }
      />
    );
  }

  if ((sessionId && !shownSession) || finishedWithoutSummary) {
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

  if (autoStartPending || (targetedInput && start.isPending)) {
    return <Spinner label="Starting practice" />;
  }

  return (
    <PracticeSetup
      key={detail.data.id}
      detail={detail.data}
      initial={initialPracticeInput(detail.data, preset)}
      starting={start.isPending}
      error={
        start.error
          ? ipcErrorMessage(start.error) || "Couldn't start practice."
          : targetEmpty
            ? "That decision has nothing to practise right now (it may be paused or no longer among your choices). Set up a session below instead."
            : null
      }
      nothingDue={nothingDue}
      onStart={startSession}
    />
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="grid place-items-center" role="status" aria-label={label}>
      <Loader2 className="size-5 animate-spin text-fg-subtle" />
    </div>
  );
}

type PendingAttempt = { uci: string; attemptId: string; fenAfter: string };

/** What Retry repeats after a failed write (the same attempt id keeps a resubmission idempotent). */
type RetryTarget =
  | { kind: "attempt"; attempt: PendingAttempt }
  | { kind: "action"; action: PracticeAction["kind"] }
  | { kind: "finish" };

/** One running session: the hidden-answer board and the card's controls. */
function PracticeSession({
  detail,
  session,
  onRehearse
}: {
  detail: RepertoireDetail;
  session: PracticeSessionSnapshot;
  /** "Rehearse it from <chapter>": a rehearsal of another chapter from an occurrence there. */
  onRehearse: (preset: PracticePreset) => void;
}) {
  const card = currentCard(session)!;
  const {
    hint,
    hintUci,
    message,
    reveal,
    leadUpIndex,
    orientation,
    rehearsal,
    otherLine,
    lineEnded
  } = useRepertoirePracticeStore(
    useShallow((state) => ({
      hint: state.hint,
      hintUci: state.hintUci,
      message: state.message,
      reveal: state.reveal,
      leadUpIndex: state.leadUpIndex,
      orientation: state.orientation,
      rehearsal: state.rehearsal,
      otherLine: state.otherLine,
      lineEnded: state.lineEnded
    }))
  );
  const rehearsing = session.mode === "rehearse-lines";
  const recordAttempt = useRecordAttemptMutation();
  const recordAction = useRecordPracticeActionMutation();
  const endPractice = useEndPracticeMutation();
  const resume = useResumePracticeMutation();
  const reducedMotion = usePrefersReducedMotion();
  /** The submitted move shown while the main process grades it (cleared unless correct). */
  const [pending, setPending] = useState<PendingAttempt | null>(null);
  /** The board's typed-move entry, opened from the button in the footer. */
  const [typedMove, setTypedMove] = useState<TypedMoveControl | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: RetryTarget } | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const color: Color = detail.color;

  // Per-card state resets when the card changes.
  const [shownCard, setShownCard] = useState(card.queueItemId);
  if (shownCard !== card.queueItemId) {
    setShownCard(card.queueItemId);
    setPending(null);
    setFailed(null);
  }

  const finish = useEventCallback(() => {
    setFailed(null);
    endPractice.mutate(session.sessionId, {
      onSuccess: (result) => practice().setSummary(result),
      onError: (error) =>
        setFailed({
          message: ipcErrorMessage(error) || "Couldn't finish the session.",
          retry: { kind: "finish" }
        })
    });
  });

  const goNext = useEventCallback(() => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    if (practice().advance()) return;
    if (!rehearsing) {
      finish();
      return;
    }
    // A rehearsal's queue grows in the main process: ask it whether another line is waiting
    // before finishing.
    setFailed(null);
    resume.mutate(session.sessionId, {
      onSuccess: (snapshot) => {
        const index = snapshot.cards.findIndex((item) => item.state === "unanswered");
        if (snapshot.status === "active" && index >= 0) {
          practice().setSession({ ...snapshot, cursor: index });
        } else finish();
      },
      onError: () => finish()
    });
  });

  // Rehearsal: a brief confirmation, then the authored reply on the board (the board animates a
  // one-move change unless motion is reduced), then the next decision or the line's end. With
  // reduced motion the step is presented at once. Timers are cancelled when leaving the page.
  useEffect(() => {
    if (!rehearsal?.auto || lineEnded) return;
    const reply = rehearsal.step.reply;
    if (reducedMotion) {
      practice().presentStep();
      return;
    }
    const timer = window.setTimeout(
      () => (reply && !rehearsal.replyShown ? practice().showReply() : practice().presentStep()),
      reply && rehearsal.replyShown ? REHEARSAL_REPLY_MS : REHEARSAL_CONFIRM_MS
    );
    return () => window.clearTimeout(timer);
  }, [rehearsal, lineEnded, reducedMotion]);

  // Rehearsal: "Line complete" moves on to the next line by itself unless motion is reduced (then
  // "Next line" waits for the player).
  useEffect(() => {
    if (!lineEnded || reducedMotion) return;
    advanceTimer.current = window.setTimeout(goNext, LINE_ADVANCE_MS);
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    };
  }, [lineEnded, reducedMotion, goNext]);

  // A correct answer moves on by itself after a moment (cancelled when leaving the page).
  useEffect(() => {
    if (rehearsing) return;
    if (card.state !== "answered-correct" || message?.tone !== "success") return;
    advanceTimer.current = window.setTimeout(goNext, ADVANCE_DELAY_MS);
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    };
  }, [rehearsing, card.state, card.queueItemId, message, goNext]);

  // Lead-up replay: one move per step, then back to the card's position.
  useEffect(() => {
    if (leadUpIndex === null) return;
    const timer = window.setTimeout(
      () =>
        practice().setLeadUpIndex(leadUpIndex + 1 < card.leadUp.length ? leadUpIndex + 1 : null),
      reducedMotion ? REPLAY_STEP_REDUCED_MS : REPLAY_STEP_MS
    );
    return () => window.clearTimeout(timer);
  }, [leadUpIndex, card.leadUp.length, reducedMotion]);

  const submit = useEventCallback((attempt: PendingAttempt) => {
    setFailed(null);
    setPending(attempt);
    recordAttempt.mutate(
      {
        sessionId: session.sessionId,
        queueItemId: card.queueItemId,
        attemptId: attempt.attemptId,
        uci: attempt.uci
      },
      {
        onSuccess: (result) => {
          practice().applyAttempt(result);
          // A correct move stays on the board; so does another line's choice, until the player
          // follows it or tries again.
          if (result.outcome !== "correct" && result.outcome !== "other-line") setPending(null);
        },
        onError: (error) => {
          // Not graded: the card stays, the same attempt id makes the retry idempotent.
          setPending(null);
          setFailed({
            message: ipcErrorMessage(error) || "Your move couldn't be recorded.",
            retry: { kind: "attempt", attempt }
          });
        }
      }
    );
  });

  const onMove = useEventCallback((uci: string, _san: string, fenAfter: string) => {
    submit({ uci, attemptId: nanoid(), fenAfter });
  });

  const act = useEventCallback((kind: PracticeAction["kind"]) => {
    setFailed(null);
    recordAction.mutate(
      { sessionId: session.sessionId, queueItemId: card.queueItemId, action: { kind } },
      {
        onSuccess: (result) => {
          practice().applyAction(kind, result);
          if (kind === "skip") goNext();
        },
        onError: (error) =>
          setFailed({
            message: ipcErrorMessage(error) || "That couldn't be saved.",
            retry: { kind: "action", action: kind }
          })
      }
    );
  });

  const retryFailed = useEventCallback(() => {
    const target = failed?.retry;
    if (target?.kind === "attempt") submit(target.attempt);
    else if (target?.kind === "action") act(target.action);
    else if (target?.kind === "finish") finish();
  });

  const tryAgain = useEventCallback(() => {
    setPending(null);
    practice().dismissOtherLine();
  });

  const replaying = leadUpIndex !== null;
  const finished = card.state !== "unanswered";
  /** A rehearsal step, an other-line choice or a line's end holds the board still. */
  const held = Boolean(rehearsal || otherLine || lineEnded);
  const shownReply = rehearsal?.replyShown ? rehearsal.step.reply : null;
  // After a wrong first answer the card stays playable (ungraded retries) until it's revealed or
  // answered correctly; the grade was fixed by the first answer.
  const retrying = card.state === "answered-wrong" && !reveal;
  const canAnswer = (!finished || retrying) && !held;
  const busy =
    recordAttempt.isPending || recordAction.isPending || endPractice.isPending || resume.isPending;
  const fen = replaying
    ? card.leadUp[leadUpIndex]!.fen
    : (shownReply?.fen ?? pending?.fenAfter ?? card.fen);
  const lastMove = replaying
    ? lastMoveOf(card.leadUp[leadUpIndex]?.uci)
    : shownReply
      ? lastMoveOf(shownReply.uci)
      : pending
        ? lastMoveOf(pending.uci)
        : lastMoveOf(card.leadUp[card.leadUp.length - 1]?.uci);
  const marks = useMemo(() => {
    if (replaying) return { arrows: [], highlights: [] };
    if (reveal) return { arrows: revealArrows(reveal.ucis, reveal.preferredUci), highlights: [] };
    return hintMarks(card.hintStage, hintUci);
  }, [replaying, reveal, card.hintStage, hintUci]);
  const position = session.cards.indexOf(card) + 1;
  const chapterTitles = new Map(detail.chapters.map((chapter) => [chapter.id, chapter.title]));
  const rehearsedChapterId = session.scope.rehearse?.chapterId ?? card.chapterId;
  const chapterTitle = chapterTitles.get(card.chapterId) ?? "Chapter";
  const nextHintLabel = ["Hint", "Show piece", "Show move"][card.hintStage] ?? null;
  // Words for what the board shows (arrows and highlights alone aren't accessible).
  const boardHintText = reveal ? null : hintStageText(card.fen, card.hintStage, hintUci);
  const revealWords = reveal ? revealText(card.fen, reveal.ucis, reveal.preferredUci) : null;
  // Every card is final: the next step is the summary.
  const allFinal = nextUnansweredIndex(session.cards, session.cursor) < 0 && finished;
  // A correct answer moves on by itself only right after it was given (not on a resumed card).
  const autoAdvancing = rehearsing
    ? Boolean(rehearsal?.auto)
    : card.state === "answered-correct" && message?.tone === "success";
  // Rehearsal: the footer's way on — continue after a reveal, skip the line after a move outside
  // the repertoire (the board stays playable to try again), the next line after an ended one (or
  // a skipped / stale card), or the summary.
  const rehearsalNext: { label: string; onClick: () => void } | null = !rehearsing
    ? null
    : rehearsal && !rehearsal.auto && !lineEnded
      ? { label: "Continue line", onClick: () => practice().continueStep() }
      : retrying && !held
        ? { label: "Skip this line", onClick: () => act("skip") }
        : lineEnded || (finished && !rehearsal && !otherLine)
          ? { label: "Next line", onClick: goNext }
          : null;

  return (
    <BoardWorkspace
      panelLabel="Practice"
      board={
        <BoardStage
          top={
            <p className="flex h-8 min-w-0 items-center text-sm text-fg-secondary">
              {rehearsing ? (
                <span className="truncate">
                  {rehearsalTitle(chapterTitle, session.cards, card)}
                </span>
              ) : (
                <>
                  {card.stage === "new" ? "New decision" : "Review"} ·{" "}
                  {color === "white" ? "White" : "Black"} to play
                </>
              )}
            </p>
          }
          bottom={
            <p className="flex h-8 items-center text-xs text-fg-muted">
              {replaying
                ? `Lead-up move ${leadUpIndex + 1} of ${card.leadUp.length}`
                : "Play your move on the board"}
            </p>
          }
        >
          <ControlledBoard
            fen={fen}
            orientation={orientation}
            movable={canAnswer && !replaying && !pending && !busy ? color : "none"}
            lastMove={lastMove}
            arrows={marks.arrows}
            highlights={marks.highlights}
            onMove={onMove}
            keyboardInput
            onTypedMoveChange={setTypedMove}
          />
        </BoardStage>
      }
      summary={
        rehearsing ? (
          <StatGroup className="w-full">
            <Stat label="Progress" value={`step ${rehearsalStepNumber(card)}`} />
            <Stat label="Correct" value={String(session.totals.correct)} />
            <Stat label="Missed" value={String(session.totals.wrong + session.totals.revealed)} />
          </StatGroup>
        ) : (
          <StatGroup className="w-full">
            <Stat label="Card" value={`${position} of ${session.cards.length}`} />
            <Stat label="Correct" value={String(session.totals.correct)} />
            <Stat label="Left" value={String(session.totals.remaining)} />
          </StatGroup>
        )
      }
      notices={
        failed ? (
          <Notice
            tone="danger"
            action={
              <Button type="button" variant="outline" size="xs" onClick={retryFailed}>
                Retry
              </Button>
            }
          >
            {failed.message}
          </Notice>
        ) : null
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={finish}>
              <Square />
              End session
            </Button>
            <TypedMoveButton typedMove={typedMove} />
          </div>
          {rehearsalNext ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={rehearsalNext.onClick}
            >
              {rehearsalNext.label}
              <SkipForward />
            </Button>
          ) : !rehearsing && finished && !autoAdvancing ? (
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={goNext}>
              {allFinal ? "See summary" : "Next card"}
              <SkipForward />
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3">
        {card.prompt ? (
          <section aria-label="Prompt" className="grid gap-1">
            <p className="text-xs text-fg-muted">Prompt</p>
            <p className="text-sm text-fg">{card.prompt}</p>
          </section>
        ) : null}

        <div aria-live="polite" className="grid gap-2">
          {message ? (
            <Notice
              tone={
                message.tone === "warn" ? "warn" : message.tone === "success" ? "success" : "info"
              }
              appear
            >
              {message.text}
              {message.feedback ? (
                <span className="block text-fg-muted">{message.feedback}</span>
              ) : null}
              {otherLine ? (
                <span className="block text-fg-muted">
                  In {otherLine.chapterTitle}:{" "}
                  <span className="font-mono">{otherLine.path || "the start"}</span>
                </span>
              ) : null}
            </Notice>
          ) : null}
          {card.hintStage >= 1 && hint && !reveal ? (
            <Notice tone="info" icon={<Lightbulb />} title="Hint">
              {hint}
            </Notice>
          ) : null}
          {boardHintText ? (
            <Notice tone="info" icon={<Lightbulb />} title="On the board">
              {boardHintText}
            </Notice>
          ) : null}
          {revealWords ? (
            <Notice tone="info" icon={<Eye />} title="Answer">
              {revealWords}
            </Notice>
          ) : null}
          {reveal?.explanation ? (
            <Notice tone="info" title="Why">
              {reveal.explanation}
            </Notice>
          ) : null}
        </div>

        {otherLine ? (
          <div className="flex flex-wrap gap-2">
            {otherLine.chapterId === rehearsedChapterId ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => act("follow-other-line")}
              >
                <Route />
                Follow that line
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onRehearse(
                    rehearsePreset(
                      { chapterId: otherLine.chapterId, fromNodeId: otherLine.nodeId },
                      session.scope.maxDepthPlies
                    )
                  )
                }
              >
                <Route />
                Rehearse it from {otherLine.chapterTitle}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={tryAgain}>
              <RotateCcw />
              Try again
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {card.leadUp.length && !held ? (
            replaying ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => practice().setLeadUpIndex(null)}
              >
                Skip replay
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => practice().setLeadUpIndex(0)}
              >
                <Play />
                Replay lead-up
              </Button>
            )
          ) : null}
          {canAnswer ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || replaying || !nextHintLabel}
                onClick={() => act("hint")}
              >
                <Lightbulb />
                {nextHintLabel ?? "No more hints"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || replaying}
                onClick={() => act("reveal")}
              >
                <Eye />
                Reveal
              </Button>
              {finished ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || replaying}
                  onClick={() => act("skip")}
                >
                  <SkipForward />
                  {rehearsing ? "Skip this line" : "Skip"}
                </Button>
              )}
            </>
          ) : null}
        </div>
        <CardStatus card={card} retrying={retrying} />
      </div>
    </BoardWorkspace>
  );
}

/** A plain sentence for the card's state (text, not colour alone). */
function CardStatus({ card, retrying }: { card: PracticeCard; retrying: boolean }) {
  const text: Record<PracticeCard["state"], string> = {
    unanswered: card.attemptsSoFar
      ? `${card.attemptsSoFar} attempt${card.attemptsSoFar === 1 ? "" : "s"} so far`
      : "",
    "answered-correct": card.hintStage ? "Answered with a hint (assisted)." : "Answered unaided.",
    "answered-wrong": retrying ? "Missed — try again, or reveal the answer." : "Missed.",
    revealed: "Revealed — counts as missed.",
    skipped: "Skipped."
  };
  return text[card.state] ? <p className="text-xs text-fg-muted">{text[card.state]}</p> : null;
}
