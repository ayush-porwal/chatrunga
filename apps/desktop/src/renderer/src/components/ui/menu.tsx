import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { frost, popover } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";
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
 */
function OverflowMenu({ label, items }: { label: string; items: readonly (MenuItem | false | null | undefined)[] }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const visibleItems = items.filter((item): item is MenuItem => Boolean(item));

  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  const { present, state } = usePresence(open);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <IconButton
        label={label}
        icon={<MoreHorizontal />}
        aria-haspopup="menu"
        aria-expanded={open}
        tooltip={!open}
        onClick={() => setOpen((value) => !value)}
      />
      {present ? (
        <div
          role="menu"
          aria-label={label}
          data-state={state}
          className={cn("absolute right-0 top-[calc(100%+4px)] z-50 min-w-44", state === "closed" && "pointer-events-none")}
        >
          <span aria-hidden="true" className={cn(frost, "rounded-lg animate-fade-in data-[state=closed]:animate-fade-out")} data-state={state} />
          <div data-state={state} className={cn(popover, "relative grid origin-top-right gap-0.5")}>
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
                  "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:bg-control disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
                  item.destructive ? "text-danger hover:bg-danger-soft" : "text-fg-secondary hover:bg-control hover:text-fg"
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

export { OverflowMenu };
