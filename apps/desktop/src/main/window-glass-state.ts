import type { WindowGlassState } from "@chaturanga/shared/ipc/chaturanga-api";

/** macOS material behind the web contents while glass is on (the Finder/Mail sidebar material). */
export const GLASS_VIBRANCY = "sidebar" as const;
/** Window background while glass is on: fully transparent so the vibrancy view shows through. */
export const GLASS_BACKGROUND = "#00000000";
/** Window background while glass is off: the chrome colour (`--color-chrome`), shown before first paint and on resize. */
export const OPAQUE_BACKGROUND = "#1b1c1f";

/** Glass is shown only on macOS, with the setting on and the system's Reduce transparency off. */
export function resolveWindowGlassState(input: {
  platform: NodeJS.Platform;
  enabled: boolean;
  reducedTransparency: boolean;
}): WindowGlassState {
  const supported = input.platform === "darwin";
  return {
    supported,
    enabled: input.enabled,
    reducedTransparency: supported && input.reducedTransparency,
    active: supported && input.enabled && !input.reducedTransparency
  };
}

/** The native window options for a glass state. */
export function windowGlassOptions(state: WindowGlassState): {
  vibrancy: typeof GLASS_VIBRANCY | null;
  backgroundColor: string;
} {
  return state.active
    ? { vibrancy: GLASS_VIBRANCY, backgroundColor: GLASS_BACKGROUND }
    : { vibrancy: null, backgroundColor: OPAQUE_BACKGROUND };
}

export function sameGlassState(a: WindowGlassState, b: WindowGlassState): boolean {
  return (
    a.supported === b.supported &&
    a.enabled === b.enabled &&
    a.reducedTransparency === b.reducedTransparency &&
    a.active === b.active
  );
}
