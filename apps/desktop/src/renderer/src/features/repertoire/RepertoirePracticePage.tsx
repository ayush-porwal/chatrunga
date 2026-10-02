import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, GraduationCap, Lightbulb, Loader2, Play, SkipForward, Square } from "lucide-react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import type { Color } from "@chaturanga/shared/types/chess";
import type {
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
import { currentCard, useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { usePrefersReducedMotion } from "../board/board-motion";
import { BoardStage, BoardWorkspace } from "../board/BoardWorkspace";
import { ControlledBoard } from "../board/ControlledBoard";
import { PracticeSetup, initialPracticeInput } from "./PracticeSetup";
import { PracticeSummaryView } from "./PracticeSummaryView";
import { hintMarks, lastMoveOf, revealArrows } from "./repertoire-model";

/** How long a correct answer stays on screen before the next card. */
const ADVANCE_DELAY_MS = 600;
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
  onStudy
}: {
  repertoireId: string;
  sessionId: string | null;
  /** Chapters / mode to preselect (e.g. "Practice this chapter"). */
  preset: { chapterIds?: string[]; mode?: PracticeMode } | null;
  onSessionStarted: (sessionId: string) => void;
  /** Back to the setup (a new session). */
  onSetup: () => void;
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const detail = useRepertoireQuery(repertoireId);
  const { session, summary } = useRepertoirePracticeStore(
    useShallow((state) => ({ session: state.session, summary: state.summary }))
  );
  const start = useStartPracticeMutation();
  const resume = useResumePracticeMutation();
  const saveWorkspace = useSaveRepertoireWorkspaceMutation();
  const [nothingDue, setNothingDue] = useState<PracticeMode | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const shownSession = session && session.sessionId === sessionId ? session : null;
  const { mutate: resumeSession } = resume;

  // Opening a session's route (history, a restart): resume it from the main process.
  useEffect(() => {
    if (!sessionId || !desktop) return;
    if (practice().session?.sessionId === sessionId) return;
    setResumeError(null);
    resumeSession(sessionId, {
      onSuccess: (snapshot) => practice().setSession(snapshot),
      onError: (error) => setResumeError(ipcErrorMessage(error) || "That session can't be resumed.")
    });
  }, [sessionId, desktop, resumeSession]);

  const startSession = useEventCallback((input: StartPracticeInput) => {
    setNothingDue(null);
    const loaded = detail.data;
    if (loaded) {
      saveWorkspace.mutate({
        repertoireId,
        workspace: {
          lastChapterId: loaded.workspace?.lastChapterId ?? null,
          lastNodeId: loaded.workspace?.lastNodeId ?? null,
          orientation: loaded.workspace?.orientation ?? loaded.color,
          practiceDraft: input
        }
      });
    }
    start.mutate(input, {
      onSuccess: (snapshot) => {
        if (!snapshot.cards.length) {
          setNothingDue(input.mode);
          return;
        }
        practice().setSession(snapshot);
        onSessionStarted(snapshot.sessionId);
      }
    });
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
        cards={shownSession?.cards ?? []}
        onStudy={onStudy}
        onAgain={onSetup}
      />
    );
  }

  if (sessionId && !shownSession) {
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
      <PracticeSession key={shownSession.sessionId} detail={detail.data} session={shownSession} />
    );
  }

  return (
    <PracticeSetup
      key={detail.data.id}
      detail={detail.data}
      initial={initialPracticeInput(detail.data, preset)}
      starting={start.isPending}
      error={start.error ? ipcErrorMessage(start.error) || "Couldn't start practice." : null}
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
  | { kind: "action"; action: "hint" | "reveal" | "skip" }
  | { kind: "finish" };

/** One running session: the hidden-answer board and the card's controls. */
function PracticeSession({
  detail,
  session
}: {
  detail: RepertoireDetail;
  session: PracticeSessionSnapshot;
}) {
  const card = currentCard(session)!;
  const { hint, hintUci, message, reveal, leadUpIndex, orientation } = useRepertoirePracticeStore(
    useShallow((state) => ({
      hint: state.hint,
      hintUci: state.hintUci,
      message: state.message,
      reveal: state.reveal,
      leadUpIndex: state.leadUpIndex,
      orientation: state.orientation
    }))
  );
  const recordAttempt = useRecordAttemptMutation();
  const recordAction = useRecordPracticeActionMutation();
  const endPractice = useEndPracticeMutation();
  const reducedMotion = usePrefersReducedMotion();
  /** The submitted move shown while the main process grades it (cleared unless correct). */
  const [pending, setPending] = useState<PendingAttempt | null>(null);
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
    if (!practice().advance()) finish();
  });

  // A correct answer moves on by itself after a moment (cancelled when leaving the page).
  useEffect(() => {
    if (card.state !== "answered-correct" || message?.tone !== "success") return;
    advanceTimer.current = window.setTimeout(goNext, ADVANCE_DELAY_MS);
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    };
  }, [card.state, card.queueItemId, message, goNext]);

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
          if (result.outcome !== "correct") setPending(null);
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

  const act = useEventCallback((kind: "hint" | "reveal" | "skip") => {
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

  const replaying = leadUpIndex !== null;
  const finished = card.state !== "unanswered";
  // After a wrong first answer the card stays playable (ungraded retries) until it's revealed or
  // answered correctly; the grade was fixed by the first answer.
  const retrying = card.state === "answered-wrong" && !reveal;
  const canAnswer = !finished || retrying;
  const busy = recordAttempt.isPending || recordAction.isPending || endPractice.isPending;
  const fen = replaying ? card.leadUp[leadUpIndex]!.fen : (pending?.fenAfter ?? card.fen);
  const lastMove = replaying
    ? lastMoveOf(card.leadUp[leadUpIndex]?.uci)
    : pending
      ? lastMoveOf(pending.uci)
      : lastMoveOf(card.leadUp[card.leadUp.length - 1]?.uci);
  const marks = useMemo(() => {
    if (replaying) return { arrows: [], highlights: [] };
    if (reveal) return { arrows: revealArrows(reveal.ucis, reveal.preferredUci), highlights: [] };
    return hintMarks(card.hintStage, hintUci);
  }, [replaying, reveal, card.hintStage, hintUci]);
  const position = session.cards.indexOf(card) + 1;
  const nextHintLabel = ["Hint", "Show piece", "Show move"][card.hintStage] ?? null;

  return (
    <BoardWorkspace
      panelLabel="Practice"
      board={
        <BoardStage
          top={
            <p className="flex h-8 items-center text-sm text-fg-secondary">
              {card.stage === "new" ? "New decision" : "Review"} ·{" "}
              {color === "white" ? "White" : "Black"} to play
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
          />
        </BoardStage>
      }
      summary={
        <StatGroup className="w-full">
          <Stat label="Card" value={`${position} of ${session.cards.length}`} />
          <Stat label="Correct" value={String(session.totals.correct)} />
          <Stat label="Left" value={String(session.totals.remaining)} />
        </StatGroup>
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
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={finish}>
            <Square />
            End session
          </Button>
          {finished && card.state !== "answered-correct" ? (
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={goNext}>
              Next card
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
            </Notice>
          ) : null}
          {card.hintStage >= 1 && hint && !reveal ? (
            <Notice tone="info" icon={<Lightbulb />} title="Hint">
              {hint}
            </Notice>
          ) : null}
          {reveal?.explanation ? (
            <Notice tone="info" title="Why">
              {reveal.explanation}
            </Notice>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {card.leadUp.length ? (
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
                  Skip
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
