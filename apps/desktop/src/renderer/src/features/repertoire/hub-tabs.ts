import { useCallback } from "react";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";
import { useSettingsQuery, useUpdateSettingMutation } from "../../queries/api";

/** The hub's tab panel (the titlebar's tabs control it). */
export const REPERTOIRE_HUB_PANEL_ID = "repertoire-hub-panel";

/**
 * Repertoire's tab (docs/repertoire-games-and-practice-ui.md §1), remembered in settings: the
 * sidebar's Repertoire, and Back to the hub, return to the tab last shown.
 */
export function useRepertoireHubTab(): [RepertoireHubTab, (tab: RepertoireHubTab) => void] {
  const settings = useSettingsQuery();
  const { mutate } = useUpdateSettingMutation();
  const tab = settings.data?.repertoireHubTab ?? defaultSettings.repertoireHubTab;
  const setTab = useCallback(
    (next: RepertoireHubTab) => mutate({ key: "repertoireHubTab", value: next }),
    [mutate]
  );
  return [tab, setTab];
}

/** The practice settings as stored (defaults until settings load). */
export function usePracticeSettings(): AppSettings["repertoirePractice"] {
  return useSettingsQuery().data?.repertoirePractice ?? defaultSettings.repertoirePractice;
}
