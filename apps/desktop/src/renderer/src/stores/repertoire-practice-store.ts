import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";
import type {
  AttemptResult,
  PracticeAction,
  PracticeActionResult,
  PracticeAnswer,
  PracticeCard,
  PracticeLeadUpMove,
  PracticeSessionSnapshot,
  PracticeSummary,
  RehearsalStep
} from "@chaturanga/shared/types/repertoire";
import { REPERTOIRE_ROOT_NODE_ID } from "@chaturanga/shared/types/repertoire";
import {
  nextUnansweredIndex,
  resumedHintText,
  totalsOf
} from "../features/repertoire/repertoire-model";

/**
 * A repertoire practice session as shown: the main process's snapshot (it grades and persists),
 * the current card, and what the page shows about it (hint text, the last outcome, a reveal, the
 * lead-up replay step). Cards only change from results the main process returned — never from a
 * move the client thinks is right. In line rehearsal the queue grows: each result's next decision
 * is appended, and the page animates the authored reply before presenting it.
 */

export type PracticeOutcomeMessage = {
  tone: "success" | "info" | "warn";
  text: string;
  feedback?: string | null;
};

/** A revealed answer: its accepted moves are drawn on the board. */
export type PracticeReveal = PracticeAnswer;

/** Why a rehearsed line ended. */
export type RehearsalEndReason = NonNullable<RehearsalStep["endReason"]>;

/** Where an accepted move from another line lives (an `other-line` answer). */
export type PracticeOtherLine = NonNullable<AttemptResult["otherLine"]>;

/**
 * A rehearsal step the main process returned and the page hasn't finished presenting: the reply is
 * shown on the board once `replyShown`, then the next decision (or the line's end) is presented.
 * `auto` is false after a reveal, until the player chooses to continue the line.
 */
export type PendingRehearsalStep = { step: RehearsalStep; replyShown: boolean; auto: boolean };

export type RepertoirePracticeState = {
  session: PracticeSessionSnapshot | null;
  summary: PracticeSummary | null;
  /** Hint text shown at hint stage 1 (the authored hint or prompt). */
  hint: string | null;
  /** The preferred move hints point at (stages 2–3), once the main process revealed it. */
  hintUci: string | null;
  message: PracticeOutcomeMessage | null;
  reveal: PracticeReveal | null;
  /**
   * The current card's answer with its authored notes, once its grade is final (a correct answer
   * or a reveal); null before, so nothing answer-bearing shows while the card can be answered.
   */
  answer: PracticeAnswer | null;
  /** Index into the card's lead-up while replaying it; null shows the card's position. */
  leadUpIndex: number | null;
  orientation: Color;
  /** Rehearsal: the step being presented (reply to animate, then the next decision). */
  rehearsal: PendingRehearsalStep | null;
  /** Rehearsal: the last answer was a repertoire choice in another line. */
  otherLine: PracticeOtherLine | null;
  /** Rehearsal: the current line ended, and why. */
  lineEnded: RehearsalEndReason | null;
  /** Why the session ended early (its chapter changed), for the summary; null otherwise. */
  endNote: string | null;
};

type Actions = {
  setSession: (session: PracticeSessionSnapshot) => void;
  applyAttempt: (result: AttemptResult) => void;
  applyAction: (kind: PracticeAction["kind"], result: PracticeActionResult) => void;
  /** Rehearsal: the authored reply goes on the board. */
  showReply: () => void;
  /** Rehearsal: a step held after a reveal runs on (the player chose to continue the line). */
  continueStep: () => void;
  /**
   * Rehearsal: presents the pending step — the next decision becomes current, or the line ends.
   * Returns what happened ("none" when no step was pending).
   */
  presentStep: () => "next" | "line-complete" | "none";
  /** Rehearsal: "Try again" after an `other-line` answer. */
  dismissOtherLine: () => void;
  /**
   * Moves to the next unanswered card (after a completed line, the next line's first decision);
   * returns false when none is left.
   */
  advance: () => boolean;
  setSummary: (summary: PracticeSummary) => void;
  setLeadUpIndex: (index: number | null) => void;
  flip: () => void;
  clearMessage: () => void;
  reset: () => void;
};

const initialState: RepertoirePracticeState = {
  session: null,
  summary: null,
  hint: null,
  hintUci: null,
  message: null,
  reveal: null,
  answer: null,
  leadUpIndex: null,
  orientation: "white",
  rehearsal: null,
  otherLine: null,
  lineEnded: null,
  endNote: null
};

/** Per-card UI state that resets when the card changes. */
const freshCardUi = {
  hint: null,
  hintUci: null,
  message: null,
  reveal: null,
  answer: null,
  leadUpIndex: null,
  rehearsal: null,
  otherLine: null,
  lineEnded: null
};

/** The answer a correct attempt's result gives out, with its notes when it has them. */
function answerOf(result: AttemptResult): PracticeAnswer {
  return {
    ucis: result.acceptedUcis,
    preferredUci: result.preferredUci,
    explanation: result.explanation ?? null,
    ...(result.moveComments ? { moveComments: result.moveComments } : {})
  };
}

/** The current card of a session, if any. */
export function currentCard(session: PracticeSessionSnapshot | null): PracticeCard | null {
  return session?.cards[session.cursor] ?? null;
}

/** The session with `card` replacing the card of the same queue item, and totals recomputed. */
export function withCard(
  session: PracticeSessionSnapshot,
  card: PracticeCard
): PracticeSessionSnapshot {
  const cards = session.cards.map((item) => (item.queueItemId === card.queueItemId ? card : item));
  return { ...session, cards, totals: totalsOf(cards) };
}

/**
 * The session with `card` added at the end of the queue (a rehearsal's next decision), or
 * replacing the card of the same queue item when it is already there; totals recomputed.
 */
export function withAppendedCard(
  session: PracticeSessionSnapshot,
  card: PracticeCard
): PracticeSessionSnapshot {
  if (session.cards.some((item) => item.queueItemId === card.queueItemId)) {
    return withCard(session, card);
  }
  const cards = [...session.cards, card];
  return { ...session, cards, totals: totalsOf(cards) };
}

/** The session with a rehearsal step's next decision appended, when there is one. */
function withStep(
  session: PracticeSessionSnapshot,
  step: RehearsalStep | undefined
): PracticeSessionSnapshot {
  return step?.next ? withAppendedCard(session, step.next) : session;
}

/** A line's number in the session: lines count in the order their first decision appeared. */
export function rehearsalLineNumber(cards: readonly PracticeCard[], lineId: string): number {
  const seen: string[] = [];
  for (const card of cards) {
    const id = card.rehearsal?.lineId;
    if (id === undefined || seen.includes(id)) continue;
    seen.push(id);
    if (id === lineId) return seen.length;
  }
  return seen.length + 1;
}

/**
 * "Rehearsing · Najdorf · line 2", the board's title during a rehearsal. The main process numbers
 * lines by first appearance; cards from before it did are numbered from the queue.
 */
export function rehearsalTitle(
  chapterTitle: string,
  cards: readonly PracticeCard[],
  card: PracticeCard
): string {
  const line = card.rehearsal
    ? (card.rehearsal.lineNumber ?? rehearsalLineNumber(cards, card.rehearsal.lineId))
    : 1;
  return `Rehearsing · ${chapterTitle} · line ${line}`;
}

/**
 * The words for an opponent move the main process played before a line's first decision (a
 * rehearsal started where the opponent is to move), or null when the card follows no such move.
 */
export function openingReplyMessage(
  session: Pick<PracticeSessionSnapshot, "mode" | "scope">,
  card: PracticeCard
): PracticeOutcomeMessage | null {
  if (session.mode !== "rehearse-lines" || card.rehearsal?.stepIndex !== 0) return null;
  const from = session.scope.rehearse?.fromNodeId ?? REPERTOIRE_ROOT_NODE_ID;
  const reply = card.leadUp[card.leadUp.length - 1];
  if (card.nodeId === from || !reply) return null;
  return { tone: "info", text: `The reply: ${reply.san}.` };
}

/**
 * The words for a rehearsal's reply before `next`, and for the moves played after it at paused
 * decisions (never asked: they and their replies are the end of the next card's lead-up).
 */
export function rehearsalReplyMessage(
  reply: PracticeLeadUpMove | null,
  next: PracticeCard
): PracticeOutcomeMessage | null {
  if (!reply) return null;
  let at = next.leadUp.length - 1;
  while (at >= 0 && !(next.leadUp[at].uci === reply.uci && next.leadUp[at].fen === reply.fen)) {
    at -= 1;
  }
  const played = at >= 0 ? next.leadUp.slice(at + 1).map((move) => move.san) : [];
  return {
    tone: "info",
    text: played.length
      ? `The reply: ${reply.san}. Played for you (paused): ${played.join(" ")}.`
      : `The reply: ${reply.san}.`
  };
}

/** The step of the line a rehearsal card is (1 for the line's first decision). */
export function rehearsalStepNumber(card: PracticeCard): number {
  return (card.rehearsal?.stepIndex ?? 0) + 1;
}

const END_REASONS: Record<RehearsalEndReason, string> = {
  leaf: "reached the end of the line",
  stop: "reached your stop",
  depth: "reached the depth limit"
};

/** "Line complete — reached your stop". */
export function lineCompleteText(reason: RehearsalEndReason | null): string {
  return `Line complete — ${END_REASONS[reason ?? "leaf"]}`;
}

export const OTHER_LINE_TEXT = "That is a repertoire choice in another line.";

export const SESSION_ENDED_TEXT =
  "This chapter changed since the session started, so the session ended.";

export const useRepertoirePracticeStore = create<RepertoirePracticeState & Actions>((set, get) => ({
  ...initialState,

  setSession: (session) => {
    const card = currentCard(session);
    const shown = session.shown;
    set({
      ...freshCardUi,
      // Hints taken and a reveal before (a resumed session) show again.
      hint: card ? (shown?.hint ?? resumedHintText(card)) : null,
      hintUci: shown?.hintUci ?? null,
      reveal: shown?.revealed ?? null,
      answer: shown?.revealed ?? null,
      message: card ? openingReplyMessage(session, card) : null,
      session: { ...session, totals: totalsOf(session.cards) },
      summary: null,
      endNote: null,
      orientation: card?.orientation ?? get().orientation
    });
  },

  applyAttempt: (result) => {
    const { session } = get();
    if (!session) return;
    const next = withStep(withCard(session, result.card), result.rehearsal);
    if (result.sessionEnded) {
      // The chapter changed: the session is over (the page moves on to its summary), also when
      // the card was being retried and so stays answered-wrong.
      set({
        session: { ...next, status: "finished" },
        message: { tone: "info", text: SESSION_ENDED_TEXT },
        endNote: SESSION_ENDED_TEXT,
        otherLine: null
      });
      return;
    }
    let message: PracticeOutcomeMessage | null;
    switch (result.outcome) {
      case "correct":
        message = result.finalGrade
          ? { tone: "success", text: "Correct — that's in your repertoire." }
          : { tone: "success", text: "Correct — this card still counts as missed." };
        break;
      case "other-line":
        // Not a memory failure: the card stays current, to retry or follow the other line.
        set({
          session: next,
          message: { tone: "info", text: OTHER_LINE_TEXT },
          otherLine: result.otherLine ?? null
        });
        return;
      case "outside-repertoire":
        message = {
          tone: "warn",
          text: "This move is outside your repertoire.",
          feedback: result.feedback
        };
        break;
      case "illegal":
        message = { tone: "warn", text: "That move isn't legal here." };
        break;
      case "stale":
        message = {
          tone: "info",
          text: "This decision changed since the session started, so the card was skipped."
        };
        break;
      default:
        message = { tone: "info", text: "This card is already finished." };
    }
    const step = result.outcome === "correct" ? result.rehearsal : undefined;
    // A wrong answer's result never carries the answer (the card can be retried); a correct one's
    // does, shown with its notes (a rehearsal moves on instead).
    const answer =
      result.outcome === "correct" && !step && result.acceptedUcis.length ? answerOf(result) : null;
    set({
      session: next,
      message,
      otherLine: null,
      // A correct retry ends the card showing the accepted moves on the board too.
      reveal: answer && !result.finalGrade ? answer : get().reveal,
      answer: answer ?? get().answer,
      rehearsal: step ? { step, replyShown: false, auto: true } : get().rehearsal
    });
  },

  applyAction: (kind, result) => {
    const { session } = get();
    if (!session) return;
    // A reveal or following another line continues a rehearsed line; a skip starts the next one.
    const continues = kind === "reveal" || kind === "follow-other-line" || kind === "skip";
    const next = withStep(withCard(session, result.card), continues ? result.rehearsal : undefined);
    if (kind === "follow-other-line") {
      set({
        session: next,
        otherLine: null,
        message: { tone: "success", text: "Following that line." },
        rehearsal: result.rehearsal
          ? { step: result.rehearsal, replyShown: false, auto: true }
          : null
      });
      return;
    }
    if (kind === "hint" && result.sessionEnded) {
      // No hint was given: the session is over (the page moves on to its summary).
      set({
        session: { ...next, status: "finished" },
        message: { tone: "info", text: SESSION_ENDED_TEXT },
        endNote: SESSION_ENDED_TEXT
      });
    } else if (kind === "hint") {
      set({
        session: next,
        hint:
          result.revealed?.explanation ??
          get().hint ??
          result.card.prompt ??
          "No hint was written for this position.",
        hintUci: result.revealed?.preferredUci ?? result.revealed?.ucis[0] ?? get().hintUci
      });
    } else if (kind === "reveal") {
      const revealed = result.revealed ?? { ucis: [], preferredUci: null, explanation: null };
      set({
        session: next,
        reveal: revealed,
        answer: revealed,
        message: {
          tone: "info",
          text:
            result.card.state === "skipped"
              ? "This decision changed since the session started, so the card was skipped."
              : "Revealed — this decision counts as missed.",
          // The author's words on the move just missed stay beside the answer.
          feedback: get().message?.feedback ?? null
        },
        otherLine: null,
        // A rehearsal waits on the answer until the player continues the line.
        rehearsal: result.rehearsal
          ? { step: result.rehearsal, replyShown: false, auto: false }
          : null
      });
    } else {
      set({ session: next });
    }
  },

  advance: () => {
    const { session, rehearsal } = get();
    if (!session) return false;
    // After a completed line, its step names the next line's first decision.
    const nextId = rehearsal?.step.next?.queueItemId;
    let index = nextId
      ? session.cards.findIndex(
          (card) => card.queueItemId === nextId && card.state === "unanswered"
        )
      : -1;
    if (index < 0) index = nextUnansweredIndex(session.cards, session.cursor);
    if (index < 0) return false;
    const card = session.cards[index];
    set({
      ...freshCardUi,
      hint: resumedHintText(card),
      message: openingReplyMessage(session, card),
      session: { ...session, cursor: index }
    });
    return true;
  },

  showReply: () => {
    const { rehearsal } = get();
    if (rehearsal?.step.reply && !rehearsal.replyShown) {
      set({ rehearsal: { ...rehearsal, replyShown: true } });
    }
  },

  continueStep: () => {
    const { rehearsal, lineEnded } = get();
    if (rehearsal && !rehearsal.auto && !lineEnded) {
      set({ rehearsal: { ...rehearsal, auto: true } });
    }
  },

  presentStep: () => {
    const { session, rehearsal, lineEnded } = get();
    if (!session || !rehearsal || lineEnded) return "none";
    const { step } = rehearsal;
    const index =
      step.next && !step.lineComplete
        ? session.cards.findIndex((card) => card.queueItemId === step.next!.queueItemId)
        : -1;
    if (index >= 0) {
      const card = session.cards[index];
      set({
        ...freshCardUi,
        hint: resumedHintText(card),
        session: { ...session, cursor: index },
        // The reply is announced in words too (the board's motion alone isn't accessible).
        message: rehearsalReplyMessage(step.reply, card)
      });
      return "next";
    }
    // The line ended: the step stays (held, not auto) so the board keeps the line's final position
    // until the next line's first decision (`step.next`) is presented by advance.
    const reason = step.endReason ?? "leaf";
    const reply = step.reply ? `The reply: ${step.reply.san}. ` : "";
    set({
      rehearsal: { step, replyShown: Boolean(step.reply), auto: false },
      lineEnded: reason,
      message: { tone: "success", text: `${reply}${lineCompleteText(reason)}.` }
    });
    return "line-complete";
  },

  dismissOtherLine: () => set({ otherLine: null, message: null }),

  setSummary: (summary) =>
    set((state) => ({
      summary,
      session: state.session ? { ...state.session, status: "finished" } : null
    })),
  setLeadUpIndex: (leadUpIndex) => set({ leadUpIndex }),
  flip: () => set((state) => ({ orientation: state.orientation === "white" ? "black" : "white" })),
  clearMessage: () => set({ message: null }),
  reset: () => set(initialState)
}));
