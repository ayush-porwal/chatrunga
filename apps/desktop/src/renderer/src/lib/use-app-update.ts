import { useSyncExternalStore } from "react";
import type { UpdateState } from "@chaturanga/shared/types/updates";
import type { UpdateAction } from "./app-update";

/*
 * One renderer-wide copy of the main process's update state (sidebar button + Settings share it).
 * Subscribes on first use; lives for the page's lifetime.
 */

let current: UpdateState | null = null;
const listeners = new Set<() => void>();
let connected = false;

function publish(next: UpdateState | null) {
  current = next;
  for (const listener of listeners) listener();
}

function connect() {
  const api = window.chaturanga;
  if (connected || !api?.updates) return;
  connected = true;
  api.events.onUpdateState((state) => publish(state));
  api.updates.getState().then(
    (state) => {
      if (!current) publish(state);
    },
    () => {}
  );
}

function subscribe(listener: () => void) {
  connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => current;

/** Checks now; resolves with the state after the check (null outside the desktop app or on failure). */
export async function checkForUpdates(): Promise<UpdateState | null> {
  try {
    const next = (await window.chaturanga?.updates?.check()) ?? null;
    if (next) publish(next);
    return next;
  } catch {
    return null;
  }
}

/** Runs one update action; the resulting state arrives through the state event. */
export async function runUpdateAction(action: UpdateAction): Promise<void> {
  const updates = window.chaturanga?.updates;
  if (!updates) return;
  try {
    if (action === "download") publish(await updates.download());
    else if (action === "install") await updates.install();
    else await updates.openDownload();
  } catch {
    // The main process reports failures through the state (error status); nothing to add here.
  }
}

/** The in-app update state (null until the main process answered, or outside the desktop app). */
export function useAppUpdate(): UpdateState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
