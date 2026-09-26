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
 *
 * Motion: ONE selected pill slides between segments (transform + width, spring easing) instead of
 * each segment toggling its own fill. It is placed from the segments' offsets in a layout effect
 * (before paint — no first-frame jump) and re-placed without animation when the control resizes.
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
  const selectedIndex = options.findIndex((option) => option.value === value);
  const hasSelection = selectedIndex !== -1;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const indicatorRef = React.useRef<HTMLSpanElement | null>(null);
  const placedRef = React.useRef(false);
  const labelsKey = options.map((option) => option.label).join("\u0000");

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    let applied = "";
    const place = (animate: boolean) => {
      const segment = container.querySelectorAll<HTMLElement>("[data-segment]")[selectedIndex];
      if (!segment || segment.offsetWidth === 0) {
        indicator.style.opacity = "0";
        applied = "";
        return;
      }
      const next = `${segment.offsetLeft}:${segment.offsetWidth}`;
      if (next === applied) return;
      applied = next;
      // First placement and resizes snap; only a selection change travels.
      const snap = !animate || !placedRef.current || indicator.style.opacity === "0";
      if (snap) indicator.style.transition = "none";
      indicator.style.transform = `translateX(${segment.offsetLeft}px)`;
      indicator.style.width = `${segment.offsetWidth}px`;
      indicator.style.opacity = "1";
      if (snap) {
        void indicator.offsetWidth; // commit the snapped position before transitions return
        indicator.style.transition = "";
      }
      placedRef.current = true;
    };
    place(true);
    const observer = new ResizeObserver(() => place(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [selectedIndex, labelsKey, size, fullWidth]);

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
      ref={containerRef}
      role={role}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex min-w-0 items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5",
        fullWidth && "flex w-full",
        className
      )}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0.5 left-0 rounded-md bg-control opacity-0 shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-[transform,width] duration-standard ease-spring"
      />
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-segment=""
            role={itemRole}
            aria-selected={role === "tablist" ? selected : undefined}
            aria-checked={role === "radiogroup" ? selected : undefined}
            tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-fg-muted outline-none transition-[color,box-shadow,scale] duration-micro ease-standard hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100 [&_svg]:shrink-0",
              size === "sm" ? "h-7 px-2 text-xs [&_svg]:size-3.5" : "h-8 px-3 text-sm [&_svg]:size-4",
              fullWidth && "flex-1",
              selected && "text-fg"
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
