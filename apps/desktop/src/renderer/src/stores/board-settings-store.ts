import { create } from "zustand";

/** The board's settings dialog tabs: live analysis, and the puzzle explanation (shared with Game review). */
export type BoardSettingsTab = "analysis" | "explanation";

/**
 * The game view's one settings dialog (the Moves tab's cog): which tab is open, or null when it's
 * closed. Kept here so the puzzle card can open it on the explanation's tab (its Settings fix).
 */
type BoardSettingsStore = {
  openTab: BoardSettingsTab | null;
  open: (tab: BoardSettingsTab) => void;
  close: () => void;
};

export const useBoardSettingsStore = create<BoardSettingsStore>((set) => ({
  openTab: null,
  open: (tab) => set({ openTab: tab }),
  close: () => set({ openTab: null })
}));
