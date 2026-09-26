import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A callback with a stable identity that always runs the latest `handler`. Lets memoised children
 * (sidebar, titlebar, workspace) take event handlers without re-rendering whenever the parent does.
 * Only for event handlers — never call the result during render.
 */
export function useEventCallback<Args extends unknown[], Result>(
  handler: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
