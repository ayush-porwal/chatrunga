import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { frost, popover } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { usePresence } from "@/components/ui/use-presence";

type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

/**
 * Overflow ("⋯") menu for secondary row actions (Test, Set default, Delete, Source link...).
 * Keeps rows to one visible primary control.
 *
 *   <OverflowMenu label="Engine actions" items={[
 *     { label: "Test", icon: <Play />, onSelect: test },
 *     { label: "Delete", icon: <Trash2 />, onSelect: remove, destructive: true }
 *   ]} />
 *
 * Motion: pops in from its top-right corner (the trigger side) and fades out; on glass the list
 * floats on a frosted backdrop layer that stays still while the list animates above it.
 * Placement: below the trigger, or above it when the list would be cut off at the bottom of a
 * scrolling container (the last rows of a list) or the window.
 */
function OverflowMenu({
  label,
  items,
  trigger
}: {
  label: string;
  items: readonly (MenuItem | false | null | undefined)[];
  /** A labelled outline button ("Backup") instead of the "⋯" icon, for a page header's menu. */
  trigger?: { text: string; icon?: React.ReactNode };
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const visibleItems = items.filter((item): item is MenuItem => Boolean(item));

  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  const { present, state } = usePresence(open);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [above, setAbove] = React.useState(false);

  // Measured once per opening, before paint: flip up when there's no room below but room above.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!open || !root || !list) return;
    const trigger = root.getBoundingClientRect();
    const bounds = clippingBounds(root);
    const height = list.offsetHeight + 4;
    setAbove(trigger.bottom + height > bounds.bottom && trigger.top - height >= bounds.top);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger ? (
        <Button
          type="button"
          variant="outline"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {trigger.icon}
          {trigger.text}
        </Button>
      ) : (
        <IconButton
          label={label}
          icon={<MoreHorizontal />}
          aria-haspopup="menu"
          aria-expanded={open}
          tooltip={!open}
          onClick={() => setOpen((value) => !value)}
        />
      )}
      {present ? (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          data-state={state}
          className={cn(
            "absolute right-0 z-50 min-w-44",
            above ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
            state === "closed" && "pointer-events-none"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(frost, "rounded-lg animate-fade-in data-[state=closed]:animate-fade-out")}
            data-state={state}
          />
          <div
            data-state={state}
            className={cn(
              popover,
              "relative grid gap-0.5",
              above ? "origin-bottom-right" : "origin-top-right"
            )}
          >
            {visibleItems.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={state === "closed" ? -1 : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:bg-control disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
                  item.destructive
                    ? "text-danger hover:bg-danger-soft"
                    : "text-fg-secondary hover:bg-control hover:text-fg"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The visible area `element` can draw in: its nearest clipping ancestor within the window. */
function clippingBounds(element: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow !== "visible") {
      const rect = node.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
      break;
    }
  }
  return { top, bottom };
}

export { OverflowMenu };
