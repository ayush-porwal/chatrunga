import { useSyncExternalStore } from "react";
import type { WindowGlassState } from "@chaturanga/shared/ipc/chaturanga-api";

/*
 * Mirrors the main process's window glass state (macOS vibrancy) as `html.glass`, which the
 * stylesheet uses to make the window chrome translucent. Web preview / other platforms: never set.
 */

function appearanceApi() {
  return window.chaturanga?.appearance;
}

// Cached here: every read through the context bridge returns a fresh copy, and
// useSyncExternalStore needs a stable snapshot.
let current: WindowGlassState | null = null;
const listeners = new Set<() => void>();

function setGlassState(state: WindowGlassState): void {
  current = state;
  document.documentElement.classList.toggle("glass", state.active);
  for (const listener of listeners) listener();
}

/** Call once before the first render so the first frame already matches the native window. */
export function initWindowGlass(): void {
  const api = appearanceApi();
  if (!api) return;
  setGlassState(api.getGlass());
  api.onGlassChanged(setGlassState);
}

/** Tells the main process the first real frame is on screen, so it can show the (hidden) window. */
export function signalWindowReady(): void {
  // Two frames: the first rAF runs before React's commit is painted, the second after.
  requestAnimationFrame(() => requestAnimationFrame(() => appearanceApi()?.rendererReady()));
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function snapshot(): WindowGlassState | null {
  return current;
}

/** The live glass state; null outside the desktop app. */
export function useWindowGlass(): WindowGlassState | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
