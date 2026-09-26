import { createContext, useContext } from "react";

/**
 * Focus mode for the board views: the side panel slides away (and the app collapses the sidebar
 * to its rail), leaving a distraction-free board. Provided by the app shell; every <BoardWorkspace>
 * hides its panel from it, so board pages need no focus props of their own. The controls are the
 * sidebar's Focus board / Exit focus item, F and Escape. False outside the shell.
 */
export const BoardFocusContext = createContext(false);

export function useBoardFocused(): boolean {
  return useContext(BoardFocusContext);
}
