import { useUpdateSettingMutation } from "../../queries/api";
import type { AppSettings } from "@chaturanga/shared/types/settings";

/** Setter for one saved setting (optimistic; see useUpdateSettingMutation). */
export function useSetSetting() {
  const updateSetting = useUpdateSettingMutation();
  return function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    updateSetting.mutate({ key, value });
  };
}
