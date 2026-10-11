import { useState } from "react";
import { nanoid } from "nanoid";
import type {
  PracticeAction,
  PracticeCard,
  PracticeSessionSnapshot
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import {
  useEndPracticeMutation,
  useRecordAttemptMutation,
  useRecordPracticeActionMutation,
  useResumePracticeMutation
} from "../../queries/repertoire";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import type { PendingAttempt } from "./practice-session-model";
import type { AdvanceTimer } from "./usePracticePacing";

const practice = () => useRepertoirePracticeStore.getState();

/** What Retry repeats after a failed write (the same attempt id keeps a resubmission idempotent). */
type RetryTarget =
  | { kind: "attempt"; attempt: PendingAttempt }
  | { kind: "action"; action: PracticeAction["kind"] }
  | { kind: "finish" };

/**
 * A running session's writes and moves on: answers, hints / reveals / skips, the next card and
 * the end. The main process grades and persists each before the page shows its result; a failed
 * write keeps the card and offers Retry (`failed`). Moving on cancels the pending move on by
 * itself (`advance`).
 */
export function usePracticeSessionCommands(
  session: PracticeSessionSnapshot,
  card: PracticeCard,
  advance: AdvanceTimer
) {
  const rehearsing = session.mode === "rehearse-lines";
  const recordAttempt = useRecordAttemptMutation();
  const recordAction = useRecordPracticeActionMutation();
  const endPractice = useEndPracticeMutation();
  const resume = useResumePracticeMutation();
  /** The submitted move shown while the main process grades it (cleared unless correct). */
  const [pending, setPending] = useState<PendingAttempt | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: RetryTarget } | null>(null);

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
    advance.cancel();
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

  const busy =
    recordAttempt.isPending || recordAction.isPending || endPractice.isPending || resume.isPending;
  return {
    pending,
    failed,
    busy,
    finish,
    goNext,
    onMove,
    act,
    retryFailed,
    tryAgain
  };
}
