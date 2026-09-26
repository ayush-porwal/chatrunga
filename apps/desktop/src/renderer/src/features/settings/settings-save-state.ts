import { useSyncExternalStore } from "react";

/**
 * Save status of the settings changed on the Settings page, for the "Saved" indicator. Every
 * `useSetSetting` write reports here; the indicator shows Saving… while any write is in flight,
 * then Saved (or the failure) for the most recent one.
 */
export type SettingsSaveState = {
  pending: number;
  /** When the latest write finished; null before the first one. */
  settledAt: number | null;
  failed: boolean;
};

let state: SettingsSaveState = { pending: 0, settledAt: null, failed: false };
const listeners = new Set<() => void>();

function update(next: SettingsSaveState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Tracks one settings write from start to finish. */
export function trackSettingsSave(write: Promise<unknown>): void {
  update({ ...state, pending: state.pending + 1 });
  write.then(
    () => update({ pending: Math.max(0, state.pending - 1), settledAt: Date.now(), failed: false }),
    () => update({ pending: Math.max(0, state.pending - 1), settledAt: Date.now(), failed: true })
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettingsSaveState(): SettingsSaveState {
  return useSyncExternalStore(subscribe, () => state);
}
