import { useUpdateSettingMutation } from "../../queries/api";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { trackSettingsSave } from "./settings-save-state";

/** Setter for one saved setting (optimistic; see useUpdateSettingMutation). Reports to the Saved indicator. */
export function useSetSetting() {
  const updateSetting = useUpdateSettingMutation();
  return function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    // mutateAsync: every write settles its own promise (mutate() callbacks only fire for the latest call).
    trackSettingsSave(updateSetting.mutateAsync({ key, value }));
  };
}
