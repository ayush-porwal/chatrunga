import { useEffect, useMemo, useRef, useState } from "react";
import type { RepertoireDetail, StartPracticeInput } from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import {
  useSaveRepertoireWorkspaceMutation,
  useStartPracticeMutation
} from "../../queries/repertoire";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useLichessStore } from "../../stores/lichess-store";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { LIVE_GAME_NOTICE, repertoireCommandBlocked } from "./handoffs";
import { autoStartPracticeInput, savesPracticeDraft, type PracticePreset } from "./practice-setup";
import { beginStart, IDLE_START, settleStart, type PracticeStart } from "./practice-start";

const practice = () => useRepertoirePracticeStore.getState();

/**
 * Starting a session: the last start and how it ended (`startState`, settled only by the newest
 * start), and `startSession`, which saves a start from the setup form as the repertoire's draft.
 */
export function usePracticeStart({
  repertoireId,
  detail,
  onSessionStarted
}: {
  repertoireId: string;
  /** The loaded repertoire (its workspace keeps the draft). */
  detail: RepertoireDetail | undefined;
  onSessionStarted: (sessionId: string) => void;
}): {
  startState: PracticeStart;
  startSession: (input: StartPracticeInput, fromPreset?: boolean) => void;
} {
  const start = useStartPracticeMutation();
  const saveWorkspace = useSaveRepertoireWorkspaceMutation();
  /** The last start and how it ended (only the newest start settles it). */
  const [startState, setStartState] = useState<PracticeStart>(IDLE_START);
  const startRequest = useRef(0);

  /**
   * Starts a session. The answer is taken from the promise, never from per-call callbacks or the
   * mutation's pending flag: an auto-start runs once from an effect, and a remount of this page
   * (StrictMode) would otherwise lose its answer and leave the spinner up for good.
   */
  const startSession = useEventCallback((input: StartPracticeInput, fromPreset?: boolean) => {
    if (repertoireCommandBlocked(useLichessStore.getState(), "start-practice")) {
      useAppNoticeStore.getState().show(LIVE_GAME_NOTICE, { tone: "info" });
      return;
    }
    if (detail && savesPracticeDraft(input, fromPreset === true)) {
      saveWorkspace.mutate({
        repertoireId,
        workspace: {
          lastChapterId: detail.workspace?.lastChapterId ?? null,
          lastNodeId: detail.workspace?.lastNodeId ?? null,
          orientation: detail.workspace?.orientation ?? detail.color,
          practiceDraft: input
        },
        practiceSetup: true
      });
    }
    const request = ++startRequest.current;
    setStartState(beginStart(request, input, fromPreset === true));
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
 * "Refresh this decision" / "Rehearse from here": the preset's session starts as soon as the
 * repertoire is known (`detail` loaded), once per preset (Back to it never restarts it). True
 * while that start is still to be made.
 */
export function usePresetAutoStart({
  detail,
  sessionId,
  preset,
  startSession
}: {
  detail: Pick<RepertoireDetail, "id"> | undefined;
  sessionId: string | null;
  preset: PracticePreset | null;
  startSession: (input: StartPracticeInput, fromPreset?: boolean) => void;
}): boolean {
  /** The targeted preset already started (once per preset; Back to it never restarts it). */
  const [autoStarted, setAutoStarted] = useState<PracticePreset | null>(null);
  const loadedId = detail?.id ?? null;
  const targetedInput = useMemo(
    () => (loadedId && !sessionId ? autoStartPracticeInput(loadedId, preset) : null),
    [loadedId, sessionId, preset]
  );
  /** Set before starting, so StrictMode's repeated effect can't start a second session. */
  const autoStartedRef = useRef<PracticePreset | null>(null);
  useEffect(() => {
    if (!targetedInput || autoStarted === preset || autoStartedRef.current === preset) return;
    autoStartedRef.current = preset;
    setAutoStarted(preset);
    startSession(targetedInput, true);
  }, [targetedInput, autoStarted, preset, startSession]);
  return Boolean(targetedInput && autoStarted !== preset);
}
