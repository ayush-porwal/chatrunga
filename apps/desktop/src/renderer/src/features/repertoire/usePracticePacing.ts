import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PracticeCard } from "@chaturanga/shared/types/repertoire";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { useSettingsQuery } from "../../queries/api";
import { useRepertoirePracticeStore } from "../../stores/repertoire-practice-store";
import { usePrefersReducedMotion } from "../board/board-motion";
import { autoAdvanceDelay } from "./repertoire-model";

/** Rehearsal: the brief confirmation before the authored reply is played. */
const REHEARSAL_CONFIRM_MS = 450;
/** Rehearsal: how long the reply stays on the board (its motion included) before the next step. */
const REHEARSAL_REPLY_MS = 650;
/** Rehearsal: how long "Line complete" shows before the next line starts. */
const LINE_ADVANCE_MS = 900;
const REPLAY_STEP_MS = 700;
const REPLAY_STEP_REDUCED_MS = 250;

const practice = () => useRepertoirePracticeStore.getState();

/** The session's pending move on by itself (one at a time). */
export type AdvanceTimer = {
  start: (onFire: () => void, delayMs: number) => void;
  cancel: () => void;
};

/** Holds the pending move on, so taking the way on early (Next, a skip) cancels it. */
export function useAdvanceTimer(): AdvanceTimer {
  const timer = useRef<number | null>(null);
  return useMemo(
    () => ({
      start: (onFire, delayMs) => {
        timer.current = window.setTimeout(onFire, delayMs);
      },
      cancel: () => {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
      }
    }),
    []
  );
}

/**
 * What a running session does by itself, on timers cancelled when leaving the page: a
 * rehearsal's steps and line ends, the move on after a correct answer, and the lead-up replay.
 * `advance` holds the pending move on, which `goNext` cancels when the player is quicker.
 */
export function usePracticePacing({
  card,
  rehearsing,
  goNext,
  advance
}: {
  card: PracticeCard;
  rehearsing: boolean;
  goNext: () => void;
  advance: AdvanceTimer;
}): void {
  const { rehearsal, lineEnded, message, answer, leadUpIndex } = useRepertoirePracticeStore(
    useShallow((state) => ({
      rehearsal: state.rehearsal,
      lineEnded: state.lineEnded,
      message: state.message,
      answer: state.answer,
      leadUpIndex: state.leadUpIndex
    }))
  );
  const reducedMotion = usePrefersReducedMotion();
  const settings = useSettingsQuery();

  // Rehearsal: a brief confirmation, then the authored reply on the board (the board animates a
  // one-move change unless motion is reduced), then the next decision or the line's end. With
  // reduced motion the step is presented at once.
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
    advance.start(goNext, LINE_ADVANCE_MS);
    return advance.cancel;
  }, [lineEnded, reducedMotion, goNext, advance]);

  // A correct answer moves on by itself after the chosen delay, unless auto-advance is off or the
  // answer has notes to read.
  const advanceDelay = autoAdvanceDelay(
    settings.data?.practiceAutoAdvanceMs ?? defaultSettings.practiceAutoAdvanceMs,
    answer
  );
  useEffect(() => {
    if (rehearsing || advanceDelay === null) return;
    if (card.state !== "answered-correct" || message?.tone !== "success") return;
    advance.start(goNext, advanceDelay);
    return advance.cancel;
  }, [rehearsing, advanceDelay, card.state, card.queueItemId, message, goNext, advance]);

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
}
