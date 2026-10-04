import { createContext, useContext } from "react";
import type { SettingsSectionId } from "./SettingsPage";

/**
 * Opens app Settings at a section (App's navigation), for links from inside a page or dialog:
 * Review settings' "AI settings" and "Edit ratings". Null outside the app shell (no link then).
 */
export const OpenSettingsContext = createContext<((section: SettingsSectionId) => void) | null>(
  null
);

export function useOpenSettings(): ((section: SettingsSectionId) => void) | null {
  return useContext(OpenSettingsContext);
}
