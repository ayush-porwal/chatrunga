import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Boolean toggle (replaces bare checkboxes for settings).
 *
 *   <Switch checked={on} onCheckedChange={setOn} aria-label="Move sounds" />
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
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent/60 bg-accent-strong" : "border-line bg-control",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "block size-3.5 rounded-full bg-fg transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px] bg-fg-muted"
        )}
      />
    </button>
  );
}

export { Switch };
