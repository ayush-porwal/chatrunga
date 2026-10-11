import type { PracticeCard, PracticeSessionSnapshot } from "@chaturanga/shared/types/repertoire";
import type { RepertoirePracticeState } from "../../stores/repertoire-practice-store";
import { lastMoveOf, nextUnansweredIndex } from "./repertoire-model";

/** Pure rules of a running practice session's screen: what the board shows and the way on. */

/** The submitted move shown while the main process grades it (cleared unless correct). */
export type PendingAttempt = { uci: string; attemptId: string; fenAfter: string };

/**
 * The position on the board and its last move: the lead-up replay's move, else the authored
 * reply a rehearsal shows, else the move being graded, else the card's position.
 */
export function practiceBoardPosition(
  card: Pick<PracticeCard, "fen" | "leadUp">,
  {
    leadUpIndex,
    rehearsal,
    pending
  }: Pick<RepertoirePracticeState, "leadUpIndex" | "rehearsal"> & {
    pending: PendingAttempt | null;
  }
): { fen: string; lastMove: readonly [string, string] | null } {
  if (leadUpIndex !== null) {
    return {
      fen: card.leadUp[leadUpIndex].fen,
      lastMove: lastMoveOf(card.leadUp[leadUpIndex]?.uci)
    };
  }
  const shownReply = rehearsal?.replyShown ? rehearsal.step.reply : null;
  if (shownReply) return { fen: shownReply.fen, lastMove: lastMoveOf(shownReply.uci) };
  if (pending) return { fen: pending.fenAfter, lastMove: lastMoveOf(pending.uci) };
  return { fen: card.fen, lastMove: lastMoveOf(card.leadUp[card.leadUp.length - 1]?.uci) };
}

/** Where the current card stands, for its controls and the way on. */
export type PracticeCardState = {
  /** The card is decided. */
  finished: boolean;
  /** A rehearsal step, an other-line choice or a line's end holds the board still. */
  held: boolean;
  /**
   * After a wrong first answer the card stays playable (ungraded retries) until it's revealed or
   * answered correctly; the grade was fixed by the first answer.
   */
  retrying: boolean;
  canAnswer: boolean;
  /** Every card is final: the next step is the summary. */
  allFinal: boolean;
};

export function practiceCardState(
  session: Pick<PracticeSessionSnapshot, "cards" | "cursor">,
  card: Pick<PracticeCard, "state">,
  {
    reveal,
    rehearsal,
    otherLine,
    lineEnded
  }: Pick<RepertoirePracticeState, "reveal" | "rehearsal" | "otherLine" | "lineEnded">
): PracticeCardState {
  const finished = card.state !== "unanswered";
  const held = Boolean(rehearsal || otherLine || lineEnded);
  const retrying = card.state === "answered-wrong" && !reveal;
  return {
    finished,
    held,
    retrying,
    canAnswer: (!finished || retrying) && !held,
    allFinal: nextUnansweredIndex(session.cards, session.cursor) < 0 && finished
  };
}

/** The footer's way on from the current card. */
export type PracticeWayOn = "summary" | "next-card" | "continue-line" | "skip-line" | "next-line";

export const WAY_ON_LABELS: Record<PracticeWayOn, string> = {
  summary: "See summary",
  "next-card": "Next card",
  "continue-line": "Continue line",
  "skip-line": "Skip this line",
  "next-line": "Next line"
};

/**
 * The footer's way on (null: none yet). Rehearsal: continue after a reveal, skip the line after a
 * move outside the repertoire (the board stays playable to try again), the next line after an
 * ended one (or a skipped / stale card), or the summary. Otherwise the next card once this one is
 * decided (also while a correct answer waits to move on by itself), or the summary once every
 * card is final.
 */
export function practiceWayOn(
  state: { rehearsing: boolean } & Pick<
    PracticeCardState,
    "finished" | "allFinal" | "retrying" | "held"
  > &
    Pick<RepertoirePracticeState, "rehearsal" | "otherLine" | "lineEnded">
): PracticeWayOn | null {
  if (!state.rehearsing) {
    if (!state.finished) return null;
    return state.allFinal ? "summary" : "next-card";
  }
  if (state.rehearsal && !state.rehearsal.auto && !state.lineEnded) return "continue-line";
  if (state.retrying && !state.held) return "skip-line";
  if (state.lineEnded || (state.finished && !state.rehearsal && !state.otherLine)) {
    return "next-line";
  }
  return null;
}
