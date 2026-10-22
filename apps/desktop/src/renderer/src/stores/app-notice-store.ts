import { create } from "zustand";

/** A notice's optional follow-up ("Open chapter"). Choosing it also dismisses the notice. */
type AppNoticeAction = { label: string; onSelect: () => void };

type AppNoticeTone = "danger" | "success" | "info";

type AppNoticeOptions = {
  tone?: AppNoticeTone;
  action?: AppNoticeAction;
  /** Offer Maia 3's download with the notice (its button, then progress; gone once installed). */
  maia3Download?: boolean;
};

/**
 * A message from an action that isn't tied to a page (sidebar Import / Export PGN failures, a
 * game added to a repertoire): shown above whichever page is open until dismissed or replaced.
 * Failures are the default tone.
 */
type AppNoticeStore = {
  message: string | null;
  tone: AppNoticeTone;
  action: AppNoticeAction | null;
  maia3Download: boolean;
  show: (message: string, options?: AppNoticeOptions) => void;
  dismiss: () => void;
};

export const useAppNoticeStore = create<AppNoticeStore>((set) => ({
  message: null,
  tone: "danger",
  action: null,
  maia3Download: false,
  show: (message, options) =>
    set({
      message,
      tone: options?.tone ?? "danger",
      action: options?.action ?? null,
      maia3Download: options?.maia3Download ?? false
    }),
  dismiss: () => set({ message: null, tone: "danger", action: null, maia3Download: false })
}));
