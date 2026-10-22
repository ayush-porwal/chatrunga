import { useEffect, useMemo, useRef, useState } from "react";
import type { RepertoireDetail, StartPracticeInput } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { useStartPracticeMutation } from "../../queries/repertoire";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useLichessStore } from "../../stores/lichess-store";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { LIVE_GAME_NOTICE, repertoireCommandBlocked } from "./handoffs";
import { presetPracticeInput, type PracticePreset } from "./practice-setup";
import {
  beginStart,
  IDLE_START,
  practiceAutoStarts,
  settleStart,
  type PracticeStart
} from "./practice-start";

const practice = () => useRepertoirePracticeStore.getState();

/**
 * Starting a session: the last start and how it ended (`startState`, settled only by the newest
 * start), and `startSession`. A start made for a navigation (its preset) runs once: showing that
 * navigation again takes the first start's answer.
 */
export function usePracticeStart({
  onSessionStarted
}: {
  onSessionStarted: (sessionId: string) => void;
}): {
  startState: PracticeStart;
  startSession: (input: StartPracticeInput, navigation?: PracticePreset | null) => void;
} {
  const start = useStartPracticeMutation();
  /** The last start and how it ended (only the newest start settles it). */
  const [startState, setStartState] = useState<PracticeStart>(IDLE_START);
  const startRequest = useRef(0);
  /** An answer reaching a page no longer shown is only kept for that navigation's next showing. */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Starts a session. The answer is taken from the promise, never from per-call callbacks or the
   * mutation's pending flag: a start runs once from an effect, and a remount of this page
   * (StrictMode) would otherwise lose its answer and leave the spinner up for good.
   */
  const startSession = useEventCallback(
    (input: StartPracticeInput, navigation?: PracticePreset | null) => {
      if (repertoireCommandBlocked(useLichessStore.getState(), "start-practice")) {
        useAppNoticeStore.getState().show(LIVE_GAME_NOTICE, { tone: "info" });
        return;
      }
      const request = ++startRequest.current;
      setStartState(beginStart(request, input));
      const run = () => start.mutateAsync(input);
      const { answer, reused } = navigation
        ? practiceAutoStarts.run(navigation, run)
        : { answer: run(), reused: false };
      answer.then(
        (snapshot) => {
          setStartState((state) => settleStart(state, request, { kind: "answered", snapshot }));
          if (request !== startRequest.current || !mounted.current || !snapshot.cards.length)
            return;
          // An earlier showing's session may have moved on since: the route resumes it from main.
          if (!reused) practice().setSession(snapshot);
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
    }
  );

  return { startState, startSession };
}

/**
 * Practice starts as soon as the repertoire is known (`detail` loaded) and no session is named:
 * the preset's session (a targeted queue, a rehearsal), else what the practice settings start
 * (from the preset's chapter, for a rehearsal). Once per preset: each navigation carries its
 * own (its history entry too), so Back to it shows that start's answer, never a new start.
 * `pending` while that start is still to be made; `input`: what the navigation starts with the
 * settings as they are now (Try again), null with a session named.
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
  startSession: (input: StartPracticeInput, navigation?: PracticePreset | null) => void;
}): { pending: boolean; input: StartPracticeInput | null } {
  /** The preset already started (once per preset; Back to it never restarts it). */
  const [autoStarted, setAutoStarted] = useState<PracticePreset | null>(null);
  const input = useMemo(
    () => (detail && !sessionId && preset ? presetPracticeInput(detail, preset).input : null),
    [detail, sessionId, preset]
  );
  /** Set before starting, so StrictMode's repeated effect can't start a second session. */
  const autoStartedRef = useRef<PracticePreset | null>(null);
  useEffect(() => {
    if (!input || autoStarted === preset || autoStartedRef.current === preset) return;
    autoStartedRef.current = preset;
    setAutoStarted(preset);
    startSession(input, preset);
  }, [input, autoStarted, preset, startSession]);
  return { pending: Boolean(input && autoStarted !== preset), input };
}
