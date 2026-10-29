import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Where the shown tab's own actions go: the right end of the hub card's tab bar. */
export const HubActionsSlot = createContext<HTMLElement | null>(null);

/**
 * A Repertoire tab's own actions (search and New; How it works and the practice cog), shown at the
 * right end of the hub card's tab bar while the tab is. They stay part of the tab, its state and
 * dialogs with it; nothing shows until the bar is there.
 */
export function HubTabActions({ children }: { children: ReactNode }) {
  const slot = useContext(HubActionsSlot);
  return slot ? createPortal(children, slot) : null;
}
