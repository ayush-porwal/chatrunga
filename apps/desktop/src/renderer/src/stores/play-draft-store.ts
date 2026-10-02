import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";

/**
 * Where an engine game starts when it comes from a repertoire (Study → Play from here): the
 * chapter's root position and the authored moves to the handoff, replayed into the new game so its
 * history (repetitions, notation) is preserved. The game never edits the repertoire.
 */
export type PlayInitialSession = {
  rootFen: string;
  /** UCI moves from `rootFen` to the handoff position. */
  moves: string[];
  /** The repertoire's colour: the side the player takes (the engine plays the other). */
  playerColor: Color;
  /** "<repertoire> › <chapter> — 1. e4 e5 2. Nf3", for the setup card. */
  label: string;
  repertoire: {
    repertoireId: string;
    chapterId: string;
    nodeId: string;
    /** SAN path of the handoff ("1. e4 e5 2. Nf3", or "Start"). */
    capturedPath: string;
  };
};

/**
 * The Play page's engine-game choices before a game starts, kept outside the page so a detour
 * (Engine settings) and Back return to them. `null` = not chosen yet (the page's default).
 */
export type PlayDraft = {
  engineId: string;
  humanColor: Color | null;
  moveTimeMs: number | null;
  depth: number | null | undefined;
  clockPreset: string;
  customMinutes: number;
  customIncrementSec: number;
  /** A repertoire handoff to start from (Play from here); absent for a normal game. */
  initialSession?: PlayInitialSession;
};

/**
 * The draft with a repertoire handoff: the player takes the repertoire's colour and the game is
 * untimed unless the player picks a clock afterwards.
 */
export function withInitialSession(
  draft: PlayDraft,
  initialSession: PlayInitialSession
): PlayDraft {
  return {
    ...draft,
    initialSession,
    humanColor: initialSession.playerColor,
    clockPreset: "infinite"
  };
}

/** The draft without a handoff (Clear, or the game started from it); other choices stay. */
export function withoutInitialSession(draft: PlayDraft): PlayDraft {
  if (!draft.initialSession) return draft;
  const next = { ...draft };
  delete next.initialSession;
  return next;
}

type PlayDraftStore = {
  draft: PlayDraft;
  update: (patch: Partial<PlayDraft>) => void;
  setInitialSession: (initialSession: PlayInitialSession) => void;
  clearInitialSession: () => void;
};

export const usePlayDraftStore = create<PlayDraftStore>((set) => ({
  draft: {
    engineId: "",
    humanColor: null,
    moveTimeMs: null,
    depth: undefined,
    clockPreset: "infinite",
    customMinutes: 10,
    customIncrementSec: 5
  },
  update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  setInitialSession: (initialSession) =>
    set((state) => ({ draft: withInitialSession(state.draft, initialSession) })),
  clearInitialSession: () => set((state) => ({ draft: withoutInitialSession(state.draft) }))
}));
