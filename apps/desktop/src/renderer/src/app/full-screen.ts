import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";

type FullScreenApi = Pick<ChaturangaApi["appearance"], "onFullScreenChanged" | "isFullScreen">;

/**
 * Reports whether the window is full screen: the state now (a reload while full screen), then
 * each change. A change that arrives before the answer wins over it; nothing is reported after the
 * returned stop function is called.
 */
export function followFullScreen(
  appearance: FullScreenApi,
  onChange: (fullScreen: boolean) => void
): () => void {
  let current = true;
  let changed = false;
  const unsubscribe = appearance.onFullScreenChanged((value) => {
    changed = true;
    onChange(value);
  });
  appearance
    .isFullScreen()
    .then((value) => {
      if (current && !changed) onChange(value);
    })
    // Without the answer the window counts as windowed until the next change event.
    .catch(() => undefined);
  return () => {
    current = false;
    unsubscribe();
  };
}
