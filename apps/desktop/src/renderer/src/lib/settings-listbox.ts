import { floatingSurface, motion } from "@/lib/ui";

/** Rich listbox visuals shared by {@link PieceStyleListbox} and EngineDropdown in `EngineGamePage.tsx`. */
export const settingsListboxTriggerClass =
  "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-left text-fg transition-colors duration-micro ease-standard hover:bg-control";

export const settingsListboxTriggerOpenRing = "border-accent/60 ring-[3px] ring-accent/15";

/** Where the list sits: under the trigger, full trigger width. Carries no animation (the frost layer lives here). */
export const settingsListboxPositionClass = "absolute left-0 top-[calc(100%+6px)] z-50";

/**
 * The list surface itself: pops in from the trigger (top edge) and out again with `data-state`.
 * On glass, pair it with a `frost` sibling inside a {@link settingsListboxPositionClass} box.
 */
export const settingsListboxSurfaceClass = `scroll-area relative grid max-h-72 origin-top gap-0.5 overflow-auto rounded-lg border border-line p-1 shadow-popover ${floatingSurface} ${motion.popover}`;

/** Position + surface in one element (no frost layer) — for lists that don't need the glass backdrop. */
export const settingsListboxPopoverClass = `${settingsListboxPositionClass} ${settingsListboxSurfaceClass}`;

export const settingsListboxOptionClass =
  "flex min-h-10 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm text-fg-secondary transition-colors duration-micro ease-standard hover:bg-control";

export const settingsListboxOptionActiveClass = "bg-accent-soft text-fg";
