import * as React from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /**
   * Why a disabled segment is unavailable, shown as its tooltip. The segment then stays hoverable
   * (aria-disabled instead of disabled) so the reason can be read; it still can't be chosen.
   */
  disabledReason?: string;
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
  /**
   * With `role="tablist"`: the id of the panel the tabs switch. Each tab then controls it
   * (`aria-controls`), and the panel should spread `tabPanelProps(panelId, value)`.
   */
  panelId?: string;
  className?: string;
};

/** The tab element's id for `value` in the tablist that controls `panelId`. */
function tabId(panelId: string, value: string): string {
  return `${panelId}-tab-${value}`;
}

/** Props for the panel a tablist switches: its role, id, and the selected tab that labels it. */
export function tabPanelProps(panelId: string, value: string) {
  return { id: panelId, role: "tabpanel" as const, "aria-labelledby": tabId(panelId, value) };
}

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
  panelId,
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
      // A row that scrolls (labels that never truncate, in a narrow panel) keeps the selection in view.
      if (container.scrollWidth > container.clientWidth) {
        const left = segment.offsetLeft;
        const right = left + segment.offsetWidth;
        if (left < container.scrollLeft) container.scrollLeft = left;
        else if (right > container.scrollLeft + container.clientWidth)
          container.scrollLeft = right - container.clientWidth;
      }
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

  // Arrow keys / Home / End move between segments (WAI-ARIA tabs & radio group pattern). A segment
  // locked with a reason still takes focus (so its tooltip, and the reason, reach keyboard and
  // screen-reader users) but isn't selected.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const focusable = options.filter((option) => !option.disabled || option.disabledReason);
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
    );
    const focused = buttons.findIndex((button) => button === document.activeElement);
    const current =
      focused !== -1 ? focused : focusable.findIndex((option) => option.value === value);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (current + 1) % focusable.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (current - 1 + focusable.length) % focusable.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = focusable.length - 1;
    const option = next === null ? undefined : focusable[next];
    if (!option || next === null) return;
    event.preventDefault();
    if (!option.disabled) onChange(option.value);
    buttons[next]?.focus();
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the role is a prop (radiogroup or tablist); the group moves focus between its options with the arrow keys
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
        const explained = Boolean(option.disabled && option.disabledReason);
        const segment = (
          <button
            key={option.value}
            type="button"
            data-segment=""
            role={itemRole}
            id={role === "tablist" && panelId ? tabId(panelId, option.value) : undefined}
            aria-controls={role === "tablist" && panelId ? panelId : undefined}
            aria-selected={role === "tablist" ? selected : undefined}
            aria-checked={role === "radiogroup" ? selected : undefined}
            aria-disabled={explained || undefined}
            tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1}
            disabled={option.disabled && !explained}
            onClick={() => {
              if (!option.disabled) onChange(option.value);
            }}
            className={cn(
              "relative inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-fg-muted outline-none transition-[color,box-shadow,scale] duration-micro ease-standard hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:text-fg-muted aria-disabled:active:scale-100 motion-reduce:active:scale-100 [&_svg]:shrink-0",
              size === "sm"
                ? "h-7 px-2 text-xs [&_svg]:size-3.5"
                : "h-8 px-3 text-sm [&_svg]:size-4",
              fullWidth && "flex-1",
              selected && "text-fg"
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
        if (!explained) return segment;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger asChild>{segment}</TooltipTrigger>
            <TooltipContent side="bottom">{option.disabledReason}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { SegmentedControl, type SegmentedOption };
