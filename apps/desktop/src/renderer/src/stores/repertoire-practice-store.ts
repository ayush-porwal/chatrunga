import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";
import type {
  AttemptResult,
  PracticeActionResult,
  PracticeCard,
  PracticeSessionSnapshot,
  PracticeSummary
} from "@chaturanga/shared/types/repertoire";
import {
  nextUnansweredIndex,
  resumedHintText,
  totalsOf
} from "../features/repertoire/repertoire-model";

/**
 * A repertoire practice session as shown: the main process's snapshot (it grades and persists),
 * the current card, and what the page shows about it (hint text, the last outcome, a reveal, the
 * lead-up replay step). Cards only change from results the main process returned — never from a
 * move the client thinks is right.
 */

export type PracticeOutcomeMessage = {
  tone: "success" | "info" | "warn";
  text: string;
  feedback?: string | null;
};

export type PracticeReveal = {
  ucis: string[];
  preferredUci: string | null;
  explanation: string | null;
};

export type RepertoirePracticeState = {
  session: PracticeSessionSnapshot | null;
  summary: PracticeSummary | null;
  /** Hint text shown at hint stage 1 (the authored hint or prompt). */
  hint: string | null;
  /** The preferred move hints point at (stages 2–3), once the main process revealed it. */
  hintUci: string | null;
  message: PracticeOutcomeMessage | null;
  reveal: PracticeReveal | null;
  /** Index into the card's lead-up while replaying it; null shows the card's position. */
  leadUpIndex: number | null;
  orientation: Color;
};

type Actions = {
  setSession: (session: PracticeSessionSnapshot) => void;
  applyAttempt: (result: AttemptResult) => void;
  applyAction: (kind: "hint" | "reveal" | "skip", result: PracticeActionResult) => void;
  /** Moves to the next unanswered card; returns false when none is left. */
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
  leadUpIndex: null,
  orientation: "white"
};

/** Per-card UI state that resets when the card changes. */
const freshCardUi = { hint: null, hintUci: null, message: null, reveal: null, leadUpIndex: null };

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

export const useRepertoirePracticeStore = create<RepertoirePracticeState & Actions>((set, get) => ({
  ...initialState,

  setSession: (session) => {
    const card = currentCard(session);
    set({
      ...freshCardUi,
      // Hints taken before (a resumed session) show as what the card records.
      hint: card ? resumedHintText(card) : null,
      session: { ...session, totals: totalsOf(session.cards) },
      summary: null,
      orientation: card?.orientation ?? get().orientation
    });
  },

  applyAttempt: (result) => {
    const { session } = get();
    if (!session) return;
    const next = withCard(session, result.card);
    let message: PracticeOutcomeMessage | null;
    switch (result.outcome) {
      case "correct":
        message = result.finalGrade
          ? { tone: "success", text: "Correct — that's in your repertoire." }
          : { tone: "success", text: "Correct — this card still counts as missed." };
        break;
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
    set({
      session: next,
      message,
      // A wrong answer's result never carries the answer (the card can be retried); a correct
      // retry's does, and ends the card showing the accepted moves.
      reveal:
        result.outcome === "correct" && !result.finalGrade && result.acceptedUcis.length
          ? { ucis: result.acceptedUcis, preferredUci: result.preferredUci, explanation: null }
          : get().reveal
    });
  },

  applyAction: (kind, result) => {
    const { session } = get();
    if (!session) return;
    const next = withCard(session, result.card);
    if (kind === "hint") {
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
      set({
        session: next,
        reveal: result.revealed
          ? {
              ucis: result.revealed.ucis,
              preferredUci: result.revealed.preferredUci,
              explanation: result.revealed.explanation
            }
          : { ucis: [], preferredUci: null, explanation: null },
        message: {
          tone: "info",
          text:
            result.card.state === "skipped"
              ? "This decision changed since the session started, so the card was skipped."
              : "Revealed — this decision counts as missed."
        }
      });
    } else {
      set({ session: next });
    }
  },

  advance: () => {
    const { session } = get();
    if (!session) return false;
    const index = nextUnansweredIndex(session.cards, session.cursor);
    if (index < 0) return false;
    set({
      ...freshCardUi,
      hint: resumedHintText(session.cards[index]),
      session: { ...session, cursor: index }
    });
    return true;
  },

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
