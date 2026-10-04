import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { useUpdateSettingsMutation } from "../../queries/api";
import { addPendingSettings, dropPendingSettings, settlePendingSettings } from "../../queries/settings-pending";
import { trackSettingsSave } from "./settings-save-state";

/** A drag (slider, color picker) is written once it pauses this long. */
export const SETTINGS_WRITE_DELAY_MS = 250;

type Options = {
  /**
   * For continuous controls: show the value now, but write the latest one once the control
   * pauses (a slider drag becomes one write instead of one per tick). Written on unmount too.
   */
  batch?: boolean;
};

type Write = (write: { patch: Partial<AppSettings>; previous?: Partial<AppSettings> }) => Promise<unknown>;

/** Batches holding changes not written yet. */
const unwritten = new Set<SettingsBatch>();

/** Writes every batch's changes now, through `write` when given (instead of each batch's own writer). */
export function flushSettingsBatches(write?: Write): void {
  for (const batch of [...unwritten]) batch.flush(write);
}

let flushesOnPageHide = false;

/**
 * Closing (or reloading) the window doesn't unmount React, so a drag still waiting for its pause
 * is written as the page goes. Straight to IPC: the call is sent before the renderer is torn down,
 * while a mutation would only reach IPC after its async onMutate.
 */
function flushOnPageHide(): void {
  if (flushesOnPageHide || typeof window === "undefined") return;
  flushesOnPageHide = true;
  window.addEventListener("pagehide", () =>
    flushSettingsBatches(({ patch }) => window.chaturanga?.settings.patch(patch) ?? Promise.resolve())
  );
}

/** The changes of one drag, written together once it pauses. */
export class SettingsBatch {
  private patch: Partial<AppSettings> = {};
  private previous: Partial<AppSettings> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private write: Write | null = null;
  /** Settles when this batch's write does: the Saved indicator shows Saving… meanwhile. */
  private done: { promise: Promise<unknown>; settle: (result: Promise<unknown>) => void } | null = null;

  constructor(private readonly delayMs = SETTINGS_WRITE_DELAY_MS) {}

  setWriter(write: Write): void {
    this.write = write;
  }

  /** Adds `patch` (whose keys held `current` values before this drag) and restarts the wait. */
  add(patch: Partial<AppSettings>, current: AppSettings): void {
    for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
      if (!(key in this.previous)) Object.assign(this.previous, { [key]: current[key] });
    }
    Object.assign(this.patch, patch);
    addPendingSettings(patch);
    unwritten.add(this);
    flushOnPageHide();
    if (!this.done) {
      let settle: (result: Promise<unknown>) => void = () => {};
      const promise = new Promise<unknown>((resolve, reject) => {
        settle = (result) => {
          result.then(resolve, reject);
        };
      });
      this.done = { promise, settle };
      trackSettingsSave(promise);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(writer = this.write): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!Object.keys(this.patch).length || !writer) return;
    unwritten.delete(this);
    const write = { patch: this.patch, previous: this.previous };
    const done = this.done;
    this.patch = {};
    this.previous = {};
    this.done = null;
    const result = writer(write).finally(() => settlePendingSettings(write.patch));
    if (done) done.settle(result);
    else trackSettingsSave(result);
  }
}

function showSettings(queryClient: QueryClient, patch: Partial<AppSettings>): AppSettings {
  const current = { ...defaultSettings, ...queryClient.getQueryData<AppSettings>(["settings"]) };
  queryClient.setQueryData<AppSettings>(["settings"], { ...current, ...patch });
  return current;
}

/**
 * Setters for saved settings, reported to the Saved indicator. `setMany` writes related keys
 * together (a theme and its square colors): stored together, never half-applied.
 */
export function useSettingsWriter() {
  const { mutateAsync } = useUpdateSettingsMutation();
  const queryClient = useQueryClient();
  const [batch] = useState(() => new SettingsBatch());
  useEffect(() => batch.setWriter(mutateAsync), [batch, mutateAsync]);
  // Leaving the page mid-drag still saves where it stopped.
  useEffect(() => () => batch.flush(), [batch]);

  function setMany(patch: Partial<AppSettings>, options: Options = {}) {
    if (options.batch) {
      // Pending first: showing the value re-reads the settings at once (with the pending overlay).
      addPendingSettings(patch);
      batch.add(patch, showSettings(queryClient, patch));
      return;
    }
    batch.flush();
    // This value supersedes a drag's pending one for the same keys (Reset right after a drag).
    dropPendingSettings(Object.keys(patch) as (keyof AppSettings)[]);
    // mutateAsync: every write settles its own promise (mutate() callbacks only fire for the latest call).
    trackSettingsSave(mutateAsync({ patch }));
  }

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K], options?: Options) {
    setMany({ [key]: value } as Partial<AppSettings>, options);
  }

  return { set, setMany };
}

/** Setter for one saved setting, with `.many` for related keys together (see useSettingsWriter). */
export function useSetSetting() {
  const { set, setMany } = useSettingsWriter();
  return Object.assign(set, { many: setMany });
}
