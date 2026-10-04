import * as React from "react";
import { ChevronDown } from "lucide-react";
import { sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * A section the user can fold away, remembered per section (localStorage, per viewer: a blocked or
 * empty store just starts at `defaultOpen`). The panel's multi-part screens use it: the review
 * summary's sections, the review charts, the review settings' groups. One header for all of them:
 * a left chevron and the title (⌄ Opening), as the charts' "Winning chances".
 *
 *   const section = useCollapsible("review-summary:opening");
 *   <CollapsibleHeader open={section.open} onToggle={section.toggle} controls={section.contentId}>
 *     Opening
 *   </CollapsibleHeader>
 *   <CollapsibleBody section={section} className="grid gap-2">…</CollapsibleBody>
 *
 * Or both at once: <CollapsibleSection storageKey=… title="Opening">…</CollapsibleSection>.
 * The header is a button with aria-expanded / aria-controls; a folded body isn't rendered (its
 * element stays, `hidden`, so aria-controls always points at it).
 */

const STORAGE_PREFIX = "chaturanga:collapsed:";

function readOpen(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    return stored === null ? defaultOpen : stored !== "1";
  } catch {
    return defaultOpen;
  }
}

function writeOpen(storageKey: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "0" : "1");
  } catch {
    // Storage unavailable: the section still folds, for this session only.
  }
}

export type Collapsible = {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** The body's id (the header's aria-controls). */
  contentId: string;
};

/** A section's open state, remembered under `storageKey`. */
export function useCollapsible(storageKey: string, defaultOpen = true): Collapsible {
  const [open, setOpenState] = React.useState(() => readOpen(storageKey, defaultOpen));
  const contentId = React.useId();
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next);
      writeOpen(storageKey, next);
    },
    [storageKey]
  );
  const toggle = React.useCallback(() => {
    setOpenState((current) => {
      writeOpen(storageKey, !current);
      return !current;
    });
  }, [storageKey]);
  return { open, toggle, setOpen, contentId };
}

/**
 * The section's toggle: a small heading whose button is a chevron at its LEFT and the title
 * (⌄ Opening while open, › Opening folded), as the review charts' "Winning chances" header. Use it
 * alone where the row holds more (the summary's Accuracy row keeps its boxes beside it).
 */
export function CollapsibleToggle({
  open,
  onToggle,
  controls,
  className,
  children
}: {
  open: boolean;
  onToggle: () => void;
  /** The body's id (aria-controls). */
  controls: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className={cn(sectionTitle, "min-w-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1 rounded-sm outline-none transition-colors duration-micro ease-standard hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-fg-subtle transition-transform duration-micro ease-standard",
            !open && "-rotate-90"
          )}
        />
        <span className="truncate">{children}</span>
      </button>
    </h3>
  );
}

/**
 * A section's header row: the toggle at the left, `actions` (outside the button) at the right.
 * Every folding section of the review panel uses this one row, so they share height and spacing.
 */
export function CollapsibleHeader({
  open,
  onToggle,
  controls,
  actions,
  className,
  children
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(collapsibleHeaderRow, className)}>
      <CollapsibleToggle open={open} onToggle={onToggle} controls={controls}>
        {children}
      </CollapsibleToggle>
      {actions ? <div className="flex min-w-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** The header row's box (height and spacing), for a row laid out by its owner. */
export const collapsibleHeaderRow = "flex min-h-6 shrink-0 items-center justify-between gap-3";

/** The section's body: rendered only while open. */
export function CollapsibleBody({
  section,
  className,
  children,
  ...props
}: {
  section: Collapsible;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "id" | "hidden" | "className" | "children">) {
  return (
    <div {...props} id={section.contentId} hidden={!section.open} className={className}>
      {section.open ? children : null}
    </div>
  );
}

/** A header and its body, remembered under `storageKey` (see the file comment). */
export function CollapsibleSection({
  storageKey,
  title,
  defaultOpen = true,
  actions,
  className,
  headerClassName,
  bodyClassName,
  children
}: {
  storageKey: string;
  title: React.ReactNode;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const section = useCollapsible(storageKey, defaultOpen);
  return (
    <div className={className}>
      <CollapsibleHeader
        open={section.open}
        onToggle={section.toggle}
        controls={section.contentId}
        actions={actions}
        className={headerClassName}
      >
        {title}
      </CollapsibleHeader>
      <CollapsibleBody section={section} className={bodyClassName}>
        {children}
      </CollapsibleBody>
    </div>
  );
}
