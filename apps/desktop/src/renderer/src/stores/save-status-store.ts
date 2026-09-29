import { create } from "zustand";

/**
 * Whether the loaded game's last library write failed. Autosave owns it: set on a failed save,
 * cleared by the next successful one, and `retry` saves again now.
 */
type SaveStatusStore = {
  error: string | null;
  retry: (() => void) | null;
  setFailed: (error: string, retry: () => void) => void;
  clear: () => void;
};

export const useSaveStatusStore = create<SaveStatusStore>((set) => ({
  error: null,
  retry: null,
  setFailed: (error, retry) => set({ error, retry }),
  clear: () => set({ error: null, retry: null })
}));
