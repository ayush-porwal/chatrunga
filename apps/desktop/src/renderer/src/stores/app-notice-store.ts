import { create } from "zustand";

/**
 * A failure from an action that isn't tied to a page (sidebar Import / Export PGN): shown above
 * whichever page is open until dismissed or replaced.
 */
type AppNoticeStore = {
  message: string | null;
  show: (message: string) => void;
  dismiss: () => void;
};

export const useAppNoticeStore = create<AppNoticeStore>((set) => ({
  message: null,
  show: (message) => set({ message }),
  dismiss: () => set({ message: null })
}));
