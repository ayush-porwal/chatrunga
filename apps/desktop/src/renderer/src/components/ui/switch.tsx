import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Boolean toggle (replaces bare checkboxes for settings).
 *
 *   <Switch checked={on} onCheckedChange={setOn} aria-label="Move sounds" />
 *
 * Motion: the thumb slides with a small spring overshoot while the track colour eases; a press
 * squeezes the thumb slightly.
 */
function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border outline-none transition-[background-color,border-color,box-shadow] duration-standard ease-standard focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent/60 bg-accent-strong" : "border-line bg-control",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "block size-3.5 rounded-full bg-fg shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[translate,scale,background-color] duration-standard ease-spring group-active/switch:scale-90 motion-reduce:group-active/switch:scale-100",
          checked ? "translate-x-[18px]" : "translate-x-[2px] bg-fg-muted"
        )}
      />
    </button>
  );
}

export { Switch };
