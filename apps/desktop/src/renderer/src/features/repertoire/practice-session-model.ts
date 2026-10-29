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

/* Practice home (docs/repertoire-games-and-practice.md §4 Session). */

/**
 * The session's counters: due and new cards still to answer, cards done, and the share answered
 * right (null before any grade). A first sight is neither right nor wrong.
 */
export function sessionCounts(cards: readonly PracticeCard[]): {
  due: number;
  fresh: number;
  done: number;
  right: number | null;
} {
  const left = cards.filter((card) => card.state === "unanswered");
  const graded = cards.filter(
    (card) =>
      !card.preview &&
      (card.state === "answered-correct" ||
        card.state === "answered-wrong" ||
        card.state === "revealed")
  );
  const right = graded.filter((card) => card.state === "answered-correct").length;
  return {
    due: left.filter((card) => card.stage === "review").length,
    fresh: left.filter((card) => card.stage === "new").length,
    done: cards.length - left.length,
    right: graded.length ? Math.round((right / graded.length) * 100) : null
  };
}

/**
 * Above the board: "Review · Caro-Kann (Black) · Advance Variation", or for weak spots "Weak spot
 * 3 of 12 · seen in 49 games" (then "Lines you meet most" for the rehearsal after them).
 */
export function sessionHeading(
  session: Pick<PracticeSessionSnapshot, "mode" | "cards">,
  card: PracticeCard,
  where: { repertoire: string; chapter: string }
): string {
  if (session.mode === "weak") {
    if (card.weakGames === undefined) return `Lines you meet most · ${where.repertoire}`;
    const spots = session.cards.filter((item) => item.weakGames !== undefined);
    const games = `seen in ${card.weakGames} game${card.weakGames === 1 ? "" : "s"}`;
    return `Weak spot ${spots.indexOf(card) + 1} of ${spots.length} · ${games}`;
  }
  const kind =
    card.stage === "new" ? "New" : session.mode === "practice-early" ? "Practice early" : "Review";
  return `${kind} · ${where.repertoire} · ${where.chapter}`;
}

/** A first sight's move while the card is still to be answered (null otherwise). */
export function previewOf(card: Pick<PracticeCard, "preview" | "state">): string | null {
  return card.preview && card.state === "unanswered" ? card.preview.uci : null;
}
