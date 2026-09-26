import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { useSettingsQuery, useUpdateSettingMutation } from "../../queries/api";
import { LEGACY_WELCOME_DISMISSED_KEY, shouldShowOnboarding } from "./onboarding-state";

type OnboardingSession = {
  /** Opened again from Settings ("Show welcome again"). */
  reopened: boolean;
  /** Finished or skipped in this session (hides it before the saved setting round-trips). */
  closed: boolean;
  reopen: () => void;
  close: () => void;
};

export const useOnboardingSession = create<OnboardingSession>((set) => ({
  reopened: false,
  closed: false,
  reopen: () => set({ reopened: true, closed: false }),
  close: () => set({ reopened: false, closed: true })
}));

function readLegacyDismissed(): boolean {
  try {
    return localStorage.getItem(LEGACY_WELCOME_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The first-run welcome: whether it is showing, and `finish()` for every way out of it (done,
 * skipped, or an action that leaves it). Finishing stores `onboardingCompletedAt`, so it never
 * opens by itself again; Settings can reopen it. Installs that predate the welcome are marked at
 * startup by the main process; someone who dismissed the earlier welcome dialog is carried over
 * here, once.
 */
export function useOnboarding(): { open: boolean; finish: () => void } {
  const settings = useSettingsQuery();
  const { mutate: updateSetting } = useUpdateSettingMutation();
  const { reopened, closed, close } = useOnboardingSession();
  const completedAt = settings.data?.onboardingCompletedAt ?? null;
  const settingsLoaded = settings.isSuccess && Boolean(window.chaturanga);
  const legacyDismissed = readLegacyDismissed();

  useEffect(() => {
    if (settingsLoaded && completedAt === null && legacyDismissed) {
      updateSetting({ key: "onboardingCompletedAt", value: 0 });
    }
  }, [completedAt, legacyDismissed, settingsLoaded, updateSetting]);

  const open =
    reopened || (!closed && shouldShowOnboarding({ settingsLoaded, completedAt, legacyDismissed }));

  const finish = useCallback(() => {
    close();
    updateSetting({ key: "onboardingCompletedAt", value: Date.now() });
  }, [close, updateSetting]);

  return { open, finish };
}
