import * as React from "react";
import { cn } from "@/lib/utils";

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  ariaLabel: string;
  /** `tablist` when switching panels (inspector, review tabs); `radiogroup` when picking a value. */
  role?: "tablist" | "radiogroup";
  size?: "sm" | "md";
  /** Stretch segments to fill the container width. */
  fullWidth?: boolean;
  className?: string;
};

/**
 * The single tabs / segmented picker pattern.
 *
 *   <SegmentedControl ariaLabel="Workspace panels" role="tablist" fullWidth
 *     options={[{ value: "moves", label: "Moves", icon: <BookOpen /> }, ...]}
 *     value={tab} onChange={setTab} />
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  role = "radiogroup",
  size = "md",
  fullWidth = false,
  className
}: SegmentedControlProps<T>) {
  const itemRole = role === "tablist" ? "tab" : "radio";
  const hasSelection = options.some((option) => option.value === value);
  // Arrow keys / Home / End move between segments (WAI-ARIA tabs & radio group pattern).
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((option) => !option.disabled);
    const current = enabled.findIndex((option) => option.value === value);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % enabled.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    const option = next === null ? undefined : enabled[next];
    if (!option) return;
    event.preventDefault();
    onChange(option.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    buttons[next ?? 0]?.focus();
  };
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5",
        fullWidth && "flex w-full",
        className
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={itemRole}
            aria-selected={role === "tablist" ? selected : undefined}
            aria-checked={role === "radiogroup" ? selected : undefined}
            tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-fg-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
              size === "sm" ? "h-7 px-2 text-xs [&_svg]:size-3.5" : "h-8 px-3 text-sm [&_svg]:size-4",
              fullWidth && "flex-1",
              selected && "bg-control text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl, type SegmentedOption };
