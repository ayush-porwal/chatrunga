import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";

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
};

type PlayDraftStore = {
  draft: PlayDraft;
  update: (patch: Partial<PlayDraft>) => void;
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
  update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } }))
}));
