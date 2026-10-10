import type { WindowGlassState } from "@chaturanga/shared/ipc/chaturanga-api";

/*
 * Mirrors the main process's window glass state (macOS vibrancy) as `html.glass`, which the
 * stylesheet uses to make the window chrome translucent. Web preview / other platforms: never set.
 */

function appearanceApi() {
  return window.chaturanga?.appearance;
}

function setGlassState(state: WindowGlassState): void {
  document.documentElement.classList.toggle("glass", state.active);
}

/** Call once before the first render so the first frame already matches the native window. */
export function initWindowGlass(): void {
  const api = appearanceApi();
  if (!api) return;
  setGlassState(api.getGlass());
  api.onGlassChanged(setGlassState);
}

/**
 * Mirrors the page zoom factor (Cmd +/−, persisted per origin by Chromium) as `--window-zoom`.
 * The native traffic lights sit at fixed window points, so the titlebar height and the
 * traffic-light inset divide by it to stay aligned at any zoom. Zooming changes
 * devicePixelRatio, so a resolution media query tells us when to re-read it.
 */
export function initWindowZoom(): void {
  const api = appearanceApi();
  if (!api?.getZoomFactor) return;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty("--window-zoom", String(api.getZoomFactor()));
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener("change", update, { once: true });
  };
  update();
}

/** Tells the main process the first real frame is on screen, so it can show the (hidden) window. */
export function signalWindowReady(): void {
  // Two frames: the first rAF runs before React's commit is painted, the second after.
  requestAnimationFrame(() => requestAnimationFrame(() => appearanceApi()?.rendererReady()));
}
