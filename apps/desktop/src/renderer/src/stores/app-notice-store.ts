import { create } from "zustand";

/** A notice's optional follow-up ("Open chapter"). Choosing it also dismisses the notice. */
export type AppNoticeAction = { label: string; onSelect: () => void };

export type AppNoticeTone = "danger" | "success" | "info";

/**
 * A message from an action that isn't tied to a page (sidebar Import / Export PGN failures, a
 * game added to a repertoire): shown above whichever page is open until dismissed or replaced.
 * Failures are the default tone.
 */
type AppNoticeStore = {
  message: string | null;
  tone: AppNoticeTone;
  action: AppNoticeAction | null;
  show: (message: string, options?: { tone?: AppNoticeTone; action?: AppNoticeAction }) => void;
  dismiss: () => void;
};

export const useAppNoticeStore = create<AppNoticeStore>((set) => ({
  message: null,
  tone: "danger",
  action: null,
  show: (message, options) =>
    set({ message, tone: options?.tone ?? "danger", action: options?.action ?? null }),
  dismiss: () => set({ message: null, tone: "danger", action: null })
}));
