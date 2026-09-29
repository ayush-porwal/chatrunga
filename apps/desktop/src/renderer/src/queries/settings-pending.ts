import type { AppSettings } from "@chaturanga/shared/types/settings";

/**
 * Settings changed by a drag and not written yet (see SettingsBatch). A read of the settings
 * (after some other write) shows these on top of what's on disk, so the control doesn't jump back
 * to the old value before its own write lands.
 */
let pending: Partial<AppSettings> = {};

export function pendingSettings(): Partial<AppSettings> {
  return pending;
}

export function addPendingSettings(patch: Partial<AppSettings>): void {
  pending = { ...pending, ...patch };
}

/** The batch holding `patch` settled: its values are on disk (or were rolled back). */
export function settlePendingSettings(patch: Partial<AppSettings>): void {
  const next = { ...pending };
  for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
    if (Object.is(next[key], patch[key])) delete next[key];
  }
  pending = next;
}

/** `settings` with the not-yet-written values on top. */
export function withPendingSettings(settings: AppSettings): AppSettings {
  return Object.keys(pending).length ? { ...settings, ...pending } : settings;
}
