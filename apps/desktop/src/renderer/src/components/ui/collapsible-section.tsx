import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A section the user can fold away, remembered per section (localStorage, per viewer: a blocked or
 * empty store just starts at `defaultOpen`). The panel's multi-part screens use it: the review
 * summary's OPENING / PHASES / PRACTICE, the review charts, the review settings' groups.
 *
 *   const section = useCollapsible("review-summary:opening");
 *   <CollapsibleHeader section={section} variant="divider">Opening</CollapsibleHeader>
 *   <CollapsibleBody section={section} className="grid gap-2">…</CollapsibleBody>
 *
 * Or both at once: <CollapsibleSection storageKey=… title="Opening" variant="divider">…</CollapsibleSection>.
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
 * The section's toggle, an accordion row: the whole row is the button, its chevron at the right
 * end (down while open, right while folded), muted with a hover highlight.
 * - `divider`: a rule with a one-word label inside it (── OPENING ── ⌄), small mono caps; without
 *   a label, a plain rule (── ⌄).
 * - `heading`: a small heading at the left; `actions` (outside the button) after the row.
 */
export function CollapsibleHeader({
  section,
  variant = "heading",
  label,
  actions,
  className,
  children
}: {
  section: Collapsible;
  variant?: "divider" | "heading";
  /** The accessible name when the row has no text (a plain divider rule). */
  label?: string;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const Chevron = section.open ? ChevronDown : ChevronRight;
  const chevron = (
    <Chevron
      aria-hidden
      className="size-3.5 shrink-0 text-fg-subtle transition-colors duration-micro group-hover:text-fg-secondary"
    />
  );
  const buttonProps = {
    type: "button" as const,
    "aria-expanded": section.open,
    "aria-controls": section.contentId,
    "aria-label": label,
    onClick: section.toggle
  };
  if (variant === "divider") {
    return (
      <button
        {...buttonProps}
        className={cn(
          "group flex min-h-6 w-full items-center gap-2.5 rounded-md px-1 font-mono text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase outline-none transition-colors duration-micro hover:bg-control/60 hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-accent/70",
          className
        )}
      >
        <span aria-hidden className="h-px flex-1 bg-line" />
        {children ? (
          <>
            <span>{children}</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </>
        ) : null}
        {chevron}
      </button>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <button
        {...buttonProps}
        className="group flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium text-fg-muted outline-none transition-colors duration-micro hover:bg-control/60 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {chevron}
      </button>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

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
  variant = "heading",
  defaultOpen = true,
  actions,
  className,
  headerClassName,
  bodyClassName,
  children
}: {
  storageKey: string;
  title: React.ReactNode;
  variant?: "divider" | "heading";
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
        section={section}
        variant={variant}
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
