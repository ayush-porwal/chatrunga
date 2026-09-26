/** Rich listbox visuals shared by {@link PieceStyleListbox} and EngineDropdown in `EngineGamePage.tsx`. */
export const settingsListboxTriggerClass =
  "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-1.5 text-left text-fg transition-colors hover:bg-control";

export const settingsListboxTriggerOpenRing = "border-accent/60 ring-[3px] ring-accent/15";

export const settingsListboxPopoverClass =
  "scroll-area absolute left-0 top-[calc(100%+6px)] z-50 grid max-h-72 gap-0.5 overflow-auto rounded-lg border border-line bg-surface-raised p-1 shadow-popover";

export const settingsListboxOptionClass =
  "flex min-h-10 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-control";

export const settingsListboxOptionActiveClass = "bg-accent-soft text-fg";
