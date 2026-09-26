import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { popover } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";
import { IconButton } from "@/components/ui/icon-button";

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
 */
function OverflowMenu({ label, items }: { label: string; items: readonly (MenuItem | false | null | undefined)[] }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const visibleItems = items.filter((item): item is MenuItem => Boolean(item));

  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

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
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cn(popover, "absolute right-0 top-[calc(100%+4px)] grid min-w-44 gap-0.5")}
        >
          {visibleItems.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
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
      ) : null}
    </div>
  );
}

export { OverflowMenu };
