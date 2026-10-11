import { useEffect, useRef, useState } from "react";
import type { PracticeSessionSnapshot, PracticeSummary } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEndPracticeMutation, useResumePracticeMutation } from "../../queries/repertoire";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { useLichessStore } from "../../stores/lichess-store";
import { repertoireCommandBlocked } from "./handoffs";

const practice = () => useRepertoirePracticeStore.getState();

/**
 * The session a practice route names, read back from the main process: a live one is resumed
 * into the practice store, a finished one is asked for its summary. `resuming`: the route's
 * session isn't there yet, or is finished without its summary (`resumeError` says why it can't
 * be shown, if so).
 */
export function usePracticeResume({
  sessionId,
  desktop,
  shownSession,
  summary
}: {
  sessionId: string | null;
  desktop: boolean;
  /** The store's session when it is the route's. */
  shownSession: PracticeSessionSnapshot | null;
  summary: PracticeSummary | null;
}): { resumeError: string | null; resuming: boolean } {
  const { mutate: resumeSession } = useResumePracticeMutation();
  const { mutateAsync: endFinishedSession } = useEndPracticeMutation();
  /** The finished session whose summary was asked for (once; Retry asks again). */
  const summaryRequested = useRef<string | null>(null);
  // Revisiting a session (its summary since replaced by another's) asks for its summary again.
  useEffect(() => {
    summaryRequested.current = null;
  }, [sessionId]);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const finishedWithoutSummary =
    shownSession?.status === "finished" && summary?.sessionId !== shownSession.sessionId;

  // A session that already ended (Back after "Practice again", a restart) is never shown as live:
  // ending it again is idempotent and returns its summary. Asked once per session, so the answer
  // is taken from the promise: a per-call callback would be lost if this page's mutation observer
  // were resubscribed meanwhile (React's StrictMode remount does that).
  useEffect(() => {
    if (!finishedWithoutSummary) return;
    if (summaryRequested.current === shownSession.sessionId) return;
    summaryRequested.current = shownSession.sessionId;
    endFinishedSession(shownSession.sessionId).then(
      (result) => practice().setSummary(result),
      (error) =>
        setResumeError(ipcErrorMessage(error) || "That session's summary couldn't be read.")
    );
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

  return {
    resumeError,
    resuming: Boolean(sessionId && !shownSession) || finishedWithoutSummary
  };
}
