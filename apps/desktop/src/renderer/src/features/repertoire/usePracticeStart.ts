import { useEffect, useMemo, useRef, useState } from "react";
import type { RepertoireDetail, StartPracticeInput } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { useStartPracticeMutation } from "../../queries/repertoire";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useLichessStore } from "../../stores/lichess-store";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { LIVE_GAME_NOTICE, repertoireCommandBlocked } from "./handoffs";
import { autoStartPracticeInput, practiceStartInput, type PracticePreset } from "./practice-setup";
import { beginStart, IDLE_START, settleStart, type PracticeStart } from "./practice-start";

const practice = () => useRepertoirePracticeStore.getState();

/**
 * Starting a session: the last start and how it ended (`startState`, settled only by the newest
 * start), and `startSession`.
 */
export function usePracticeStart({
  onSessionStarted
}: {
  onSessionStarted: (sessionId: string) => void;
}): {
  startState: PracticeStart;
  startSession: (input: StartPracticeInput) => void;
} {
  const start = useStartPracticeMutation();
  /** The last start and how it ended (only the newest start settles it). */
  const [startState, setStartState] = useState<PracticeStart>(IDLE_START);
  const startRequest = useRef(0);

  /**
   * Starts a session. The answer is taken from the promise, never from per-call callbacks or the
   * mutation's pending flag: a start runs once from an effect, and a remount of this page
   * (StrictMode) would otherwise lose its answer and leave the spinner up for good.
   */
  const startSession = useEventCallback((input: StartPracticeInput) => {
    if (repertoireCommandBlocked(useLichessStore.getState(), "start-practice")) {
      useAppNoticeStore.getState().show(LIVE_GAME_NOTICE, { tone: "info" });
      return;
    }
    const request = ++startRequest.current;
    setStartState(beginStart(request, input));
    start.mutateAsync(input).then(
      (snapshot) => {
        setStartState((state) => settleStart(state, request, { kind: "answered", snapshot }));
        if (request !== startRequest.current || !snapshot.cards.length) return;
        practice().setSession(snapshot);
        onSessionStarted(snapshot.sessionId);
      },
      (error) =>
        setStartState((state) =>
          settleStart(state, request, {
            kind: "failed",
            message: ipcErrorMessage(error) || "Couldn't start practice."
          })
        )
    );
  });

  return { startState, startSession };
}

/**
 * Practice starts as soon as the repertoire is known (`detail` loaded) and no session is named:
 * the preset's session (a targeted queue, a rehearsal), else what the practice settings start
 * (from the preset's chapter, for a rehearsal). Once per preset: each navigation carries its
 * own, so Back to it never restarts it. True while that start is still to be made.
 */
export function useAutoStart({
  detail,
  sessionId,
  preset,
  startSession
}: {
  detail: RepertoireDetail | undefined;
  sessionId: string | null;
  preset: PracticePreset | null;
  startSession: (input: StartPracticeInput) => void;
}): boolean {
  /** The preset already started (once per preset; Back to it never restarts it). */
  const [autoStarted, setAutoStarted] = useState<PracticePreset | null>(null);
  const input = useMemo(
    () =>
      detail && !sessionId && preset
        ? (autoStartPracticeInput(detail.id, preset) ??
          practiceStartInput(detail, preset.chapterId ?? null))
        : null,
    [detail, sessionId, preset]
  );
  /** Set before starting, so StrictMode's repeated effect can't start a second session. */
  const autoStartedRef = useRef<PracticePreset | null>(null);
  useEffect(() => {
    if (!input || autoStarted === preset || autoStartedRef.current === preset) return;
    autoStartedRef.current = preset;
    setAutoStarted(preset);
    startSession(input);
  }, [input, autoStarted, preset, startSession]);
  return Boolean(input && autoStarted !== preset);
}
