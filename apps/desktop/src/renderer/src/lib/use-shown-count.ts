import { useState } from "react";

/** Rows a long list shows at first, and adds each time "Show more" is pressed. */
export const LIST_PAGE_SIZE = 50;

/**
 * A long list renders a page at a time (a library of thousands of games shouldn't build thousands
 * of rows at once). Resets to one page when `resetKey` changes (a new search).
 */
export function useShownCount(resetKey: string) {
  const [state, setState] = useState({ key: resetKey, count: LIST_PAGE_SIZE });
  // A new key starts over, and stays started over: coming back to an earlier key (switching a
  // search back) doesn't bring its longer list back. (Adjusting state while rendering, as React
  // documents for values derived from a changed prop.)
  if (state.key !== resetKey) setState({ key: resetKey, count: LIST_PAGE_SIZE });
  const count = state.key === resetKey ? state.count : LIST_PAGE_SIZE;
  return {
    count,
    showMore: () => setState({ key: resetKey, count: count + LIST_PAGE_SIZE })
  };
}
